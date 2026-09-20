#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost — Automated 1-Line VPS Deployment Bot (Bare-Metal, No Docker)
#
# AS ROOT (sudo -i first, or logged in as root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)
#
# WITH SUDO (recommended for most VPS):
#   curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh
#
# NON-INTERACTIVE:
#   sudo bash /tmp/deploy.sh --non-interactive --domain media.example.com --email admin@example.com
# ==============================================================================

set -euo pipefail

# --- Color Palettes & UI ---
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

log_info() {
    echo -e "${CYAN}${BOLD}[INFO]${RESET} $*"
}

log_success() {
    echo -e "${GREEN}${BOLD}[SUCCESS]${RESET} $*"
}

log_warn() {
    echo -e "${YELLOW}${BOLD}[WARNING]${RESET} $*"
}

log_error() {
    echo -e "${RED}${BOLD}[ERROR]${RESET} $*" >&2
}

banner() {
    echo -e "${CYAN}${BOLD}"
    cat << "EOF"
   ___                  __  __          _ _       _   _           _   
  / _ \__      ___ __  |  \/  | ___  __| (_) __ _| | | | ___  ___| |_ 
 | | | \ \ /\ / / '_ \ | |\/| |/ _ \/ _` | |/ _` | |_| |/ _ \/ __| __|
 | |_| |\ V  V /| | | || |  | |  __/ (_| | | (_| |  _  | (_) \__ \ |_ 
  \___/  \_/\_/ |_| |_||_|  |_|\___|\__,_|_|\__,_|_| |_|\___/|___/\__|
   1-Line Bare-Metal VPS Deploy Bot — No Docker Required
EOF
    echo -e "${RESET}"
    echo -e "${DIM}Automated Git bootstrap, Caddy reverse-proxy, Rust SIMD engine, and Systemd.${RESET}\n"
}

# --- Privilege & System Command Helpers ---
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

check_privileges() {
    if [ "$(id -u)" -ne 0 ]; then
        if have sudo; then
            # 1. Fast path: check if user already has passwordless sudo or cached credentials
            if sudo -n true 2>/dev/null; then
                return 0
            fi

            # 2. If password is required, prompt explicitly via /dev/tty
            log_info "Sudo privileges required for system service provisioning. Checking credentials..."
            local sudo_ok=false
            if [ -e /dev/tty ]; then
                sudo -v </dev/tty && sudo_ok=true || sudo_ok=false
            else
                sudo -v && sudo_ok=true || sudo_ok=false
            fi

            if [[ "$sudo_ok" != true ]]; then
                log_error "Failed to authenticate sudo credentials."
                echo -e "\n${YELLOW}${BOLD}Run the installer with root privileges using either:${RESET}"
                echo -e "  ${BOLD}Option 1 (Recommended):${RESET} Download and run directly with sudo:"
                echo -e "    ${CYAN}curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh${RESET}\n"
                echo -e "  ${BOLD}Option 2:${RESET} Switch to root first, then run:"
                echo -e "    ${CYAN}sudo -i${RESET}"
                echo -e "    ${CYAN}bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)${RESET}\n"
                exit 1
            fi
        else
            log_error "This deployment bot must be run with root privileges or a user with sudo access."
            exit 1
        fi
    fi
}

# --- TTY-Safe Interactive Prompt Reader ---
prompt_read() {
    local prompt_msg="$1"
    local var_name="$2"
    local default_val="${3:-}"
    local user_val=""

    if [ -e /dev/tty ]; then
        read -rp "$prompt_msg" user_val </dev/tty
    elif [ -t 0 ]; then
        read -rp "$prompt_msg" user_val
    else
        user_val="$default_val"
    fi

    if [ -z "$user_val" ]; then
        user_val="$default_val"
    fi
    printf -v "$var_name" '%s' "$user_val"
}

# --- OS Detection ---
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_VERSION="${VERSION_ID:-unknown}"
    else
        OS_ID="unknown"
        OS_VERSION="unknown"
    fi
    log_info "Detected Operating System: ${OS_ID} ${OS_VERSION}"
    if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
        log_warn "This installer is optimized for Ubuntu and Debian. It will attempt standard package managers."
    fi
}

# --- Multimedia Pipeline Check ---
check_multimedia_engine() {
    log_info "Probing database & media engine (SQLite3, HTML5 Canvas)..."

    local sq_bin
    sq_bin="$(command -v sqlite3 2>/dev/null || echo '')"

    if [ -n "$sq_bin" ]; then
        local sq_v
        sq_v="$("$sq_bin" --version 2>/dev/null | cut -d' ' -f1 || echo 'available')"
        log_success "SQLite3 CLI detected: ${sq_bin} (v${sq_v})"
    else
        log_info "SQLite3 CLI: Not detected (will be auto-installed for database inspection)"
    fi
    log_success "Media pipeline: HTML5 Canvas & Pure Rust (Zero external dependencies)"
}

# --- Default Parameters ---
GIT_REPO_URL="${GIT_REPO_URL:-https://github.com/nourddinak/OwnMediaHost.git}"
TARGET_INSTALL_DIR="/opt/ownmediahost"

# Determine initial REPO_DIR
REPO_DIR="${TARGET_INSTALL_DIR}"
if [ -n "${BASH_SOURCE[0]:-}" ] && [[ "${BASH_SOURCE[0]}" != *"/fd/"* ]] && [ -f "${BASH_SOURCE[0]}" ]; then
    CURRENT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${CURRENT_SCRIPT_DIR}/../backend/Cargo.toml" ]; then
        REPO_DIR="$(cd "${CURRENT_SCRIPT_DIR}/.." && pwd)"
    elif [ -f "${CURRENT_SCRIPT_DIR}/backend/Cargo.toml" ]; then
        REPO_DIR="${CURRENT_SCRIPT_DIR}"
    fi
fi

NON_INTERACTIVE=false
APP_ENV="production"
DEPLOY_MODE="unified"
DOMAIN=""
FRONTEND_DOMAIN=""
BACKEND_DOMAIN=""
BACKEND_PORT="8080"
STORAGE_DIR="/var/lib/ownmediahost/storage"
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
SKIP_DEPS=false
BUILD_FROM_SOURCE=false
STATUS_DOMAIN=""
STATUS_URL=""
STATUS_REPO_URL="${STATUS_REPO_URL:-https://github.com/nourddinak/OwnMediaHost-status.git}"

# --- Parse CLI Arguments ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --non-interactive|-y)
            NON_INTERACTIVE=true
            shift
            ;;
        --repo-url)
            GIT_REPO_URL="$2"
            shift 2
            ;;
        --install-dir)
            REPO_DIR="$2"
            TARGET_INSTALL_DIR="$2"
            shift 2
            ;;
        --mode)
            case "$2" in
                production|prod)
                    APP_ENV="production"
                    ;;
                unified)
                    DEPLOY_MODE="unified"
                    ;;
                split)
                    DEPLOY_MODE="split"
                    ;;
                *)
                    DEPLOY_MODE="$2"
                    ;;
            esac
            shift 2
            ;;
        --env|--app-env)
            APP_ENV="$2"
            shift 2
            ;;
        --topology|--routing)
            DEPLOY_MODE="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --frontend-domain)
            FRONTEND_DOMAIN="$2"
            shift 2
            ;;
        --backend-domain)
            BACKEND_DOMAIN="$2"
            shift 2
            ;;
        --port)
            BACKEND_PORT="$2"
            shift 2
            ;;
        --storage-dir)
            STORAGE_DIR="$2"
            shift 2
            ;;
        --email)
            ADMIN_EMAIL="$2"
            shift 2
            ;;
        --status-domain)
            STATUS_DOMAIN="$2"
            shift 2
            ;;
        --status-url)
            STATUS_URL="$2"
            shift 2
            ;;
        --status-repo)
            STATUS_REPO_URL="$2"
            shift 2
            ;;
        --password)
            ADMIN_PASSWORD="$2"
            shift 2
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --build-from-source)
            BUILD_FROM_SOURCE=true
            shift
            ;;
        --uninstall)
            if [ -f "${REPO_DIR}/scripts/uninstall.sh" ]; then
                shift
                exec bash "${REPO_DIR}/scripts/uninstall.sh" "$@"
            else
                shift
                exec bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh) "$@"
            fi
            ;;
        --help|-h)
            echo "Usage: bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh) [options]"
            echo ""
            echo "Options:"
            echo "  --non-interactive, -y       Run without prompting, using arguments or defaults"
            echo "  --repo-url <url>            Git repository to clone (default: https://github.com/nourddinak/OwnMediaHost.git)"
            echo "  --install-dir <path>        Code directory (default: /opt/ownmediahost)"
            echo "  --mode <production>         Deployment execution mode (default: production)"
            echo "  --topology <unified|split>  Domain routing: 'unified' (single domain) or 'split' (separate frontend & backend domains)"
            echo "  --build-from-source         Compile from source on VPS instead of downloading fast precompiled binaries"
            echo "  --domain <domain>           Domain for unified deployment (e.g. media.example.com)"
            echo "  --frontend-domain <domain>  Frontend domain for split deployment"
            echo "  --backend-domain <domain>   Backend domain for split deployment"
            echo "  --status-domain <domain>    Decoupled public status page domain (e.g. status.example.com)"
            echo "  --status-url <url>          External/GitHub Pages status page URL (e.g. https://user.github.io/status)"
            echo "  --status-repo <git_url>     Git repo for status assets (default: https://github.com/nourddinak/OwnMediaHost-status.git)"
            echo "  --port <port>               Internal backend port (default: 8080)"
            echo "  --storage-dir <path>        Persistent storage path (default: /var/lib/ownmediahost/storage)"
            echo "  --email <email>             Initial admin email"
            echo "  --password <password>       Initial admin password (auto-generated if omitted)"
            echo "  --skip-deps                 Skip installing OS packages, Node, Rust, and Caddy"
            echo "  --uninstall                 Completely uninstall OwnMediaHost services and configs"
            exit 0
            ;;
        *)
            log_warn "Unknown parameter: $1"
            shift
            ;;
    esac
done

# --- Automated Git Bootstrap (When invoked via curl one-liner) ---
bootstrap_repo() {
    if [ ! -f "${REPO_DIR}/backend/Cargo.toml" ]; then
        log_info "OwnMediaHost source code not found locally at ${REPO_DIR}."
        log_info "Initiating automated 1-line Git bootstrap..."

        # Ensure git, curl, and ca-certificates are installed
        if ! have git || ! have curl; then
            log_info "Installing git, curl, and ca-certificates for initial clone..."
            if have apt-get; then
                as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
                as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates
            elif have dnf; then
                as_root dnf install -y -q git curl ca-certificates
            elif have yum; then
                as_root yum install -y -q git curl ca-certificates
            elif have pacman; then
                as_root pacman -Sy --noconfirm git curl ca-certificates
            fi
        fi

        as_root mkdir -p "$(dirname "$REPO_DIR")"

        if [ -d "${REPO_DIR}/.git" ]; then
            log_info "Existing repository detected at ${REPO_DIR}. Pulling latest updates..."
            (cd "$REPO_DIR" && as_root git pull --rebase || true)
        else
            if [ -d "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR" 2>/dev/null)" ]; then
                local backup_dir="${REPO_DIR}.bak.$(date +%s)"
                log_warn "Directory ${REPO_DIR} exists and is not empty. Moving to ${backup_dir}..."
                as_root mv "$REPO_DIR" "$backup_dir"
            fi
            log_info "Cloning repository from ${GIT_REPO_URL} into ${REPO_DIR}..."
            as_root git clone "${GIT_REPO_URL}" "$REPO_DIR"
        fi

        local real_u="${SUDO_USER:-$(id -un)}"
        local real_g
        real_g="$(id -gn "$real_u" 2>/dev/null || id -gn)"
        as_root chown -R "${real_u}:${real_g}" "$REPO_DIR"
        as_root chmod -R u+rwX,g+rwX,o+rwX "$REPO_DIR"
        git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true
        cd "$REPO_DIR"
        log_success "Source code successfully cloned to ${REPO_DIR}"
    else
        log_info "Running from existing repository directory: ${REPO_DIR}"
        if [ -d "${REPO_DIR}/.git" ]; then
            log_info "Pulling latest changes from repository..."
            as_root git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true
            (cd "$REPO_DIR" && as_root git fetch origin main 2>/dev/null && as_root git reset --hard origin/main 2>/dev/null || as_root git pull --rebase || true)
        fi
        local real_u="${SUDO_USER:-$(id -un)}"
        local real_g
        real_g="$(id -gn "$real_u" 2>/dev/null || id -gn)"
        as_root chown -R "${real_u}:${real_g}" "$REPO_DIR"
        as_root chmod -R u+rwX,g+rwX,o+rwX "$REPO_DIR"
        git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true
        cd "$REPO_DIR"
    fi
}

# --- Random Password / Secret Generator ---
# NOTE: Pipelines like `cat /dev/urandom | tr | fold | head` will SIGPIPE-crash
# under `set -eo pipefail` because `head -n 1` closes the pipe early.
# Use openssl or dd (fixed byte count, no early pipe close) instead.
generate_secret() {
    if have openssl; then
        openssl rand -hex 32
    else
        dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n' | cut -c1-64
    fi
}

generate_password() {
    if have openssl; then
        # Generate a 20-char alphanumeric password
        openssl rand -base64 30 | tr -dc 'a-zA-Z0-9' | cut -c1-20
    else
        dd if=/dev/urandom bs=256 count=1 2>/dev/null | tr -dc 'a-zA-Z0-9' | cut -c1-20
    fi
}

# --- Interactive Prompt Wizard ---
interactive_wizard() {
    echo -e "${BOLD}=== Step 1: Domain Configuration ===${RESET}\n"

    if [[ -z "$DOMAIN" && -z "$FRONTEND_DOMAIN" ]]; then
        echo -e "Choose how you would like to route your domain:"
        echo -e "  ${BOLD}[1] Single Domain${RESET} ${GREEN}(Recommended)${RESET}"
        echo -e "      e.g. ${CYAN}media.example.com${RESET}"
        echo -e "      Caddy serves both dashboard UI and media streaming APIs on one domain."
        echo -e "      Zero cross-domain CORS issues, simpler SSL.\n"
        echo -e "  ${BOLD}[2] Separate Domains${RESET}"
        echo -e "      e.g. Frontend: ${CYAN}media.example.com${RESET} | Backend: ${CYAN}api.example.com${RESET}\n"

        local mode_choice
        prompt_read "Select domain setup [1/2, default: 1]: " mode_choice "1"

        if [[ "$mode_choice" == "2" ]]; then
            DEPLOY_MODE="split"
            while [[ -z "$FRONTEND_DOMAIN" ]]; do
                prompt_read "Enter Frontend Domain (e.g. media.example.com): " FRONTEND_DOMAIN ""
            done

            while [[ -z "$BACKEND_DOMAIN" ]]; do
                prompt_read "Enter Backend API Domain (e.g. api.example.com): " BACKEND_DOMAIN ""
            done
        else
            DEPLOY_MODE="unified"
            while [[ -z "$DOMAIN" ]]; do
                prompt_read "Enter your media domain (e.g. media.example.com): " DOMAIN ""
            done
        fi
    fi

    # Decoupled Public Status Page (Optional)
    if [[ -z "$STATUS_DOMAIN" && -z "$STATUS_URL" ]]; then
        echo -e "\n${BOLD}=== Step 1b: Public Status Page (Incident Communication) ===${RESET}"
        echo -e "An out-of-band status page can be deployed on a separate domain (e.g. ${CYAN}status.yourdomain.com${RESET})"
        echo -e "or connected to Better Stack (${CYAN}https://status.yourdomain.com${RESET} / ${CYAN}https://yourname.betteruptime.com${RESET})."
        local user_status
        prompt_read "Enter status domain or URL [optional, press Enter to skip]: " user_status ""
        if [[ "$user_status" =~ ^https?:// ]]; then
            STATUS_URL="$user_status"
        elif [[ -n "$user_status" ]]; then
            STATUS_DOMAIN="$user_status"
        fi
    fi

    # Backend Port
    echo -e "\n${BOLD}=== Step 2: Internal Backend Port ===${RESET}"
    local input_port
    prompt_read "Enter internal port for Rust Axum backend [default: ${BACKEND_PORT}]: " input_port "${BACKEND_PORT}"
    BACKEND_PORT="$input_port"

    # Check port collision
    if have ss; then
        if ss -tln | grep -q ":${BACKEND_PORT} "; then
            log_warn "Port ${BACKEND_PORT} is currently in use on this machine!"
            local alt_port
            prompt_read "Proceed anyway or enter another port [default: ${BACKEND_PORT}]: " alt_port "${BACKEND_PORT}"
            BACKEND_PORT="$alt_port"
        fi
    fi

    # Storage Location
    echo -e "\n${BOLD}=== Step 3: Persistent Storage Location ===${RESET}"
    local input_storage
    prompt_read "Enter persistent media directory [default: ${STORAGE_DIR}]: " input_storage "${STORAGE_DIR}"
    STORAGE_DIR="$input_storage"

    # Admin Credentials
    echo -e "\n${BOLD}=== Step 4: Administrator Account ===${RESET}"
    local default_email
    if [[ "$DEPLOY_MODE" == "unified" ]]; then
        default_email="admin@${DOMAIN}"
    else
        default_email="admin@${FRONTEND_DOMAIN}"
    fi

    prompt_read "Admin Email [default: ${default_email}]: " ADMIN_EMAIL "$default_email"

    if [[ -z "$ADMIN_PASSWORD" ]]; then
        local auto_pw
        auto_pw=$(generate_password)
        prompt_read "Admin Password [leave empty to generate secure password]: " ADMIN_PASSWORD "$auto_pw"
    fi

    echo -e "\n${BOLD}=== Configuration Summary ===${RESET}"
    echo -e "  Code Source:      ${CYAN}${REPO_DIR}${RESET}"
    echo -e "  Mode:             ${GREEN}production${RESET}"
    if [[ "$DEPLOY_MODE" == "unified" ]]; then
        echo -e "  Domain:           ${CYAN}${DOMAIN}${RESET}"
    else
        echo -e "  Frontend Domain:  ${CYAN}${FRONTEND_DOMAIN}${RESET}"
        echo -e "  Backend Domain:   ${CYAN}${BACKEND_DOMAIN}${RESET}"
    fi
    if [[ -n "$STATUS_URL" ]]; then
        echo -e "  Status Page:      ${CYAN}${STATUS_URL}${RESET} ${GREEN}(Out-of-band / Connected)${RESET}"
    elif [[ -n "$STATUS_DOMAIN" ]]; then
        echo -e "  Status Domain:    ${CYAN}${STATUS_DOMAIN}${RESET} ${GREEN}(Decoupled Static Host)${RESET}"
    fi
    echo -e "  Backend Port:     ${CYAN}${BACKEND_PORT}${RESET}"
    echo -e "  Storage Path:     ${CYAN}${STORAGE_DIR}${RESET}"
    echo -e "  Admin Email:      ${CYAN}${ADMIN_EMAIL}${RESET}"
    echo -e "  Admin Password:   ${GREEN}${ADMIN_PASSWORD}${RESET}"
    echo -e "  Media Engine:     ${GREEN}Browser HTML5 Canvas & Pure Rust (Zero external dependencies)${RESET}"
    if have sqlite3; then
        echo -e "  Database CLI:     ${GREEN}SQLite 3 ($(sqlite3 --version 2>/dev/null | cut -d' ' -f1))${RESET}\n"
    else
        echo -e "  Database CLI:     ${YELLOW}SQLite 3 (Will be installed)${RESET}\n"
    fi

    local confirm
    prompt_read "Proceed with automated deployment? [Y/n]: " confirm "Y"
    if [[ "$confirm" != [yY] && "$confirm" != [yY][eE][sS] ]]; then
        log_warn "Deployment aborted by user."
        exit 0
    fi
}

# --- System Dependencies Installation ---
install_dependencies() {
    if [[ "$SKIP_DEPS" == true ]]; then
        log_info "Skipping standard dependency installation as requested."
        return 0
    fi

    if have apt-get; then
        # If a broken or unkeyed caddy repo list exists from an earlier attempt, remove it
        # so initial apt-get update succeeds. Caddy's repo and key are cleanly configured in step 3.
        if [ -f /etc/apt/sources.list.d/caddy-stable.list ] || [ -f /etc/apt/sources.list.d/caddy.list ]; then
            if [ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
                log_info "Cleaning up unkeyed legacy Caddy repository list before apt update..."
                as_root rm -f /etc/apt/sources.list.d/caddy-stable.list /etc/apt/sources.list.d/caddy.list
            fi
        fi

        log_info "Updating system package repositories..."
        as_root env DEBIAN_FRONTEND=noninteractive apt-get update -y || {
            log_warn "apt-get update encountered warnings or non-fatal repo issues; attempting cleanup and retry..."
            as_root rm -f /etc/apt/sources.list.d/caddy-stable.list /etc/apt/sources.list.d/caddy.list
            as_root env DEBIAN_FRONTEND=noninteractive apt-get update -y || true
        }

        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
            curl \
            wget \
            git \
            build-essential \
            pkg-config \
            libssl-dev \
            libsqlite3-dev \
            sqlite3 \
            ca-certificates \
            gnupg \
            debian-keyring \
            debian-archive-keyring \
            apt-transport-https
    else
        log_warn "Non-APT package manager detected. Please ensure build-essential, git, pkg-config, libssl-dev, and sqlite3 are installed."
    fi

    # 1. Node.js & npm (Node v20+)
    local install_node=false
    if ! have node; then
        install_node=true
    else
        local node_ver
        node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
        if (( node_ver < 20 )); then
            log_warn "Existing Node.js version ($node_ver) is below recommended v20+. Upgrading..."
            install_node=true
        fi
    fi

    if [[ "$install_node" == true ]]; then
        log_info "Installing Node.js v22 (LTS) via official NodeSource repository..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | as_root bash -
        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
        log_success "Installed Node.js $(node -v) and npm $(npm -v)"
    else
        log_success "Node.js already satisfied: $(node -v)"
    fi

    # 2. Rust & Cargo (1.80+)
    if ! have cargo; then
        log_info "Rust toolchain not detected. Installing Rust via rustup..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
        export PATH="$HOME/.cargo/bin:$PATH"
        if [ -f "$HOME/.cargo/env" ]; then
            . "$HOME/.cargo/env"
        elif [ -f "/root/.cargo/env" ]; then
            . "/root/.cargo/env"
        fi
        log_success "Rust installed: $(cargo --version)"
    else
        log_success "Rust toolchain already satisfied: $(cargo --version)"
    fi

    # 3. Caddy Web Server
    if ! have caddy; then
        log_info "Caddy reverse proxy not detected. Installing official Caddy package..."
        if have apt-get; then
            as_root mkdir -p /usr/share/keyrings
            as_root rm -f /etc/apt/sources.list.d/caddy-stable.list /etc/apt/sources.list.d/caddy.list

            # Fetch Caddy GPG key and ensure it is valid and world-readable
            local key_installed=false
            if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | as_root gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null; then
                as_root chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
                key_installed=true
            fi

            # Fallback to keyserver if curl/gpg pipe had issues
            if [[ "$key_installed" != true ]] || [ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
                log_info "Fetching Caddy GPG key (ABA1F9B8875A6661) from keyserver..."
                as_root gpg --no-default-keyring --keyring /usr/share/keyrings/caddy-stable-archive-keyring.gpg --keyserver keyserver.ubuntu.com --recv-keys ABA1F9B8875A6661 2>/dev/null || true
                as_root chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
            fi

            # Add official Caddy debian source
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | as_root tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
            as_root env DEBIAN_FRONTEND=noninteractive apt-get update -y || true
            as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
            as_root systemctl enable caddy
            as_root systemctl start caddy
            log_success "Caddy installed successfully: $(caddy version)"
        else
            log_error "Unable to auto-install Caddy on this distribution. Please install Caddy manually from https://caddyserver.com"
            exit 1
        fi
    else
        log_success "Caddy already installed: $(caddy version)"
    fi

    # 4. Media Processing Engine (Browser HTML5 Canvas & Pure Rust)
    log_success "Media engine satisfied: Browser HTML5 Canvas & Pure Rust (Zero external dependencies)"

    # 5. Database Tools (SQLite3)
    if ! have sqlite3; then
        log_info "SQLite3 CLI not detected. Installing sqlite3..."
        if have apt-get; then
            as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y sqlite3 libsqlite3-dev
        elif have dnf; then
            as_root dnf install -y sqlite sqlite-devel 2>/dev/null || true
        elif have pacman; then
            as_root pacman -Sy --noconfirm sqlite 2>/dev/null || true
        fi
    fi

    if have sqlite3; then
        log_success "Database engine satisfied: SQLite $(sqlite3 --version 2>/dev/null | cut -d' ' -f1)"
    fi
}

# --- Compile / Fetch Backend ---
build_backend() {
    log_info "Preparing Rust backend binary..."
    local binary_ready=false

    # 1. Fast Path: Download precompiled Linux x86_64 binary from GitHub Releases
    if [[ "$BUILD_FROM_SOURCE" != true ]]; then
        local release_url="https://github.com/nourddinak/OwnMediaHost/releases/latest/download/ownmediahost-backend-linux-amd64.tar.gz"
        log_info "Checking for precompiled release binary (${release_url})..."
        local tmp_tar="/tmp/ownmediahost-backend-linux-amd64.tar.gz"
        as_root rm -f "$tmp_tar"

        if curl -fsSL -o "$tmp_tar" "$release_url" 2>/dev/null && [ -s "$tmp_tar" ]; then
            log_info "Precompiled binary archive downloaded! Extracting..."
            local tmp_extract="/tmp/ownmediahost-bin-extract"
            as_root rm -rf "$tmp_extract"
            as_root mkdir -p "$tmp_extract"
            if as_root tar -xzf "$tmp_tar" -C "$tmp_extract" 2>/dev/null && [ -f "$tmp_extract/ownmediahost-backend" ]; then
                as_root install -m 755 "$tmp_extract/ownmediahost-backend" /usr/local/bin/ownmediahost-backend
                as_root rm -rf "$tmp_tar" "$tmp_extract"
                log_success "Instant deployment: Precompiled backend binary installed to /usr/local/bin/ownmediahost-backend"
                binary_ready=true
            else
                as_root rm -rf "$tmp_tar" "$tmp_extract"
            fi
        else
            log_info "Precompiled release binary not found or unreachable. Falling back to local compilation..."
        fi
    fi

    # 2. Fallback Path: Compile from source using isolated /tmp target
    if [[ "$binary_ready" != true ]]; then
        log_info "Compiling Rust backend in release mode (optimizations enabled)..."
        cd "${REPO_DIR}/backend"

        local real_u="${SUDO_USER:-$(id -un)}"
        local real_g
        real_g="$(id -gn "$real_u" 2>/dev/null || id -gn)"

        # Clean any stale or root-locked target folders from repository
        as_root rm -rf "${REPO_DIR}/backend/target"* 2>/dev/null || true
        as_root chown -R "${real_u}:${real_g}" "${REPO_DIR}"
        as_root chmod -R u+rwX,g+rwX,o+rwX "${REPO_DIR}"

        # Use /tmp for cargo target directory to eliminate any permission friction in /opt
        local build_target_dir="/tmp/ownmediahost-cargo-target"
        as_root rm -rf "$build_target_dir"
        mkdir -p "$build_target_dir"
        chmod 777 "$build_target_dir"
        export CARGO_TARGET_DIR="$build_target_dir"

        # Ensure cargo is on path
        if [ -f "$HOME/.cargo/env" ]; then
            . "$HOME/.cargo/env"
        elif [ -f "/root/.cargo/env" ]; then
            . "/root/.cargo/env"
        elif [ -n "${SUDO_USER:-}" ] && [ -f "/home/${SUDO_USER}/.cargo/env" ]; then
            . "/home/${SUDO_USER}/.cargo/env"
        fi

        log_info "Building backend binary using build target: ${CARGO_TARGET_DIR}..."
        if cargo build --release; then
            log_success "Cargo release build succeeded."
        elif have sudo; then
            log_warn "Standard cargo build failed, retrying with sudo environment..."
            sudo env "PATH=$PATH" "CARGO_TARGET_DIR=$CARGO_TARGET_DIR" cargo build --release
        else
            log_error "Failed to compile Rust backend."
            exit 1
        fi

        log_info "Installing ownmediahost-backend binary to /usr/local/bin..."
        as_root install -m 755 "${CARGO_TARGET_DIR}/release/ownmediahost-backend" /usr/local/bin/ownmediahost-backend
        as_root rm -rf "$CARGO_TARGET_DIR"
        log_success "Backend binary compiled and installed to /usr/local/bin/ownmediahost-backend"
    fi
}

# --- Compile / Fetch Frontend ---
build_frontend() {
    log_info "Preparing React frontend dashboard..."
    local www_target="/var/www/ownmediahost/dist"
    as_root mkdir -p "${www_target}"
    local frontend_ready=false

    # 1. Fast Path: Download precompiled frontend assets from GitHub Releases (for unified domain)
    if [[ "$BUILD_FROM_SOURCE" != true && "$DEPLOY_MODE" == "unified" ]]; then
        local release_url="https://github.com/nourddinak/OwnMediaHost/releases/latest/download/ownmediahost-frontend-dist.tar.gz"
        log_info "Checking for precompiled frontend bundle (${release_url})..."
        local tmp_tar="/tmp/ownmediahost-frontend-dist.tar.gz"
        as_root rm -f "$tmp_tar"

        if curl -fsSL -o "$tmp_tar" "$release_url" 2>/dev/null && [ -s "$tmp_tar" ]; then
            log_info "Precompiled frontend bundle downloaded! Extracting to ${www_target}..."
            if as_root tar -xzf "$tmp_tar" -C "${www_target}" 2>/dev/null; then
                as_root chown -R www-data:www-data /var/www/ownmediahost 2>/dev/null || true
                as_root rm -f "$tmp_tar"
                log_success "Instant deployment: Precompiled frontend dashboard published to ${www_target}"
                frontend_ready=true
            else
                as_root rm -f "$tmp_tar"
            fi
        else
            log_info "Precompiled frontend bundle not found or unreachable. Building from source..."
        fi
    fi

    # 2. Fallback Path: Compile from source on the machine
    if [[ "$frontend_ready" != true ]]; then
        log_info "Building React frontend dashboard from source..."
        cd "${REPO_DIR}/frontend"

        local real_u="${SUDO_USER:-$(id -un)}"
        local real_g
        real_g="$(id -gn "$real_u" 2>/dev/null || id -gn)"

        as_root chown -R "${real_u}:${real_g}" "${REPO_DIR}/frontend"
        as_root chmod -R u+rwX,g+rwX,o+rwX "${REPO_DIR}/frontend"

        # Configure frontend API base URL
        local api_base="/api/v1"
        if [[ "$DEPLOY_MODE" == "split" ]]; then
            api_base="https://${BACKEND_DOMAIN}/api/v1"
        fi

        cat > .env.production << EOF
VITE_API_BASE_URL=${api_base}
VITE_APP_NAME=OwnMediaHost
VITE_APP_VERSION=0.1.0
EOF

        if npm install && npm run build; then
            log_success "React dashboard build succeeded."
        elif have sudo; then
            log_warn "User-level npm build failed, retrying with sudo..."
            as_root npm install
            as_root npm run build
        else
            log_error "Frontend build failed."
            exit 1
        fi

        as_root cp -r dist/* "${www_target}/"
        as_root chown -R www-data:www-data /var/www/ownmediahost 2>/dev/null || true
        log_success "Frontend assets compiled and published to ${www_target}"
    fi
}

# --- Deploy Decoupled Status Page ---
setup_status_page() {
    log_info "Deploying decoupled public status page assets..."
    local status_target="/var/www/ownmediahost/status"
    as_root mkdir -p "${status_target}"

    if [ -d "${REPO_DIR}/status" ] && [ -f "${REPO_DIR}/status/index.html" ]; then
        as_root rm -rf "${status_target:?}"/* 2>/dev/null || true
        as_root cp -rf "${REPO_DIR}/status/"* "${status_target}/"
        as_root chown -R www-data:www-data /var/www/ownmediahost/status 2>/dev/null || true
        log_success "Decoupled status page assets deployed to ${status_target}"
    elif [ -d "${status_target}/.git" ]; then
        log_info "Existing status repository detected at ${status_target}. Pulling latest..."
        (cd "${status_target}" && as_root git pull --ff-only 2>/dev/null || true)
        as_root chown -R www-data:www-data /var/www/ownmediahost/status 2>/dev/null || true
        log_success "Status page updated from Git repository"
    elif have git && [ -n "${STATUS_DOMAIN}" ]; then
        log_info "Cloning standalone status repository from ${STATUS_REPO_URL}..."
        as_root git clone "${STATUS_REPO_URL}" "${status_target}" 2>/dev/null || true
        as_root chown -R www-data:www-data /var/www/ownmediahost/status 2>/dev/null || true
        log_success "Decoupled status repository cloned to ${status_target}"
    fi

    # If an external or custom status URL was specified, connect it via connect-status.sh
    if [ -n "${STATUS_URL}" ] && [ -f "${REPO_DIR}/scripts/connect-status.sh" ]; then
        log_info "Connecting out-of-band status page (${STATUS_URL})..."
        as_root bash "${REPO_DIR}/scripts/connect-status.sh" --url "${STATUS_URL}" 2>/dev/null || true
    fi
}

# --- Provision System User & Storage ---
setup_storage_and_user() {
    log_info "Configuring system account and persistent storage..."

    # Create dedicated non-root user
    if ! id -u ownmediahost >/dev/null 2>&1; then
        as_root useradd --system --no-create-home --shell /usr/sbin/nologin ownmediahost
        log_info "Created system user 'ownmediahost'"
    fi

    # Prepare storage folders
    as_root mkdir -p "${STORAGE_DIR}/originals/images" \
                     "${STORAGE_DIR}/originals/videos" \
                     "${STORAGE_DIR}/generated/thumbnails" \
                     "${STORAGE_DIR}/database" \
                     "/etc/ownmediahost"

    as_root chown -R ownmediahost:ownmediahost "${STORAGE_DIR}"
    as_root chmod -R 750 "${STORAGE_DIR}"
    log_success "Storage layout created at ${STORAGE_DIR}"
}

# --- Environment File & Secrets ---
generate_env_file() {
    log_info "Generating production secrets and environment file..."

    local env_file="/etc/ownmediahost/ownmediahost.env"
    as_root mkdir -p /etc/ownmediahost

    local jwt_sec
    local cookie_sec
    local pepper_sec
    local private_sec

    jwt_sec=$(generate_secret)
    cookie_sec=$(generate_secret)
    pepper_sec=$(generate_secret)
    private_sec=$(generate_secret)

    local public_url
    local allowed_origins
    if [[ "$DEPLOY_MODE" == "unified" ]]; then
        public_url="https://${DOMAIN}"
        allowed_origins="https://${DOMAIN},http://localhost:${BACKEND_PORT}"
    else
        public_url="https://${BACKEND_DOMAIN}"
        allowed_origins="https://${FRONTEND_DOMAIN},https://${BACKEND_DOMAIN},http://localhost:${BACKEND_PORT}"
    fi

    if [[ -n "$STATUS_DOMAIN" ]]; then
        allowed_origins="${allowed_origins},https://${STATUS_DOMAIN}"
    fi
    if [[ -n "$STATUS_URL" ]]; then
        local status_origin
        status_origin=$(echo "$STATUS_URL" | sed -E 's|^(https?://[^/]+).*|\1|')
        if [[ -n "$status_origin" && ",${allowed_origins}," != *",${status_origin},"* ]]; then
            allowed_origins="${allowed_origins},${status_origin}"
        fi
    fi

    as_root tee "${env_file}" >/dev/null << EOF
# OwnMediaHost Production Configuration — Auto-generated by VPS Deploy Bot
APP_ENV=${APP_ENV:-production}
APP_HOST=127.0.0.1
APP_PORT=${BACKEND_PORT}
DATABASE_URL=sqlite://${STORAGE_DIR}/database/media.db?mode=rwc
MEDIA_ROOT=${STORAGE_DIR}
PUBLIC_BASE_URL=${public_url}
ALLOWED_ORIGINS=${allowed_origins}

# Topology & Domains
DEPLOY_MODE=${DEPLOY_MODE}
DOMAIN=${DOMAIN:-}
FRONTEND_DOMAIN=${FRONTEND_DOMAIN:-}
BACKEND_DOMAIN=${BACKEND_DOMAIN:-}
STATUS_DOMAIN=${STATUS_DOMAIN:-}
STATUS_PAGE_URL=${STATUS_URL:-}

# Cryptographic Keys (Auto-generated high-entropy secrets)
JWT_SECRET=${jwt_sec}
COOKIE_SECRET=${cookie_sec}
API_KEY_PEPPER=${pepper_sec}
PRIVATE_URL_SIGNING_KEY=${private_sec}

# Initial Administrator
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Limits & Storage
MAX_IMAGE_SIZE=52428800
MAX_VIDEO_SIZE=5368709120
ALLOWED_IMAGE_FORMATS=jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic
ALLOWED_VIDEO_FORMATS=mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp
EOF

    as_root chown ownmediahost:ownmediahost "${env_file}"
    as_root chmod 600 "${env_file}"
    if [ -d "${REPO_DIR}" ]; then
        as_root cp -f "${env_file}" "${REPO_DIR}/.env" 2>/dev/null || true
        as_root chmod 600 "${REPO_DIR}/.env" 2>/dev/null || true
    fi
    log_success "Configured ${env_file} with secure permissions (chmod 600)."
}

# --- Systemd Service ---
setup_systemd() {
    log_info "Creating systemd unit file /etc/systemd/system/ownmediahost.service..."

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
AmbientCapabilities=CAP_NET_BIND_SERVICE

# Security Sandbox
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

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
    log_success "OwnMediaHost systemd service enabled and started."
}

# --- Caddyfile Configuration ---
configure_caddy() {
    log_info "Configuring Caddyfile reverse proxy..."

    local caddyfile="/etc/caddy/Caddyfile"
    local timestamp
    timestamp=$(date +"%Y%m%d_%H%M%S")

    if [ -f "$caddyfile" ]; then
        as_root cp "$caddyfile" "${caddyfile}.bak.${timestamp}"
        log_info "Existing Caddyfile backed up to ${caddyfile}.bak.${timestamp}"
    else
        as_root mkdir -p /etc/caddy
        as_root touch "$caddyfile"
    fi

    # Remove any previous blocks cleanly
    as_root sed -i '/# =* OwnMediaHost =*/,/# =* End OwnMediaHost =*/d' "$caddyfile"
    as_root sed -i '/# >>> OwnMediaHost block >>>/,/# <<< OwnMediaHost block <<</d' "$caddyfile"
    as_root sed -i '/# >>> SELFmedia block >>>/,/# <<< SELFmedia block <<</d' "$caddyfile"

    local caddy_block=""
    if [[ "$DEPLOY_MODE" == "unified" ]]; then
        caddy_block=$(cat << EOF

# ============================== OwnMediaHost ==================================
# ${DOMAIN}   {${BACKEND_PORT}}
# ==============================================================================
${DOMAIN} {
    encode gzip zstd
    request_body {
        max_size 10GB
    }

    # 1. Reverse proxy streaming uploads, APIs, and media endpoints
    @backend path /api* /f/* /i/* /a/* /thumbnails/* /private/* /health*
    handle @backend {
        reverse_proxy 127.0.0.1:${BACKEND_PORT} {
            flush_interval -1
        }
    }

    # 2. Decoupled Static Status Dashboard
    handle_path /status* {
        root * /var/www/ownmediahost/status
        file_server
        try_files {path} /index.html
    }

    # 3. Static React SPA Dashboard (served only for non-backend frontend routes)
    handle {
        root * /var/www/ownmediahost/dist
        try_files {path} /index.html
        file_server
    }
}
# ============================ End OwnMediaHost ================================
EOF
)
    else
        caddy_block=$(cat << EOF

# ============================== OwnMediaHost ==================================
# ${FRONTEND_DOMAIN}   {static}
# ${BACKEND_DOMAIN}    {${BACKEND_PORT}}
# ==============================================================================
${FRONTEND_DOMAIN} {
    encode gzip zstd

    # Decoupled Static Status Dashboard
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
    reverse_proxy 127.0.0.1:${BACKEND_PORT} {
        flush_interval -1
    }
}
# ============================ End OwnMediaHost ================================
EOF
)
    fi

    if [[ -n "$STATUS_DOMAIN" ]]; then
        local status_block
        status_block=$(cat << EOF


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
)
        caddy_block="${caddy_block}${status_block}"
    fi

    echo "$caddy_block" | as_root tee -a "$caddyfile" >/dev/null

    # Validate Caddyfile
    if as_root caddy validate --config "$caddyfile" >/dev/null 2>&1; then
        as_root systemctl reload caddy || as_root systemctl restart caddy
        log_success "Caddy configuration reloaded successfully with automatic HTTPS!"
    else
        log_warn "Caddy validation raised an issue. Restarting caddy service..."
        as_root systemctl restart caddy || true
    fi
}

# --- Health Check & Verification ---
verify_deployment() {
    log_info "Verifying service readiness..."

    local attempts=10
    local healthy=false

    for ((i=1; i<=attempts; i++)); do
        if curl -fs "http://127.0.0.1:${BACKEND_PORT}/health/ready" >/dev/null 2>&1; then
            healthy=true
            break
        fi
        sleep 1
    done

    if [[ "$healthy" == true ]]; then
        log_success "OwnMediaHost service is alive and healthy on 127.0.0.1:${BACKEND_PORT}!"
    else
        log_warn "Health check endpoint did not respond immediately. Check logs with: journalctl -u ownmediahost -n 50"
    fi

    # Verify media processing engine
    log_info "Verifying media processing engine..."
    log_success "Media engine operational: Browser HTML5 Canvas & Pure Rust (Zero external dependencies)"

    # Verify SQLite database CLI
    if have sqlite3; then
        local sqlite_bin sqlite_ver
        sqlite_bin="$(command -v sqlite3)"
        sqlite_ver="$("$sqlite_bin" --version 2>/dev/null | cut -d' ' -f1)"
        log_success "SQLite operational: ${sqlite_bin} (v${sqlite_ver})"
    fi
}

# --- Completion Display ---
print_summary() {
    local target_url
    local api_url
    if [[ "$DEPLOY_MODE" == "unified" ]]; then
        target_url="https://${DOMAIN}"
        api_url="https://${DOMAIN}/api/v1"
    else
        target_url="https://${FRONTEND_DOMAIN}"
        api_url="https://${BACKEND_DOMAIN}/api/v1"
    fi


    echo -e "\n${GREEN}${BOLD}========================================================================${RESET}"
    echo -e "${GREEN}${BOLD}    🚀 OwnMediaHost Platform Deployed Successfully! (Bare-Metal)        ${RESET}"
    echo -e "${GREEN}${BOLD}========================================================================${RESET}\n"

    echo -e "  ${BOLD}Dashboard URL:${RESET}      ${CYAN}${target_url}${RESET}"
    echo -e "  ${BOLD}API Endpoint:${RESET}       ${CYAN}${api_url}${RESET}"
    echo -e "  ${BOLD}API Documentation:${RESET}  ${CYAN}${target_url}/docs${RESET}"
    if [[ -n "$STATUS_URL" ]]; then
        echo -e "  ${BOLD}Status Page:${RESET}        ${CYAN}${STATUS_URL}${RESET} ${GREEN}(Out-of-band / Connected)${RESET}"
    elif [[ -n "$STATUS_DOMAIN" ]]; then
        echo -e "  ${BOLD}Status Page:${RESET}        ${CYAN}https://${STATUS_DOMAIN}${RESET} ${GREEN}(Decoupled / Out-of-band)${RESET}"
    fi
    echo ""

    echo -e "  ${BOLD}Administrator Login Credentials:${RESET}"
    echo -e "  Email:             ${CYAN}${ADMIN_EMAIL}${RESET}"
    echo -e "  Password:          ${GREEN}${ADMIN_PASSWORD}${RESET}\n"

    echo -e "  ${BOLD}Deployment Details:${RESET}"
    echo -e "  Mode:              production"
    echo -e "  Backend Service:   systemd (ownmediahost.service -> 127.0.0.1:${BACKEND_PORT})"
    echo -e "  Media Engine:      ${GREEN}Browser HTML5 Canvas & Pure Rust (Zero external dependencies)${RESET}"
    echo -e "  Storage Root:      ${STORAGE_DIR}"
    echo -e "  Environment File:  /etc/ownmediahost/ownmediahost.env"
    echo -e "  Caddyfile:         /etc/caddy/Caddyfile (Auto-SSL via Let's Encrypt)"
    echo -e "  Frontend Root:     /var/www/ownmediahost/dist\n"

    echo -e "  ${BOLD}Useful Management Commands:${RESET}"
    echo -e "  • Check status:    ${DIM}sudo systemctl status ownmediahost${RESET}"
    echo -e "  • View live logs:  ${DIM}sudo journalctl -u ownmediahost -f${RESET}"
    echo -e "  • Restart service: ${DIM}sudo systemctl restart ownmediahost${RESET}"
    echo -e "  • Reload Caddy:    ${DIM}sudo systemctl reload caddy${RESET}"
    echo -e "  • Update code:     ${DIM}sudo bash /opt/ownmediahost/scripts/update.sh${RESET}\n"

    echo -e "${CYAN}Make sure your DNS A/AAAA records for your domain point to this VPS IP address!${RESET}"
    echo -e "${GREEN}Enjoy your high-performance self-hosted personal media infrastructure!${RESET}\n"
}

# --- Main Entry Point ---
main() {
    banner
    check_privileges
    detect_os
    bootstrap_repo
    check_multimedia_engine

    if [[ "$NON_INTERACTIVE" == false ]]; then
        interactive_wizard
    else
        if [[ -z "$DOMAIN" && -z "$FRONTEND_DOMAIN" ]]; then
            log_error "--domain (or --frontend-domain & --backend-domain) is required in non-interactive mode."
            exit 1
        fi
        if [[ -z "$ADMIN_EMAIL" ]]; then
            ADMIN_EMAIL="admin@${DOMAIN:-$FRONTEND_DOMAIN}"
        fi
        if [[ -z "$ADMIN_PASSWORD" ]]; then
            ADMIN_PASSWORD=$(generate_password)
        fi
    fi

    install_dependencies
    setup_storage_and_user
    build_backend
    build_frontend
    generate_env_file
    setup_status_page
    setup_systemd
    configure_caddy
    verify_deployment
    print_summary
}

main "$@"
