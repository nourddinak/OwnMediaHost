#!/usr/bin/env bash
# ==============================================================================
# OwnMediaHost Backup Utility
# Backs up database and media storage to a timestamped archive.
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_DIR="${BACKUP_DIR}/ownmediahost_backup_${TIMESTAMP}"
MEDIA_DIR="${MEDIA_ROOT:-./storage}"

echo "[*] Starting OwnMediaHost backup to ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"

# 1. Atomic Database Backup (SQLite WAL mode safe)
DB_PATH="${MEDIA_DIR}/database/media.db"
if [ -f "${DB_PATH}" ]; then
    echo "[*] Creating atomic SQLite backup..."
    if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "${DB_PATH}" ".backup '${TARGET_DIR}/media.db'"
    else
        # Fallback copy
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

# 3. Checksums
echo "[*] Generating SHA-256 manifest..."
(cd "${TARGET_DIR}" && sha256sum * > SHA256SUMS 2>/dev/null || shasum -a 256 * > SHA256SUMS)

echo "[✓] Backup completed successfully at ${TARGET_DIR}!"
echo "NOTE: Store a copy of this backup offsite or in cold cloud storage (e.g. S3/B2/R2)!"
