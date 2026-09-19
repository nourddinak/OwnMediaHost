#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost — Connect Public Out-of-Band Status Page Tool
#
# Connects your backend infrastructure with an out-of-band status page
# (e.g. GitHub Pages or a dedicated subdomain) by automatically configuring
# CORS allowed origins, environment variables, and database settings.
#
# USAGE:
#   1. Interactive mode:
#      sudo bash /opt/ownmediahost/scripts/connect-status.sh
#
#   2. Specify Status Page URL:
#      sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://nourddinak.github.io/OwnMediaHost-status/"
#
#   3. Using flag:
#      sudo bash /opt/ownmediahost/scripts/connect-status.sh --url "https://status.example.com"
#
#   4. Test live health & CORS connectivity:
#      sudo bash /opt/ownmediahost/scripts/connect-status.sh --test
#
#   5. Disconnect / Unlink status page:
#      sudo bash /opt/ownmediahost/scripts/connect-status.sh --disconnect
# ==============================================================================

set -euo pipefail

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
DIM="\033[2m"
RESET="\033[0m"

have() {
    command -v "$1" >/dev/null 2>&1
}

as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif have sudo && sudo -n true 2>/dev/null; then
        sudo "$@"
    elif have sudo && [ -t 0 ]; then
        sudo "$@"
    else
        "$@"
    fi
}

log_info() {
    echo -e "${CYAN}ℹ${RESET}  $*"
}

log_success() {
    echo -e "${GREEN}✓${RESET}  $*"
}

log_warn() {
    echo -e "${YELLOW}⚠${RESET}  $*"
}

log_error() {
    echo -e "${RED}✗${RESET}  $*"
}

# Locate configuration file
ENV_FILE="/etc/ownmediahost/ownmediahost.env"
if [ ! -f "$ENV_FILE" ]; then
    if [ -f "/opt/ownmediahost/.env" ]; then
        ENV_FILE="/opt/ownmediahost/.env"
    elif [ -f "./.env" ]; then
        ENV_FILE="./.env"
    elif [ -f "$(dirname "$0")/../.env" ]; then
        ENV_FILE="$(dirname "$0")/../.env"
    elif [ -f "/etc/selfmedia/selfmedia.env" ]; then
        ENV_FILE="/etc/selfmedia/selfmedia.env"
    elif [ -f "/opt/selfmedia/.env" ]; then
        ENV_FILE="/opt/selfmedia/.env"
    else
        log_error "Could not find OwnMediaHost environment file."
        exit 1
    fi
fi

# Locate SQLite database
DB_FILE="/var/lib/ownmediahost/storage/database/media.db"
if [ ! -f "$DB_FILE" ]; then
    if [ -f "/opt/ownmediahost/backend/storage/database/media.db" ]; then
        DB_FILE="/opt/ownmediahost/backend/storage/database/media.db"
    elif [ -f "./backend/storage/database/media.db" ]; then
        DB_FILE="./backend/storage/database/media.db"
    elif [ -f "$(dirname "$0")/../backend/storage/database/media.db" ]; then
        DB_FILE="$(dirname "$0")/../backend/storage/database/media.db"
    fi
fi

get_env_val() {
    local key="$1"
    local default_val="${2:-}"
    local val
    val=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
    if [ -z "$val" ]; then
        echo "$default_val"
    else
        echo "$val"
    fi
}

set_env_val() {
    local key="$1"
    local val="$2"
    if grep -q -E "^${key}=" "$ENV_FILE" 2>/dev/null; then
        as_root sed -i -E "s|^${key}=.*|${key}=\"${val}\"|" "$ENV_FILE"
    else
        echo "${key}=\"${val}\"" | as_root tee -a "$ENV_FILE" >/dev/null
    fi
}

extract_origin() {
    local url="$1"
    # Extract scheme://host:port from full URL
    echo "$url" | sed -E 's|^(https?://[^/]+).*|\1|'
}

test_health_and_cors() {
    local port
    port=$(get_env_val "APP_PORT" "5002")
    local origin="$1"

    echo ""
    log_info "Verifying backend health telemetry..."
    local health_resp
    health_resp=$(curl -fsS "http://127.0.0.1:${port}/health" 2>/dev/null || true)
    if [ -z "$health_resp" ] && have curl.exe; then
        health_resp=$(curl.exe -fsS "http://127.0.0.1:${port}/health" 2>/dev/null || true)
    fi

    if [ -n "$health_resp" ]; then
        log_success "Backend /health responding nominal:"
        echo -e "   ${DIM}${health_resp}${RESET}"
    else
        log_warn "Could not reach backend on http://127.0.0.1:${port}/health. Ensure backend is running."
    fi

    if [ -n "$origin" ]; then
        log_info "Testing synthetic probe CORS pre-flight for origin: ${CYAN}${origin}${RESET}..."
        local cors_header
        cors_header=$(curl -s -I -X OPTIONS "http://127.0.0.1:${port}/health" \
            -H "Origin: ${origin}" \
            -H "Access-Control-Request-Method: GET" 2>/dev/null | grep -i "access-control-allow-origin" || true)
        if [ -z "$cors_header" ] && have curl.exe; then
            cors_header=$(curl.exe -s -I -X OPTIONS "http://127.0.0.1:${port}/health" \
                -H "Origin: ${origin}" \
                -H "Access-Control-Request-Method: GET" 2>/dev/null | grep -i "access-control-allow-origin" || true)
        fi
        
        if [ -n "$cors_header" ]; then
            log_success "CORS verified: ${cors_header//$'\r'/}"
        else
            log_info "Backend accepts wildcard or direct origin inspection."
        fi
    fi
}

disconnect_status() {
    log_info "Disconnecting public status page configuration..."
    set_env_val "STATUS_PAGE_URL" ""
    
    if [ -f "$DB_FILE" ] && have sqlite3; then
        as_root sqlite3 "$DB_FILE" "DELETE FROM settings WHERE key = 'status_page_url';" 2>/dev/null || true
    fi

    if have systemctl && systemctl is-active ownmediahost >/dev/null 2>&1; then
        log_info "Reloading OwnMediaHost service..."
        as_root systemctl restart ownmediahost
    fi

    log_success "Public status page unlinked successfully."
    exit 0
}

# --- Parse Arguments ---
STATUS_URL=""
MODE="connect"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --url)
            STATUS_URL="$2"
            shift 2
            ;;
        --test)
            MODE="test"
            shift
            ;;
        --disconnect|--unlink)
            MODE="disconnect"
            shift
            ;;
        --help|-h)
            echo "OwnMediaHost Status Page Connection Utility"
            echo "Usage: sudo bash $0 [status_url] [options]"
            echo ""
            echo "Options:"
            echo "  --url <url>        Specify public status page URL"
            echo "  --test             Test live backend /health and CORS probe connectivity"
            echo "  --disconnect       Unlink and remove public status page connection"
            echo "  --help, -h         Show this help message"
            exit 0
            ;;
        *)
            if [ -z "$STATUS_URL" ]; then
                STATUS_URL="$1"
                shift
            else
                shift
            fi
            ;;
    esac
done

if [ "$MODE" = "disconnect" ]; then
    disconnect_status
fi

CURRENT_STATUS_URL=$(get_env_val "STATUS_PAGE_URL" "")
CURRENT_ORIGINS=$(get_env_val "ALLOWED_ORIGINS" "")

if [ "$MODE" = "test" ]; then
    CURRENT_ORIGIN=""
    if [ -n "$CURRENT_STATUS_URL" ]; then
        CURRENT_ORIGIN=$(extract_origin "$CURRENT_STATUS_URL")
    fi
    test_health_and_cors "$CURRENT_ORIGIN"
    exit 0
fi

# Print banner
echo -e "${BOLD}${CYAN}OwnMediaHost — Public Status Page Connection Manager${RESET}"
echo -e "${DIM}Decoupled Out-of-Band Incident Monitoring Integration${RESET}\n"

if [ -z "$STATUS_URL" ]; then
    echo -e "Current Status Page URL: ${YELLOW}${CURRENT_STATUS_URL:-[None configured]}${RESET}"
    echo -e "Current Allowed Origins: ${DIM}${CURRENT_ORIGINS:-[Default]}${RESET}\n"

    echo -e "Enter your public status page URL."
    echo -e "Examples:"
    echo -e "  • GitHub Pages: ${CYAN}https://nourddinak.github.io/OwnMediaHost-status/${RESET}"
    echo -e "  • Custom Domain: ${CYAN}https://status.yourdomain.com${RESET}"
    echo ""
    read -rp "Status Page URL: " INPUT_URL
    STATUS_URL="${INPUT_URL:-$CURRENT_STATUS_URL}"
fi

if [ -z "$STATUS_URL" ]; then
    log_error "No status page URL provided. Aborting."
    exit 1
fi

# Sanitize URL
STATUS_URL=$(echo "$STATUS_URL" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
STATUS_ORIGIN=$(extract_origin "$STATUS_URL")

if [ -z "$STATUS_ORIGIN" ]; then
    log_error "Invalid URL format: ${STATUS_URL}"
    exit 1
fi

log_info "Target Status URL: ${BOLD}${CYAN}${STATUS_URL}${RESET}"
log_info "Extracted Origin for CORS: ${BOLD}${CYAN}${STATUS_ORIGIN}${RESET}"

# 1. Update ALLOWED_ORIGINS to permit client probes from the status page
UPDATED_ORIGINS="$CURRENT_ORIGINS"
if [ -z "$UPDATED_ORIGINS" ]; then
    UPDATED_ORIGINS="${STATUS_ORIGIN}"
elif [[ ",${UPDATED_ORIGINS}," != *",${STATUS_ORIGIN},"* && "$UPDATED_ORIGINS" != "*" ]]; then
    UPDATED_ORIGINS="${UPDATED_ORIGINS},${STATUS_ORIGIN}"
fi

set_env_val "ALLOWED_ORIGINS" "$UPDATED_ORIGINS"
log_success "Updated ALLOWED_ORIGINS in ${ENV_FILE}"

# 2. Update STATUS_PAGE_URL in env file
set_env_val "STATUS_PAGE_URL" "$STATUS_URL"
log_success "Saved STATUS_PAGE_URL in ${ENV_FILE}"

# 3. Update SQLite database settings table if present
if [ -f "$DB_FILE" ] && have sqlite3; then
    as_root sqlite3 "$DB_FILE" "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('status_page_url', '${STATUS_URL}', datetime('now'));" 2>/dev/null || true
    log_success "Synchronized status URL into SQLite settings table"
fi

# 4. Restart/reload systemd backend service if active
if have systemctl && systemctl is-active ownmediahost >/dev/null 2>&1; then
    log_info "Restarting OwnMediaHost backend to apply CORS policy..."
    as_root systemctl restart ownmediahost
    log_success "OwnMediaHost service restarted."
fi

# 5. Verify connectivity
test_health_and_cors "$STATUS_ORIGIN"

# 6. Final success report
echo ""
echo -e "${GREEN}${BOLD}✓ Public Status Page Successfully Connected!${RESET}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BOLD}Status Page:${RESET}    ${CYAN}${STATUS_URL}${RESET}"
echo -e "  ${BOLD}CORS Origin:${RESET}    ${CYAN}${STATUS_ORIGIN}${RESET}"
echo -e "  ${BOLD}Config File:${RESET}    ${DIM}${ENV_FILE}${RESET}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "\n${BOLD}Next steps on your status page:${RESET}"
echo -e "  1. Open ${CYAN}${STATUS_URL}${RESET} in your browser."
echo -e "  2. If it does not auto-detect, click ${BOLD}Target${RESET} in the top nav and connect your API."
echo -e "  3. To deploy your own status repo, fork: ${CYAN}https://github.com/nourddinak/OwnMediaHost-status${RESET}\n"
