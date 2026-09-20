#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost Backup Utility
# Backs up database, configuration secrets, and media storage to a timestamped archive.
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_DIR="${BACKUP_DIR}/ownmediahost_backup_${TIMESTAMP}"

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

echo "[*] Starting OwnMediaHost backup to ${TARGET_DIR}..."
echo "[*] Using media storage root: ${MEDIA_DIR}"
mkdir -p "${TARGET_DIR}"

# 1. Atomic Database Backup (SQLite WAL mode safe)
DB_PATH="${MEDIA_DIR}/database/media.db"
if [ -f "${DB_PATH}" ]; then
    echo "[*] Creating atomic SQLite backup..."
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "${DB_PATH}" ".backup '${TARGET_DIR}/media.db'"
    else
        cp "${DB_PATH}" "${TARGET_DIR}/media.db"
    fi
    echo "[✓] Database backup completed: ${TARGET_DIR}/media.db"
else
    echo "[!] Warning: No database found at ${DB_PATH}"
fi

# 2. Media Originals Backup
ORIGINALS_DIR="${MEDIA_DIR}/originals"
if [ -d "${ORIGINALS_DIR}" ]; then
    echo "[*] Archiving media originals..."
    tar -czf "${TARGET_DIR}/originals.tar.gz" -C "${MEDIA_DIR}" originals
    echo "[✓] Originals archived: ${TARGET_DIR}/originals.tar.gz"
fi

# 3. Environment & Cryptographic Secrets Backup
ENV_SRC=""
if [ -f "/etc/ownmediahost/ownmediahost.env" ]; then
    ENV_SRC="/etc/ownmediahost/ownmediahost.env"
elif [ -f "./.env" ]; then
    ENV_SRC="./.env"
elif [ -f "$(dirname "$0")/../.env" ]; then
    ENV_SRC="$(dirname "$0")/../.env"
fi

if [ -n "$ENV_SRC" ]; then
    echo "[*] Backing up environment configuration and encryption keys..."
    cp "${ENV_SRC}" "${TARGET_DIR}/ownmediahost.env.backup"
    chmod 600 "${TARGET_DIR}/ownmediahost.env.backup" 2>/dev/null || true
    echo "[✓] Configuration backed up: ${TARGET_DIR}/ownmediahost.env.backup"
fi

# 4. SHA-256 Manifest
echo "[*] Generating SHA-256 manifest..."
(cd "${TARGET_DIR}" && sha256sum * > SHA256SUMS 2>/dev/null || shasum -a 256 * > SHA256SUMS)

echo "[✓] Backup completed successfully at ${TARGET_DIR}!"
echo "NOTE: Store a copy of this backup offsite or in cold cloud storage (e.g. S3/B2/R2)!"
