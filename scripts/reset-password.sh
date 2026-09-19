#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost — Admin Credential Viewer & Password Reset Tool
#
# USAGE:
#   1. View current credentials:
#      sudo bash /opt/ownmediahost/scripts/reset-password.sh
#
#   2. Set a new password:
#      sudo bash /opt/ownmediahost/scripts/reset-password.sh "YourNewPassword123"
# ==============================================================================

set -euo pipefail

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ENV_FILE="/etc/ownmediahost/ownmediahost.env"
if [ ! -f "$ENV_FILE" ]; then
    if [ -f "/etc/selfmedia/selfmedia.env" ]; then
        ENV_FILE="/etc/selfmedia/selfmedia.env"
    elif [ -f "/opt/ownmediahost/.env" ]; then
        ENV_FILE="/opt/ownmediahost/.env"
    elif [ -f "/opt/selfmedia/.env" ]; then
        ENV_FILE="/opt/selfmedia/.env"
    elif [ -f "./.env" ]; then
        ENV_FILE="./.env"
    elif [ -f "$(dirname "$0")/../.env" ]; then
        ENV_FILE="$(dirname "$0")/../.env"
    else
        mkdir -p /etc/ownmediahost
        if [ -f "/opt/ownmediahost/.env.example" ]; then
            cp -f "/opt/ownmediahost/.env.example" /etc/ownmediahost/ownmediahost.env
            chmod 600 /etc/ownmediahost/ownmediahost.env
            chown ownmediahost:ownmediahost /etc/ownmediahost/ownmediahost.env 2>/dev/null || true
            ENV_FILE="/etc/ownmediahost/ownmediahost.env"
        elif [ -f "/opt/selfmedia/.env.example" ]; then
            cp -f "/opt/selfmedia/.env.example" /etc/ownmediahost/ownmediahost.env
            chmod 600 /etc/ownmediahost/ownmediahost.env
            chown ownmediahost:ownmediahost /etc/ownmediahost/ownmediahost.env 2>/dev/null || true
            ENV_FILE="/etc/ownmediahost/ownmediahost.env"
        fi
    fi
fi

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}${BOLD}[ERROR]${RESET} Environment file not found at ${ENV_FILE} or /opt/ownmediahost/.env" >&2
    exit 1
fi

CURRENT_EMAIL=$(grep "^ADMIN_EMAIL=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' || echo "admin@ownmediahost.local")
CURRENT_PASS=$(grep "^ADMIN_PASSWORD=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' || echo "")

NEW_PASS="${1:-}"

if [ -n "$NEW_PASS" ]; then
    # Update password in env file
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${NEW_PASS}|" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    chown ownmediahost:ownmediahost "$ENV_FILE" 2>/dev/null || chown selfmedia:selfmedia "$ENV_FILE" 2>/dev/null || true

    echo -e "${CYAN}${BOLD}[INFO]${RESET} Restarting service to sync database credentials..."
    if systemctl is-active --quiet ownmediahost 2>/dev/null || systemctl is-enabled --quiet ownmediahost 2>/dev/null; then
        systemctl restart ownmediahost
    elif systemctl is-active --quiet selfmedia 2>/dev/null || systemctl is-enabled --quiet selfmedia 2>/dev/null; then
        systemctl restart selfmedia
    fi

    echo -e "\n${GREEN}${BOLD}========================================================================${RESET}"
    echo -e "${GREEN}${BOLD}     ✓ OwnMediaHost Administrator Password Updated Successfully!        ${RESET}"
    echo -e "${GREEN}${BOLD}========================================================================${RESET}"
    echo -e "  Admin Email:    ${CYAN}${CURRENT_EMAIL}${RESET}"
    echo -e "  Admin Password: ${GREEN}${NEW_PASS}${RESET}\n"
else
    echo -e "\n${BOLD}=== OwnMediaHost Administrator Credentials ===${RESET}"
    echo -e "  Admin Email:    ${CYAN}${CURRENT_EMAIL}${RESET}"
    echo -e "  Admin Password: ${GREEN}${CURRENT_PASS}${RESET}"
    echo -e "\n${DIM}To change the password, run:${RESET}"
    echo -e "  ${CYAN}sudo bash $0 \"YourNewPassword\"${RESET}\n"
fi
