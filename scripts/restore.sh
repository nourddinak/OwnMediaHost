#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost Restore Utility
# Restores database and media assets from a backup folder.
# ==============================================================================

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path-to-backup-dir>"
    echo "Example: $0 ./backups/ownmediahost_backup_20260919_120000"
    exit 1
fi

BACKUP_DIR="$1"
MEDIA_DIR="${MEDIA_ROOT:-./storage}"

if [ ! -d "${BACKUP_DIR}" ]; then
    echo "Error: Backup directory ${BACKUP_DIR} not found!"
    exit 1
fi

echo "[!] CAUTION: Restoring will overwrite the current database and media files."
read -p "Are you sure you want to proceed? (y/N): " CONFIRM
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
    echo "[*] Extracting media originals..."
    mkdir -p "${MEDIA_DIR}"
    tar -xzf "${BACKUP_DIR}/originals.tar.gz" -C "${MEDIA_DIR}"
    echo "[✓] Originals restored."
fi

echo "[✓] Restore completed successfully!"
