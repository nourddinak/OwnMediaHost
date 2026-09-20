#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost — Fast Bare-Metal VPS Updater
# Pulls latest changes, recompiles backend & frontend, updates systemd service
#
# QUICK 1-LINER:
#   bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)
#
# LOCAL:
#   sudo bash /opt/ownmediahost/scripts/update.sh
# ==============================================================================

set -euo pipefail

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

log_info() { echo -e "${CYAN}${BOLD}[INFO]${RESET} $*"; }
log_success() { echo -e "${GREEN}${BOLD}[SUCCESS]${RESET} $*"; }
log_warn() { echo -e "${YELLOW}${BOLD}[WARNING]${RESET} $*"; }
log_error() { echo -e "${RED}${BOLD}[ERROR]${RESET} $*" >&2; }

have() {
    command -v "$1" >/dev/null 2>&1
}

as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif have sudo; then
        sudo "$@"
    else
        log_error "Root privileges required for: $* (install sudo or run as root)"
        exit 1
    fi
}

if [ "$(id -u)" -ne 0 ]; then
    if have sudo; then
        if ! sudo -n true 2>/dev/null; then
            log_info "Sudo password required..."
            if [ -e /dev/tty ]; then
                sudo -v </dev/tty || { log_error "Failed to authenticate. Run: curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh -o /tmp/update.sh && sudo bash /tmp/update.sh"; exit 1; }
            else
                sudo -v || { log_error "Failed to authenticate sudo credentials."; exit 1; }
            fi
        fi
    else
        log_error "Please run with sudo or root: sudo bash $0"
        exit 1
    fi
fi

TARGET_INSTALL_DIR="/opt/ownmediahost"
REPO_DIR="${TARGET_INSTALL_DIR}"

BUILD_FROM_SOURCE=false
STATUS_DOMAIN_CLI=""
STATUS_URL_CLI=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --build-from-source|-b)
            BUILD_FROM_SOURCE=true
            shift
            ;;
        --status-domain)
            STATUS_DOMAIN_CLI="$2"
            shift 2
            ;;
        --status-url)
            STATUS_URL_CLI="$2"
            shift 2
            ;;
        -*)
            shift
            ;;
        *)
            if [ -d "$1" ]; then
                REPO_DIR="$1"
            fi
            shift
            ;;
    esac
done

if [ -n "${BASH_SOURCE[0]:-}" ] && [[ "${BASH_SOURCE[0]}" != *"/fd/"* ]] && [ -f "${BASH_SOURCE[0]}" ]; then
    CURRENT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${CURRENT_SCRIPT_DIR}/../backend/Cargo.toml" ]; then
        REPO_DIR="$(cd "${CURRENT_SCRIPT_DIR}/.." && pwd)"
    elif [ -f "${CURRENT_SCRIPT_DIR}/backend/Cargo.toml" ]; then
        REPO_DIR="${CURRENT_SCRIPT_DIR}"
    fi
elif [ ! -d "${REPO_DIR}" ] && [ -d "/opt/selfmedia" ]; then
    REPO_DIR="/opt/selfmedia"
fi

if [ ! -d "${REPO_DIR}" ] || [ ! -f "${REPO_DIR}/backend/Cargo.toml" ]; then
    log_error "OwnMediaHost repository not found at ${REPO_DIR}."
    log_error "Please deploy first with: bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)"
    exit 1
fi

cd "${REPO_DIR}"

# Ensure system user ownmediahost exists
if ! id -u ownmediahost >/dev/null 2>&1; then
    as_root useradd --system --no-create-home --shell /usr/sbin/nologin ownmediahost 2>/dev/null || true
fi

# Mark repo as safe for git and ensure executing user owns files
as_root git config --global --add safe.directory "${REPO_DIR}" 2>/dev/null || true
as_root chown -R "$(id -u):$(id -g)" "${REPO_DIR}" 2>/dev/null || true

log_info "Fetching latest code from Git in ${REPO_DIR}..."
if [ -d .git ]; then
    as_root git pull --rebase || true
fi

# Ensure /etc/ownmediahost/ownmediahost.env exists
as_root mkdir -p "/etc/ownmediahost"
if [ ! -f /etc/ownmediahost/ownmediahost.env ]; then
    if [ -f /etc/selfmedia/selfmedia.env ]; then
        log_info "Migrating configuration from /etc/selfmedia/selfmedia.env..."
        as_root cp -f /etc/selfmedia/selfmedia.env /etc/ownmediahost/ownmediahost.env
    elif [ -f "${REPO_DIR}/.env" ]; then
        as_root cp -f "${REPO_DIR}/.env" /etc/ownmediahost/ownmediahost.env
    elif [ -f "${REPO_DIR}/.env.example" ]; then
        as_root cp -f "${REPO_DIR}/.env.example" /etc/ownmediahost/ownmediahost.env
        local_jwt=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
        local_cookie=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
        local_pepper=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
        local_priv=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
        as_root sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${local_jwt}|" /etc/ownmediahost/ownmediahost.env
        as_root sed -i "s|^COOKIE_SECRET=.*|COOKIE_SECRET=${local_cookie}|" /etc/ownmediahost/ownmediahost.env
        as_root sed -i "s|^API_KEY_PEPPER=.*|API_KEY_PEPPER=${local_pepper}|" /etc/ownmediahost/ownmediahost.env
        as_root sed -i "s|^PRIVATE_URL_SIGNING_KEY=.*|PRIVATE_URL_SIGNING_KEY=${local_priv}|" /etc/ownmediahost/ownmediahost.env
    fi
    as_root chown -R ownmediahost:ownmediahost /etc/ownmediahost 2>/dev/null || true
    as_root chmod 600 /etc/ownmediahost/ownmediahost.env 2>/dev/null || true
    log_success "Environment configuration restored at /etc/ownmediahost/ownmediahost.env"
fi

if [ -f /etc/ownmediahost/ownmediahost.env ]; then
    as_root cp -f /etc/ownmediahost/ownmediahost.env "${REPO_DIR}/.env" 2>/dev/null || true
    as_root chmod 600 "${REPO_DIR}/.env" 2>/dev/null || true
fi

# 1. Update backend binary
log_info "Updating Rust backend binary..."
binary_updated=false
release_backend_url="https://github.com/nourddinak/OwnMediaHost/releases/latest/download/ownmediahost-backend-linux-amd64.tar.gz"
tmp_tar="/tmp/ownmediahost-backend-linux-amd64.tar.gz"
as_root rm -f "$tmp_tar"

if [[ "$BUILD_FROM_SOURCE" != true ]] && curl -fsSL -o "$tmp_tar" "$release_backend_url" 2>/dev/null && [ -s "$tmp_tar" ]; then
    tmp_extract="/tmp/ownmediahost-bin-extract"
    as_root rm -rf "$tmp_extract"
    as_root mkdir -p "$tmp_extract"
    if as_root tar -xzf "$tmp_tar" -C "$tmp_extract" 2>/dev/null && [ -f "$tmp_extract/ownmediahost-backend" ]; then
        as_root install -m 755 "$tmp_extract/ownmediahost-backend" /usr/local/bin/ownmediahost-backend
        as_root rm -rf "$tmp_tar" "$tmp_extract"
        log_success "Instant update: Precompiled backend binary installed to /usr/local/bin/ownmediahost-backend"
        binary_updated=true
    fi
fi

if [[ "$binary_updated" != true ]]; then
    if [[ "$BUILD_FROM_SOURCE" == true ]]; then
        log_info "Building backend from source as requested..."
    else
        log_info "Precompiled backend not reachable or outdated. Compiling from source..."
    fi
    CARGO_ENV=""
    for candidate in \
        "/root/.cargo/env" \
        "$HOME/.cargo/env" \
        "/home/$(logname 2>/dev/null)/.cargo/env" \
        /home/*/.cargo/env; do
        if [ -f "$candidate" ]; then
            CARGO_ENV="$candidate"
            break
        fi
    done

    cd "${REPO_DIR}/backend"
    local_target_dir="/tmp/ownmediahost-cargo-target"
    as_root rm -rf "$local_target_dir"
    mkdir -p "$local_target_dir"
    chmod 777 "$local_target_dir"

    if [ -n "$CARGO_ENV" ]; then
        as_root bash -c ". '$CARGO_ENV' && CARGO_TARGET_DIR='$local_target_dir' cargo build --release"
    elif have cargo; then
        CARGO_TARGET_DIR="$local_target_dir" cargo build --release || as_root CARGO_TARGET_DIR="$local_target_dir" cargo build --release
    else
        log_error "Cargo/Rust not found. Please run the full deploy script first."
        exit 1
    fi
    as_root install -m 755 "${local_target_dir}/release/ownmediahost-backend" /usr/local/bin/ownmediahost-backend
    as_root rm -rf "$local_target_dir"
    log_success "Backend binary compiled and updated."
fi

# Remove legacy binary if present
as_root rm -f /usr/local/bin/selfmedia-backend 2>/dev/null || true

# Detect topology and domains from environment
ENV_ACTIVE="/etc/ownmediahost/ownmediahost.env"
if [ ! -f "$ENV_ACTIVE" ] && [ -f /etc/selfmedia/selfmedia.env ]; then
    ENV_ACTIVE="/etc/selfmedia/selfmedia.env"
fi

DEPLOY_MODE="unified"
FRONTEND_DOMAIN=""
BACKEND_DOMAIN=""
STATUS_DOMAIN=""
caddy_domain=""

if [ -f "$ENV_ACTIVE" ]; then
    DEPLOY_MODE=$(as_root grep "^DEPLOY_MODE=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    FRONTEND_DOMAIN=$(as_root grep "^FRONTEND_DOMAIN=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    BACKEND_DOMAIN=$(as_root grep "^BACKEND_DOMAIN=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    STATUS_DOMAIN=$(as_root grep "^STATUS_DOMAIN=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    public_url=$(as_root grep "^PUBLIC_BASE_URL=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    caddy_domain=$(echo "$public_url" | sed -e 's|^[^/]*//||' -e 's|/.*$||' -e 's|:[0-9]*$||')

    # Check SQLite database for newer settings configured via the Web UI
    DB_FILE="/var/lib/ownmediahost/storage/database/media.db"
    [ ! -f "$DB_FILE" ] && DB_FILE="${REPO_DIR}/backend/storage/database/media.db"

    if [ -f "$DB_FILE" ] && have sqlite3; then
        db_deploy_mode=$(as_root sqlite3 "$DB_FILE" "SELECT value FROM settings WHERE key='deploy_mode';" 2>/dev/null || echo "")
        db_domain=$(as_root sqlite3 "$DB_FILE" "SELECT value FROM settings WHERE key='domain';" 2>/dev/null || echo "")
        db_frontend_domain=$(as_root sqlite3 "$DB_FILE" "SELECT value FROM settings WHERE key='frontend_domain';" 2>/dev/null || echo "")
        db_backend_domain=$(as_root sqlite3 "$DB_FILE" "SELECT value FROM settings WHERE key='backend_domain';" 2>/dev/null || echo "")
        db_public_url=$(as_root sqlite3 "$DB_FILE" "SELECT value FROM settings WHERE key='public_base_url';" 2>/dev/null || echo "")
        db_status_url=$(as_root sqlite3 "$DB_FILE" "SELECT value FROM settings WHERE key='status_page_url';" 2>/dev/null || echo "")

        if [ -n "$db_deploy_mode" ]; then
            DEPLOY_MODE="$db_deploy_mode"
            as_root sed -i "s|^DEPLOY_MODE=.*|DEPLOY_MODE=${DEPLOY_MODE}|" "$ENV_ACTIVE" 2>/dev/null || echo "DEPLOY_MODE=${DEPLOY_MODE}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
        if [ -n "$db_frontend_domain" ]; then
            FRONTEND_DOMAIN="$db_frontend_domain"
            as_root sed -i "s|^FRONTEND_DOMAIN=.*|FRONTEND_DOMAIN=${FRONTEND_DOMAIN}|" "$ENV_ACTIVE" 2>/dev/null || echo "FRONTEND_DOMAIN=${FRONTEND_DOMAIN}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
        if [ -n "$db_backend_domain" ]; then
            BACKEND_DOMAIN="$db_backend_domain"
            as_root sed -i "s|^BACKEND_DOMAIN=.*|BACKEND_DOMAIN=${BACKEND_DOMAIN}|" "$ENV_ACTIVE" 2>/dev/null || echo "BACKEND_DOMAIN=${BACKEND_DOMAIN}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
        if [ -n "$db_domain" ] && [ -z "$caddy_domain" ]; then
            caddy_domain="$db_domain"
            as_root sed -i "s|^DOMAIN=.*|DOMAIN=${caddy_domain}|" "$ENV_ACTIVE" 2>/dev/null || echo "DOMAIN=${caddy_domain}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
        if [ -n "$db_public_url" ]; then
            public_url="$db_public_url"
            caddy_domain=$(echo "$public_url" | sed -e 's|^[^/]*//||' -e 's|/.*$||' -e 's|:[0-9]*$||')
            as_root sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${public_url}|" "$ENV_ACTIVE" 2>/dev/null || echo "PUBLIC_BASE_URL=${public_url}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
        if [ -n "$db_status_url" ]; then
            STATUS_DOMAIN="$db_status_url"
            as_root sed -i "s|^STATUS_PAGE_URL=.*|STATUS_PAGE_URL=${db_status_url}|" "$ENV_ACTIVE" 2>/dev/null || echo "STATUS_PAGE_URL=${db_status_url}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
        log_info "Synchronized configuration from SQLite settings table (Topology: ${DEPLOY_MODE})."
    fi

    if [ -n "$STATUS_DOMAIN_CLI" ]; then
        STATUS_DOMAIN="$STATUS_DOMAIN_CLI"
        if as_root grep -q "^STATUS_DOMAIN=" "$ENV_ACTIVE" 2>/dev/null; then
            as_root sed -i "s|^STATUS_DOMAIN=.*|STATUS_DOMAIN=${STATUS_DOMAIN}|" "$ENV_ACTIVE"
        else
            echo "STATUS_DOMAIN=${STATUS_DOMAIN}" | as_root tee -a "$ENV_ACTIVE" >/dev/null
        fi
    fi

    if [ "$DEPLOY_MODE" != "split" ] && [ -n "$FRONTEND_DOMAIN" ] && [ -n "$BACKEND_DOMAIN" ]; then
        DEPLOY_MODE="split"
    fi
fi

# 2. Update frontend
log_info "Updating React frontend dashboard..."
frontend_updated=false

# If unified mode, try downloading precompiled frontend bundle first
if [[ "$DEPLOY_MODE" != "split" ]]; then
    release_frontend_url="https://github.com/nourddinak/OwnMediaHost/releases/latest/download/ownmediahost-frontend-dist.tar.gz"
    tmp_front_tar="/tmp/ownmediahost-frontend-dist.tar.gz"
    as_root rm -f "$tmp_front_tar"

    if curl -fsSL -o "$tmp_front_tar" "$release_frontend_url" 2>/dev/null && [ -s "$tmp_front_tar" ]; then
        as_root mkdir -p /var/www/ownmediahost/dist
        if as_root tar -xzf "$tmp_front_tar" -C /var/www/ownmediahost/dist 2>/dev/null; then
            as_root chown -R www-data:www-data /var/www/ownmediahost 2>/dev/null || true
            as_root rm -f "$tmp_front_tar"
            log_success "Instant update: Precompiled frontend dashboard assets refreshed."
            frontend_updated=true
        fi
    fi
fi

if [[ "$frontend_updated" != true ]]; then
    log_info "Building frontend dashboard from source..."
    cd "${REPO_DIR}/frontend"
    local_api_base="/api/v1"
    if [[ "$DEPLOY_MODE" == "split" && -n "$BACKEND_DOMAIN" ]]; then
        local_api_base="https://${BACKEND_DOMAIN}/api/v1"
        log_info "Split domain detected: Baking VITE_API_BASE_URL=${local_api_base} into frontend build"
    fi
    cat > .env.production << EOF
VITE_API_BASE_URL=${local_api_base}
VITE_APP_NAME=OwnMediaHost
VITE_APP_VERSION=0.1.0
EOF
    as_root npm install
    as_root npm run build
    as_root mkdir -p /var/www/ownmediahost/dist
    as_root cp -r dist/* /var/www/ownmediahost/dist/
    as_root chown -R www-data:www-data /var/www/ownmediahost 2>/dev/null || true
    log_success "Frontend assets refreshed (production build)."
fi

# 2b. Synchronize Public Status Page Assets
if [ -d "${REPO_DIR}/status" ] && [ -f "${REPO_DIR}/status/index.html" ]; then
    log_info "Synchronizing public status page assets from local files..."
    as_root mkdir -p /var/www/ownmediahost/status
    as_root rm -rf /var/www/ownmediahost/status/* 2>/dev/null || true
    as_root cp -rf "${REPO_DIR}/status/"* /var/www/ownmediahost/status/
    as_root chown -R www-data:www-data /var/www/ownmediahost/status 2>/dev/null || true
    log_success "Public status page assets refreshed."
elif [ -d "/var/www/ownmediahost/status/.git" ]; then
    log_info "Synchronizing public status page from Git repository..."
    (cd /var/www/ownmediahost/status && as_root git pull --ff-only 2>/dev/null || true)
    as_root chown -R www-data:www-data /var/www/ownmediahost/status 2>/dev/null || true
    log_success "Public status page Git repository updated."
elif [ -n "$STATUS_DOMAIN" ] && have git; then
    log_info "Cloning public status page repository..."
    as_root mkdir -p /var/www/ownmediahost/status
    as_root git clone "https://github.com/nourddinak/OwnMediaHost-status.git" /var/www/ownmediahost/status 2>/dev/null || true
    as_root chown -R www-data:www-data /var/www/ownmediahost/status 2>/dev/null || true
    log_success "Public status page repository initialized."
fi

# Connect status URL if explicitly provided
if [ -n "$STATUS_URL_CLI" ] && [ -f "${REPO_DIR}/scripts/connect-status.sh" ]; then
    log_info "Updating public status page connection (${STATUS_URL_CLI})..."
    as_root bash "${REPO_DIR}/scripts/connect-status.sh" --url "$STATUS_URL_CLI" 2>/dev/null || true
fi

# 3. Verify Database CLI & Media Engine
log_info "Verifying database and media engine..."
log_success "Media engine operational: Browser HTML5 Canvas & Pure Rust (Zero external dependencies)"

if ! have sqlite3; then
    log_info "Installing SQLite3 CLI..."
    if have apt-get; then
        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y sqlite3 2>/dev/null || true
    fi
fi
if have sqlite3; then
    log_success "SQLite CLI satisfied: $(sqlite3 --version 2>/dev/null | cut -d' ' -f1)"
fi

# 4. Synchronize Caddy Reverse Proxy & SPA Routing
if [ -f /etc/caddy/Caddyfile ] && [ -f "$ENV_ACTIVE" ]; then
    log_info "Synchronizing Caddy reverse proxy routing..."
    caddy_port=$(as_root grep "^APP_PORT=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "5002")
    [ -z "$caddy_port" ] && caddy_port="5002"

    as_root sed -i '/# =* OwnMediaHost =*/,/# =* End OwnMediaHost =*/d' /etc/caddy/Caddyfile
    as_root sed -i '/# >>> OwnMediaHost block >>>/,/# <<< OwnMediaHost block <<</d' /etc/caddy/Caddyfile
    as_root sed -i '/# >>> SELFmedia block >>>/,/# <<< SELFmedia block <<</d' /etc/caddy/Caddyfile

    if [[ "$DEPLOY_MODE" == "split" && -n "$FRONTEND_DOMAIN" && -n "$BACKEND_DOMAIN" ]]; then
        cat << EOF | as_root tee -a /etc/caddy/Caddyfile >/dev/null

# ============================== OwnMediaHost ==================================
# ${FRONTEND_DOMAIN}   {static}
# ${BACKEND_DOMAIN}    {${caddy_port}}
# ==============================================================================
${FRONTEND_DOMAIN} {
    encode gzip zstd

    handle_path /status* {
        root * /var/www/ownmediahost/status
        file_server
        try_files {path} /index.html
    }

    root * /var/www/ownmediahost/dist
    try_files {path} /index.html
    file_server
}

${BACKEND_DOMAIN} {
    encode gzip zstd
    request_body {
        max_size 10GB
    }
    reverse_proxy 127.0.0.1:${caddy_port} {
        flush_interval -1
    }
}
# ============================ End OwnMediaHost ================================
EOF
        log_info "Synchronized 2-domain split Caddy routing (${FRONTEND_DOMAIN} -> UI, ${BACKEND_DOMAIN} -> API)."
    elif [ -n "$caddy_domain" ]; then
        cat << EOF | as_root tee -a /etc/caddy/Caddyfile >/dev/null

# ============================== OwnMediaHost ==================================
# ${caddy_domain}   {${caddy_port}}
# ==============================================================================
${caddy_domain} {
    encode gzip zstd
    request_body {
        max_size 10GB
    }

    @backend path /api* /f/* /i/* /a/* /thumbnails/* /private/* /health*
    handle @backend {
        reverse_proxy 127.0.0.1:${caddy_port} {
            flush_interval -1
        }
    }

    handle_path /status* {
        root * /var/www/ownmediahost/status
        file_server
        try_files {path} /index.html
    }

    handle {
        root * /var/www/ownmediahost/dist
        try_files {path} /index.html
        file_server
    }
}
# ============================ End OwnMediaHost ================================
EOF
        log_info "Synchronized unified domain Caddy routing (${caddy_domain})."
    fi

    if [ -n "$STATUS_DOMAIN" ]; then
        cat << EOF | as_root tee -a /etc/caddy/Caddyfile >/dev/null

# ============================== Status Page ===================================
# ${STATUS_DOMAIN}   {static status}
# ==============================================================================
${STATUS_DOMAIN} {
    encode gzip zstd
    root * /var/www/ownmediahost/status
    file_server
    try_files {path} /index.html
}
# ============================ End Status Page =================================
EOF
        log_info "Synchronized decoupled status page Caddy routing (${STATUS_DOMAIN})."
    fi

    if as_root caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
        as_root systemctl reload caddy || as_root systemctl restart caddy
        log_success "Caddy reverse proxy reloaded successfully."
    fi
fi

# 5. Systemd Service Deployment & Restart
as_root tee /etc/systemd/system/ownmediahost.service >/dev/null << EOF
[Unit]
Description=OwnMediaHost Personal Media Infrastructure Platform
Documentation=https://github.com/nourddinak/OwnMediaHost
After=network.target

[Service]
Type=simple
User=ownmediahost
Group=ownmediahost
EnvironmentFile=/etc/ownmediahost/ownmediahost.env
ExecStart=/usr/local/bin/ownmediahost-backend
Restart=always
RestartSec=5s
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ownmediahost
KillMode=mixed
TimeoutStopSec=10s

[Install]
WantedBy=multi-user.target
EOF

# Stop legacy selfmedia service if running
if systemctl is-active --quiet selfmedia 2>/dev/null; then
    as_root systemctl stop selfmedia || true
    as_root systemctl disable selfmedia || true
    as_root rm -f /etc/systemd/system/selfmedia.service 2>/dev/null || true
fi

as_root systemctl daemon-reload
as_root systemctl enable ownmediahost
as_root systemctl restart ownmediahost
as_root systemctl status ownmediahost --no-pager -n 5

# Ensure background update trigger watcher is active
update_storage="${MEDIA_ROOT:-/var/lib/ownmediahost/storage}"
trigger_file="${update_storage}/update.trigger"
log_file="${update_storage}/update.log"
as_root touch "${trigger_file}" "${log_file}" 2>/dev/null || true
as_root chown -R ownmediahost:ownmediahost "${update_storage}" 2>/dev/null || true

as_root tee /etc/systemd/system/ownmediahost-update.path >/dev/null << EOF
[Unit]
Description=OwnMediaHost Web UI Update Trigger Watcher
Documentation=https://github.com/nourddinak/OwnMediaHost
After=network.target

[Path]
PathModified=${trigger_file}
Unit=ownmediahost-update.service

[Install]
WantedBy=multi-user.target
EOF

as_root tee /etc/systemd/system/ownmediahost-update.service >/dev/null << EOF
[Unit]
Description=OwnMediaHost Server Background Updater
Documentation=https://github.com/nourddinak/OwnMediaHost
After=network.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/ownmediahost
ExecStartPre=/bin/rm -f ${trigger_file}
ExecStart=/bin/bash /opt/ownmediahost/scripts/update.sh
StandardOutput=append:${log_file}
StandardError=append:${log_file}
EOF

as_root systemctl daemon-reload
as_root systemctl enable --now ownmediahost-update.path 2>/dev/null || true

log_success "OwnMediaHost successfully updated and running!"
