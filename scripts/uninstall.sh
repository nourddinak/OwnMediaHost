#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost — Bare-Metal Uninstaller
# Completely removes services, reverse proxy rules, binaries, and configs.
#
# QUICK 1-LINER:
#   bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)
#
# LOCAL:
#   sudo bash /opt/ownmediahost/scripts/uninstall.sh [options]
#
# OPTIONS:
#   --purge              Purge all media files, uploads, and SQLite database
#   --keep-data          Preserve media files and database (default)
#   --delete-repo        Delete source repository directory (/opt/ownmediahost)
#   --keep-repo          Preserve source repository directory (default)
#   --non-interactive, -y Run without interactive confirmation
# ==============================================================================

set -euo pipefail

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
DIM="\033[2m"
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
        log_error "Root privileges required for: $*"
        exit 1
    fi
}

# --- Check Privileges ---
if [ "$(id -u)" -ne 0 ]; then
    if have sudo; then
        if ! sudo -n true 2>/dev/null; then
            log_info "Sudo password required for uninstallation..."
            if [ -e /dev/tty ]; then
                sudo -v </dev/tty || { log_error "Failed to authenticate sudo credentials."; exit 1; }
            else
                sudo -v || { log_error "Failed to authenticate sudo credentials."; exit 1; }
            fi
        fi
    else
        log_error "Please run with root privileges or sudo: sudo bash $0"
        exit 1
    fi
fi

# --- CLI Options ---
PURGE_DATA=""
DELETE_REPO=""
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge|--delete-data)
            PURGE_DATA=true
            shift
            ;;
        --keep-data)
            PURGE_DATA=false
            shift
            ;;
        --delete-repo)
            DELETE_REPO=true
            shift
            ;;
        --keep-repo)
            DELETE_REPO=false
            shift
            ;;
        --non-interactive|-y)
            NON_INTERACTIVE=true
            shift
            ;;
        --help|-h)
            echo "Usage: sudo bash $0 [options]"
            echo ""
            echo "Options:"
            echo "  --purge, --delete-data    Delete persistent media storage & databases"
            echo "  --keep-data               Preserve media storage (default)"
            echo "  --delete-repo             Remove git repository (/opt/ownmediahost)"
            echo "  --keep-repo               Preserve git repository"
            echo "  --non-interactive, -y     Skip interactive confirmation prompts"
            exit 0
            ;;
        *)
            log_warn "Unknown argument: $1"
            shift
            ;;
    esac
done

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

# --- Detect Storage & Installation Paths ---
ENV_FILE="/etc/ownmediahost/ownmediahost.env"
STORAGE_DIR="/var/lib/ownmediahost"

if [ ! -f "$ENV_FILE" ] && [ -f "/etc/selfmedia/selfmedia.env" ]; then
    ENV_FILE="/etc/selfmedia/selfmedia.env"
    STORAGE_DIR="/var/lib/selfmedia"
fi

if [ -f "$ENV_FILE" ]; then
    DETECTED_MEDIA_ROOT=$(as_root grep "^MEDIA_ROOT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    if [ -n "$DETECTED_MEDIA_ROOT" ]; then
        STORAGE_DIR="$(dirname "$DETECTED_MEDIA_ROOT")"
    fi
fi

REPO_DIR="/opt/ownmediahost"
if [ ! -d "$REPO_DIR" ] && [ -d "/opt/selfmedia" ]; then
    REPO_DIR="/opt/selfmedia"
fi

if [ -n "${BASH_SOURCE[0]:-}" ] && [[ "${BASH_SOURCE[0]}" != *"/fd/"* ]] && [ -f "${BASH_SOURCE[0]}" ]; then
    CURRENT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${CURRENT_SCRIPT_DIR}/../backend/Cargo.toml" ]; then
        REPO_DIR="$(cd "${CURRENT_SCRIPT_DIR}/.." && pwd)"
    elif [ -f "${CURRENT_SCRIPT_DIR}/backend/Cargo.toml" ]; then
        REPO_DIR="${CURRENT_SCRIPT_DIR}"
    fi
fi

# --- Banner ---
echo -e "\n${RED}${BOLD}========================================================================${RESET}"
echo -e "${RED}${BOLD}            OwnMediaHost Platform Bare-Metal Uninstaller                ${RESET}"
echo -e "${RED}${BOLD}========================================================================${RESET}\n"

# --- Interactive Prompts ---
if [[ "$NON_INTERACTIVE" == false ]]; then
    echo -e "This utility will cleanly remove the OwnMediaHost service, Caddy reverse proxy"
    echo -e "configuration, web dashboard, and system binaries from this machine.\n"

    CONFIRM_UNINSTALL=""
    prompt_read "Are you sure you want to uninstall OwnMediaHost? [y/N]: " CONFIRM_UNINSTALL "N"
    if [[ "$CONFIRM_UNINSTALL" != [yY] && "$CONFIRM_UNINSTALL" != [yY][eE][sS] ]]; then
        log_info "Uninstallation cancelled by user."
        exit 0
    fi

    if [[ -z "$PURGE_DATA" ]]; then
        echo -e "\n${YELLOW}${BOLD}Persistent Media Storage & Database:${RESET} ${CYAN}${STORAGE_DIR}${RESET}"
        prompt_read "Do you want to PERMANENTLY DELETE all media files and the database? [y/N]: " PURGE_PROMPT "N"
        if [[ "$PURGE_PROMPT" == [yY] || "$PURGE_PROMPT" == [yY][eE][sS] ]]; then
            PURGE_DATA=true
        else
            PURGE_DATA=false
        fi
    fi

    if [[ -z "$DELETE_REPO" ]]; then
        echo -e "\n${YELLOW}${BOLD}Source Code Repository:${RESET} ${CYAN}${REPO_DIR}${RESET}"
        prompt_read "Do you want to delete the source code repository directory? [y/N]: " REPO_PROMPT "N"
        if [[ "$REPO_PROMPT" == [yY] || "$REPO_PROMPT" == [yY][eE][sS] ]]; then
            DELETE_REPO=true
        else
            DELETE_REPO=false
        fi
    fi
else
    # Defaults in non-interactive mode if not specified: preserve data and repo
    if [[ -z "$PURGE_DATA" ]]; then PURGE_DATA=false; fi
    if [[ -z "$DELETE_REPO" ]]; then DELETE_REPO=false; fi
fi

echo ""
log_info "Beginning uninstallation..."

# 1. Stop and Disable Systemd Service (both ownmediahost and legacy selfmedia)
for svc in ownmediahost selfmedia; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        log_info "Stopping systemd service (${svc}.service)..."
        as_root systemctl stop "$svc" || true
    fi
    if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
        as_root systemctl disable "$svc" || true
    fi
    if [ -f "/etc/systemd/system/${svc}.service" ]; then
        as_root rm -f "/etc/systemd/system/${svc}.service"
        as_root systemctl daemon-reload
        as_root systemctl reset-failed "$svc" 2>/dev/null || true
        log_success "Systemd service '${svc}' stopped and removed."
    fi
done

# 2. Clean Caddy Reverse Proxy Configuration
if [ -f /etc/caddy/Caddyfile ]; then
    log_info "Removing OwnMediaHost routing rules from /etc/caddy/Caddyfile..."
    # Create backup first
    as_root cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.uninstall.$(date +%s)"
    # Strip blocks
    as_root sed -i '/# >>> OwnMediaHost block >>>/,/# <<< OwnMediaHost block <<</d' /etc/caddy/Caddyfile
    as_root sed -i '/# >>> SELFmedia block >>>/,/# <<< SELFmedia block <<</d' /etc/caddy/Caddyfile

    if have caddy && as_root caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
        as_root systemctl reload caddy 2>/dev/null || as_root systemctl restart caddy 2>/dev/null || true
        log_success "Caddy configuration cleaned and reloaded."
    else
        log_warn "Caddyfile updated. Run 'sudo systemctl reload caddy' to apply."
    fi
fi

# 3. Remove Binary and Frontend Web Assets
log_info "Removing binaries and web dashboard..."
for bin in /usr/local/bin/ownmediahost-backend /usr/local/bin/selfmedia-backend; do
    if [ -f "$bin" ]; then
        as_root rm -f "$bin"
        log_success "Removed $bin"
    fi
done

for www in /var/www/ownmediahost /var/www/selfmedia; do
    if [ -d "$www" ]; then
        as_root rm -rf "$www"
        log_success "Removed $www"
    fi
done

# 4. Remove Environment File and Secrets
for conf in /etc/ownmediahost /etc/selfmedia; do
    if [ -d "$conf" ]; then
        log_info "Removing configuration: $conf..."
        as_root rm -rf "$conf"
        log_success "Removed $conf"
    fi
done

# 5. Handle Persistent Media Storage
if [[ "$PURGE_DATA" == true ]]; then
    log_warn "Purging persistent media storage: ${STORAGE_DIR}..."
    as_root rm -rf "${STORAGE_DIR}"
    as_root rm -rf /var/lib/ownmediahost /var/lib/selfmedia 2>/dev/null || true
    log_success "Persistent media storage and database purged."
else
    log_info "Persistent media storage PRESERVED at: ${STORAGE_DIR}"
fi

# 6. Remove Dedicated System User
for u in ownmediahost selfmedia; do
    if id "$u" >/dev/null 2>&1; then
        log_info "Removing dedicated system user '$u'..."
        as_root userdel "$u" 2>/dev/null || true
        as_root groupdel "$u" 2>/dev/null || true
        log_success "Removed system user '$u'."
    fi
done

# 7. Clean Temporary Build Files
log_info "Cleaning temporary build files..."
as_root rm -rf /tmp/ownmediahost* /tmp/selfmedia* 2>/dev/null || true

# 8. Source Repository Handling
if [[ "$DELETE_REPO" == true ]]; then
    if [ -d "$REPO_DIR" ]; then
        log_warn "Removing repository directory: ${REPO_DIR}..."
        cd /tmp
        as_root rm -rf "$REPO_DIR"
        log_success "Repository directory removed."
    fi
else
    log_info "Source repository preserved at: ${REPO_DIR}"
fi

echo -e "\n${GREEN}${BOLD}========================================================================${RESET}"
echo -e "${GREEN}${BOLD}            ✓ OwnMediaHost Successfully Uninstalled                     ${RESET}"
echo -e "${GREEN}${BOLD}========================================================================${RESET}"
if [[ "$PURGE_DATA" == false ]]; then
    echo -e "  ${YELLOW}Note:${RESET} Your media files and database were preserved at: ${CYAN}${STORAGE_DIR}${RESET}"
    echo -e "  To delete them later manually: ${DIM}sudo rm -rf ${STORAGE_DIR}${RESET}\n"
else
    echo -e "  ${YELLOW}Note:${RESET} All media files and databases were completely wiped.\n"
fi
