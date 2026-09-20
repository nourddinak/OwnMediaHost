#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost Restore Utility
# Restores database, configuration secrets, and media assets from a backup folder.
# ==============================================================================

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path-to-backup-dir>"
    echo "Example: $0 ./backups/ownmediahost_backup_20260919_120000"
    exit 1
fi

BACKUP_DIR="$1"

if [ ! -d "${BACKUP_DIR}" ]; then
    echo "Error: Backup directory ${BACKUP_DIR} not found!"
    exit 1
fi

# Auto-detect media storage root directory
MEDIA_DIR="${MEDIA_ROOT:-}"
if [ -z "$MEDIA_DIR" ]; then
    if [ -f /etc/ownmediahost/ownmediahost.env ]; then
        MEDIA_DIR=$(grep "^MEDIA_ROOT=" /etc/ownmediahost/ownmediahost.env 2>/dev/null | cut -d= -f2- | tr -d '\r"' || echo "")
    fi
fi
if [ -z "$MEDIA_DIR" ]; then
    if [ -d "/var/lib/ownmediahost/storage" ]; then
        MEDIA_DIR="/var/lib/ownmediahost/storage"
    else
        MEDIA_DIR="./storage"
    fi
fi

echo "[*] Target storage directory: ${MEDIA_DIR}"
echo "[!] CAUTION: Restoring will overwrite existing database and media files."
read -p "Are you sure you want to proceed with restore? (y/N): " CONFIRM
if [[ "${CONFIRM}" != [yY] && "${CONFIRM}" != [yY][eE][sS] ]]; then
    echo "Restore cancelled."
    exit 0
fi

# 1. Restore Database
if [ -f "${BACKUP_DIR}/media.db" ]; then
    echo "[*] Restoring database to ${MEDIA_DIR}/database/media.db..."
    mkdir -p "${MEDIA_DIR}/database"
    cp "${BACKUP_DIR}/media.db" "${MEDIA_DIR}/database/media.db"
    echo "[✓] Database restored."
fi

# 2. Restore Originals
if [ -f "${BACKUP_DIR}/originals.tar.gz" ]; then
    echo "[*] Extracting media originals to ${MEDIA_DIR}..."
    mkdir -p "${MEDIA_DIR}"
    tar -xzf "${BACKUP_DIR}/originals.tar.gz" -C "${MEDIA_DIR}"
    echo "[✓] Originals restored."
fi

# 3. Restore Environment Configuration if present
if [ -f "${BACKUP_DIR}/ownmediahost.env.backup" ]; then
    if [ -d "/etc/ownmediahost" ]; then
        echo "[*] Restoring environment configuration to /etc/ownmediahost/ownmediahost.env..."
        cp "${BACKUP_DIR}/ownmediahost.env.backup" "/etc/ownmediahost/ownmediahost.env"
        chmod 600 "/etc/ownmediahost/ownmediahost.env" 2>/dev/null || true
        echo "[✓] Environment configuration restored."
    elif [ -f "./.env" ] || [ -f "./Cargo.toml" ]; then
        echo "[*] Restoring environment configuration to ./.env..."
        cp "${BACKUP_DIR}/ownmediahost.env.backup" "./.env"
        chmod 600 "./.env" 2>/dev/null || true
        echo "[✓] Environment configuration restored."
    fi
fi

# 4. Permissions check for dedicated service user
if id "ownmediahost" >/dev/null 2>&1; then
    chown -R ownmediahost:ownmediahost "${MEDIA_DIR}" 2>/dev/null || true
fi

echo "[✓] Restore completed successfully!"
echo "If running as a systemd service, restart with: sudo systemctl restart ownmediahost"
