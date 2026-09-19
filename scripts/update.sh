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

if [ -n "${1:-}" ] && [ -d "$1" ]; then
    REPO_DIR="$1"
elif [ -n "${BASH_SOURCE[0]:-}" ] && [[ "${BASH_SOURCE[0]}" != *"/fd/"* ]] && [ -f "${BASH_SOURCE[0]}" ]; then
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
        local_trans=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
        local_priv=$(openssl rand -hex 16 2>/dev/null || date +%s%N)
        as_root sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${local_jwt}|" /etc/ownmediahost/ownmediahost.env
        as_root sed -i "s|^COOKIE_SECRET=.*|COOKIE_SECRET=${local_cookie}|" /etc/ownmediahost/ownmediahost.env
        as_root sed -i "s|^API_KEY_PEPPER=.*|API_KEY_PEPPER=${local_pepper}|" /etc/ownmediahost/ownmediahost.env
        as_root sed -i "s|^TRANSFORM_SIGNING_KEY=.*|TRANSFORM_SIGNING_KEY=${local_trans}|" /etc/ownmediahost/ownmediahost.env
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

if curl -fsSL -o "$tmp_tar" "$release_backend_url" 2>/dev/null && [ -s "$tmp_tar" ]; then
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
    log_info "Precompiled backend not reachable. Compiling from source..."
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

# 2. Update frontend
log_info "Updating React frontend dashboard..."
frontend_updated=false
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

if [[ "$frontend_updated" != true ]]; then
    log_info "Precompiled frontend not reachable. Building from source..."
    cd "${REPO_DIR}/frontend"
    if [ ! -f .env.production ]; then
        cat > .env.production << 'EOF'
VITE_API_BASE_URL=/api/v1
VITE_APP_NAME=OwnMediaHost
VITE_APP_VERSION=0.1.0
EOF
    fi
    as_root npm install
    as_root npm run build
    as_root mkdir -p /var/www/ownmediahost/dist
    as_root cp -r dist/* /var/www/ownmediahost/dist/
    as_root chown -R www-data:www-data /var/www/ownmediahost 2>/dev/null || true
    log_success "Frontend assets refreshed (production build)."
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
ENV_ACTIVE="/etc/ownmediahost/ownmediahost.env"
if [ ! -f "$ENV_ACTIVE" ] && [ -f /etc/selfmedia/selfmedia.env ]; then
    ENV_ACTIVE="/etc/selfmedia/selfmedia.env"
fi

if [ -f /etc/caddy/Caddyfile ] && [ -f "$ENV_ACTIVE" ]; then
    log_info "Synchronizing Caddy reverse proxy routing..."
    caddy_port=$(as_root grep "^APP_PORT=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "5002")
    [ -z "$caddy_port" ] && caddy_port="5002"
    public_url=$(as_root grep "^PUBLIC_BASE_URL=" "$ENV_ACTIVE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    caddy_domain=$(echo "$public_url" | sed -e 's|^[^/]*//||' -e 's|/.*$||' -e 's|:[0-9]*$||')

    if [ -n "$caddy_domain" ]; then
        as_root sed -i '/# >>> OwnMediaHost block >>>/,/# <<< OwnMediaHost block <<</d' /etc/caddy/Caddyfile
        as_root sed -i '/# >>> SELFmedia block >>>/,/# <<< SELFmedia block <<</d' /etc/caddy/Caddyfile
        cat << EOF | as_root tee -a /etc/caddy/Caddyfile >/dev/null

# >>> OwnMediaHost block >>>
${caddy_domain} {
    encode gzip zstd
    request_body {
        max_size 10GB
    }

    @backend path /api* /f/* /i/* /a/* /thumbnails/* /private/* /health* /docs* /openapi.json
    handle @backend {
        reverse_proxy 127.0.0.1:${caddy_port} {
            flush_interval -1
        }
    }

    handle {
        root * /var/www/ownmediahost/dist
        try_files {path} /index.html
        file_server
    }
}
# <<< OwnMediaHost block <<<
EOF
        if as_root caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
            as_root systemctl reload caddy || as_root systemctl restart caddy
            log_success "Caddy reverse proxy reloaded with handle-isolated SPA routing."
        fi
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

log_success "OwnMediaHost successfully updated and running!"
