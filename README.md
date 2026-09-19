# OwnMediaHost — Personal Media Infrastructure Platform

A high-performance, production-ready, self-hosted personal media infrastructure platform built with **Rust (Axum, Tokio, SQLx)**, **SQLite (WAL mode)**, **Caddy (Auto-SSL)**, and an **Obsidian Dark React dashboard**.

---

## ⚡ Quick Command Reference (All Commands at a Glance)

| Task | Command |
| :--- | :--- |
| **Deploy / Install (Root)** | `bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)` |
| **Deploy / Install (Sudo)** | `curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh` |
| **Update Server** | `bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)` |
| **View Current Password** | `sudo grep -s -E "^ADMIN_(EMAIL\|PASSWORD)=" /etc/ownmediahost/ownmediahost.env /opt/ownmediahost/.env` |
| **Reset Admin Password** | `sudo bash /opt/ownmediahost/scripts/reset-password.sh "YourNewPassword123"` |
| **Uninstall Platform** | `bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)` |
| **View Live Backend Logs** | `sudo journalctl -u ownmediahost -f` |
| **Check Service Status** | `sudo systemctl status ownmediahost` |
| **Restart Backend Service** | `sudo systemctl restart ownmediahost` |
| **Reload Caddy Reverse Proxy**| `sudo systemctl reload caddy` |
| **Create Atomic Backup** | `sudo bash /opt/ownmediahost/scripts/backup.sh /var/backups/ownmediahost` |
| **Restore Backup** | `sudo bash /opt/ownmediahost/scripts/restore.sh /path/to/backup_folder` |

```bash
# ─── 1. INSTANT DEPLOYMENT ────────────────────────────────────────────────────
# Run as root:
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)

# Or run with sudo:
curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh

# ─── 2. INSTANT UPDATES ───────────────────────────────────────────────────────
# Pull latest code, rebuild frontend/backend, reload Caddy & systemd:
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)

# ─── 3. ADMIN CREDENTIALS & PASSWORD MANAGEMENT ──────────────────────────────
# View your saved credentials:
sudo grep -s -E "^ADMIN_(EMAIL|PASSWORD)=" /etc/ownmediahost/ownmediahost.env /opt/ownmediahost/.env

# Change/Reset admin password directly:
sudo bash /opt/ownmediahost/scripts/reset-password.sh "MyNewSecurePassword2026!"

# ─── 4. UNINSTALL / REMOVE PLATFORM ──────────────────────────────────────────
# Cleanly remove systemd service, Caddy rules, binaries, and web assets:
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)

# ─── 5. DAILY SERVICE OPERATIONS ─────────────────────────────────────────────
sudo systemctl status ownmediahost            # Check backend status
sudo journalctl -u ownmediahost -f             # Stream live application logs
sudo systemctl restart ownmediahost           # Restart Rust service
sudo systemctl reload caddy                # Reload Caddy HTTPS proxy
sudo nano /etc/ownmediahost/ownmediahost.env     # Edit production configuration
sqlite3 /var/lib/ownmediahost/storage/database/media.db # Query SQLite directly
```

---

OwnMediaHost gives you a dedicated bare-metal alternative to Cloudinary, ImageKit, Uploadcare, and Imgix with **zero Docker overhead**:
- **Your VPS & Pure Bare-Metal Performance**: Runs natively on your server with direct disk I/O, SIMD image acceleration, and native systemd management.
- **Permanent Clean URLs**: Clean permanent links (`/f/7fd92abc/photo.jpg`) and stable vanity aliases (`/a/profile/avatar`).
- **In-Place File Replacement**: Replace media content in-place without altering IDs, permanent URLs, or aliases.
- **Browser-Native Canvas & Video Thumbnails**: Ultra-fast video frame and image thumbnail generation directly in the browser using HTML5 `<canvas>` and `<video>` elements—eliminating server-side CPU spikes and heavy external dependencies.
- **Pure Rust Image Processing**: High-speed, SIMD-accelerated image scaling and format handling via native Rust libraries with zero external command-line utilities.
- **Resumable Chunked Uploads**: Native chunked upload protocol (`POST /api/v1/uploads`, `PATCH /api/v1/uploads/:id`, `POST /api/v1/uploads/:id/complete`) for 500MB to 10GB+ video files with zero buffer starvation.
- **Private Media & Time-Limited URLs**: Time-limited signed URLs (`/private/:public_id?expires=...&signature=...`).
- **Obsidian Dark Dashboard**: Desktop and mobile responsive dashboard with drag-and-drop drawer, video player, and live storage gauges.

---

## Architecture

```text
                     Client (Browser, Mobile, CLI, API)
                                     │
                                     ▼
                      Caddy Web Server (Auto-SSL)
                       (Port 80/443, Let's Encrypt)
                                     │
             ┌───────────────────────┴───────────────────────┐
             ▼                                               ▼
      Static SPA Frontend                            Backend API & Media
    (/var/www/ownmediahost/dist)                      (127.0.0.1:8080)
             │                                               │
             │                                   Axum Rust Native Service
             │                                 (systemd: ownmediahost.service)
             │                                               │
             │                               ┌───────────────┴───────────────┐
             │                               ▼                               ▼
             ▼                        SQLite WAL Mode                  File Storage
   React Dashboard SPA               (/var/lib/.../media.db)      (/var/lib/.../storage)
(Apple Obsidian Dark UI)                                          ├── originals/
                                                                  ├── generated/
                                                                  └── temporary/
```

---

## 1-Click Bare-Metal VPS Deployment Bot

Deploy the complete platform onto any fresh Ubuntu or Debian VPS in a single command. **No Docker required.**

### 1-Line Quick Install

**Option A** — If you are already root (`sudo -i` or logged in as root):
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)
```

**Option B** — If you are a regular user with sudo (recommended for most VPS):
```bash
curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh
```

> **Note:** `sudo bash <(curl ...)` does not work on Linux because sudo cannot access the process substitution file descriptor. Use Option B instead.

### What the Deploy Bot Does Automatically:
1. **Self-Bootstrapping**: If executed on a fresh server, it automatically installs `git` and `curl`, clones the repository into `/opt/ownmediahost`, and switches into the project folder.
2. **Interactive Configuration Wizard**:
   - Prompts for **Single Unified Domain** (e.g. `media.yourdomain.com` serving both frontend UI and media streaming APIs) or **Split Domains** (`media.yourdomain.com` for UI + `api.yourdomain.com` for API).
   - Prompts for internal backend port (default: `8080`, with active port collision checking).
   - Prompts for persistent storage path (default: `/var/lib/ownmediahost/storage`).
   - Prompts for initial administrator email and password (or auto-generates a secure password).
3. **Automated Dependency Provisioning**:
   - Installs native system build tools and SQLite3 (`build-essential`, `pkg-config`, `libssl-dev`, `libsqlite3-dev`, `sqlite3`). No external multimedia CLI binaries required.
   - Checks and installs Node.js v22 (LTS) via official NodeSource repository if missing or `< v20`.
   - Checks and installs stable Rust & Cargo via official `rustup` if absent.
4. **Caddy Reverse Proxy & Automatic SSL**:
   - Installs official Caddy v2 if missing.
   - Backs up your existing `/etc/caddy/Caddyfile` with a timestamp.
   - Cleanly injects the reverse-proxy block with unbuffered streaming (`flush_interval -1`), routing all `/api/*`, `/f/*`, `/i/*`, `/a/*`, `/thumbnails/*`, and `/private/*` requests to the Axum backend while serving the React dashboard SPA at `/` with automatic HTTPS.
5. **Instant Precompiled Binary Deployment**:
   - Downloads precompiled, optimized Linux x86_64 Rust release binaries and React dashboard assets directly from GitHub Releases in ~5 seconds (bypassing 15-minute VPS compilation and memory spikes). Seamlessly falls back to local source compilation if requested with `--build-from-source` or if offline.
6. **Systemd Daemon & Cryptographic Hardening**:
   - Generates five high-entropy 32-byte cryptographic secrets for JWT, Cookies, Pepper, and URL signing keys.
   - Provisions `/etc/ownmediahost/ownmediahost.env` with restricted permissions (`chmod 600`).
   - Creates dedicated unprivileged system account `ownmediahost`.
   - Registers, enables, and launches `/etc/systemd/system/ownmediahost.service`.
   - Reloads Caddy with zero downtime.

---

## Updating OwnMediaHost

Keep your server up-to-date with the latest features and security improvements.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)
```

### What the Updater Does:
- Pulls the latest commits from Git (`git pull --rebase`).
- Downloads or recompiles the Rust backend in `--release` mode and updates `/usr/local/bin/ownmediahost-backend`.
- Refreshes the React dashboard and updates `/var/www/ownmediahost/dist`.
- Restarts the `ownmediahost.service` systemd daemon with zero config loss and verifies service health.

---

## System Management & Operations

Manage your native bare-metal deployment with standard Linux system tools:

| Action | Command |
| :--- | :--- |
| **Check service status** | `sudo systemctl status ownmediahost` |
| **View live logs** | `sudo journalctl -u ownmediahost -f` |
| **Restart backend service** | `sudo systemctl restart ownmediahost` |
| **Reload Caddy reverse proxy** | `sudo systemctl reload caddy` |
| **View current password** | `sudo grep -E "^ADMIN_(EMAIL\|PASSWORD)=" /etc/ownmediahost/ownmediahost.env` |
| **Reset admin password** | `sudo bash /opt/ownmediahost/scripts/reset-password.sh "NewPassword123"` |
| **Uninstall platform** | `bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)` |
| **Edit production environment** | `sudo nano /etc/ownmediahost/ownmediahost.env` (then restart service) |
| **Inspect database directly** | `sqlite3 /var/lib/ownmediahost/storage/database/media.db` |

### Changing / Resetting Administrator Password
```bash
# 1. View your current saved admin password:
sudo grep -E "^ADMIN_(EMAIL|PASSWORD)=" /etc/ownmediahost/ownmediahost.env

# 2. Reset the admin password instantly (re-hashes and updates SQLite database):
sudo bash /opt/ownmediahost/scripts/reset-password.sh "MyNewSecurePassword2026!"
```

### Complete Bare-Metal Platform Uninstallation
The uninstaller cleanly stops and removes the systemd service, strips Caddy reverse proxy blocks, removes binaries and frontend files, and interactively prompts before touching any media data:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)
```

---

## Local Development Setup

### Prerequisites
- **Rust**: 1.80+ (`cargo`, `rustc`)
- **Node.js**: v20+ (`npm`)
- **SQLite3**: Installed on system PATH (or libsqlite3)

### 1. Clone & Configure Environment
```bash
git clone https://github.com/nourddinak/OwnMediaHost.git
cd OwnMediaHost
cp .env.example .env
```

### 2. Run Backend
The backend initializes the SQLite database in WAL mode, executes migrations, seeds the initial administrator, and launches background cleanup workers:
```bash
cd backend
cargo run
```
- Backend starts at: `http://127.0.0.1:5002`
- Swagger API docs at: `http://127.0.0.1:5002/docs`
- Health check at: `http://127.0.0.1:5002/health/ready`

### 3. Run Frontend Dashboard
```bash
cd frontend
npm install
npm run dev
```
- Dashboard opens at: `http://localhost:5173`
- Default development credentials from `.env`:
  - **Email**: `admin@ownmediahost.local`
  - **Password**: `AdminSecurePass2026!`

---

## Media URLs, Aliases & Transformations

### 1. Permanent Media URLs
```text
https://media.example.com/f/7fd92abc/photo.jpg
https://media.example.com/f/v_a8129/video.mp4
```

### 2. Stable Vanity Aliases
Aliases give you permanent vanity URLs that never change even when replacing the underlying asset:
```text
https://media.example.com/a/profile/avatar
https://media.example.com/a/branding/logo
```

To replace the file behind an alias in-place without changing URLs:
```bash
curl -X PUT https://media.example.com/api/v1/files/med_xxx/content \
  -H "Authorization: Bearer mk_live_xxxx" \
  -F "file=@new_avatar.png"
```
The URL `https://media.example.com/a/profile/avatar` immediately serves the new file!

### 3. Signed Image Transformations
Transformations are signed using HMAC-SHA256 with `TRANSFORM_SIGNING_KEY` to prevent DoS attacks:
```text
https://media.example.com/i/<signature>?id=7fd92abc&w=800&h=600&fit=cover&format=webp&q=85
```
Generate signed URLs directly via API:
```bash
curl -X POST https://media.example.com/api/v1/transform/sign \
  -H "Authorization: Bearer mk_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"public_id": "7fd92abc", "width": 800, "format": "webp", "quality": 85}'
```

### 4. Private Media & Signed Temporary URLs
Private assets cannot be accessed without authorization. Generate time-limited signed URLs:
```bash
curl -X POST https://media.example.com/api/v1/files/med_xxx/sign-private \
  -H "Authorization: Bearer mk_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"expires_seconds": 3600}'
```
Returns:
```text
https://media.example.com/private/7fd92abc?expires=1726750000&signature=...
```

---

## Resumable Chunked Upload Protocol

For large files (500MB to 10GB+):

1. **Initialize Session**:
   ```bash
   POST /api/v1/uploads
   Content-Type: application/json
   Body: {"filename": "raw_footage.mp4", "total_size": 2147483648, "chunk_size": 10485760}
   ```
   Returns: `{"session_id": "ses_...", "total_chunks": 205}`

2. **Stream Chunks**:
   ```bash
   PATCH /api/v1/uploads/ses_... ?chunk_index=0
   Body: <chunk binary bytes>
   ```

3. **Complete Upload**:
   ```bash
   POST /api/v1/uploads/ses_.../complete
   ```
   Assembles chunks atomically, verifies SHA-256, and registers media.

---

## Developer SDK & API Usage Examples

### Uploading Files via API

#### cURL
```bash
curl -X POST https://media.example.com/api/v1/files \
  -H "Authorization: Bearer mk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -F "file=@photo.jpg" \
  -F "visibility=public" \
  -F "alias=gallery/cover"
```

#### JavaScript / TypeScript
```typescript
const form = new FormData();
form.append("file", fileInput.files[0]);
form.append("visibility", "public");
form.append("alias", "profile/avatar");

const res = await fetch("https://media.example.com/api/v1/files", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
  },
  body: form,
});

const result = await res.json();
console.log("Media URL:", result.data.url);
```

#### Python
```python
import requests

with open("sample.mp4", "rb") as f:
    res = requests.post(
        "https://media.example.com/api/v1/files",
        headers={"Authorization": "Bearer mk_live_xxxx"},
        files={"file": f},
        data={"visibility": "public"}
    )

data = res.json()
print("Permanent URL:", data["data"]["url"])
print("Video Codec:", data["data"]["video_codec"])
print("Duration:", data["data"]["duration"])
```

#### Rust
```rust
use reqwest::multipart::{Form, Part};

let form = Form::new()
    .part("file", Part::bytes(file_bytes).file_name("photo.jpg"));

let client = reqwest::Client::new();
let res = client
    .post("https://media.example.com/api/v1/files")
    .bearer_auth("mk_live_xxxx")
    .multipart(form)
    .send()
    .await?
    .json::<serde_json::Value>()
    .await?;

println!("URL: {}", res["data"]["url"]);
```

---

## Backups & Disaster Recovery

### Create Backup
```bash
chmod +x scripts/backup.sh
./scripts/backup.sh ./backups
```
Creates an atomic copy of `media.db` (safe in SQLite WAL mode) and archives media originals into `originals.tar.gz` with SHA-256 manifest.

### Restore Backup
```bash
chmod +x scripts/restore.sh
./scripts/restore.sh ./backups/ownmediahost_backup_20260919_120000
```

---

## Automated Tests

To execute the backend test suites:
```bash
cd backend
cargo test
```
All unit and integration test suites will execute:
- Password hashing (Argon2id)
- API key generation and hashing
- Session token signing and expiry
- HMAC-SHA256 transformation tamper detection
- Signed private URL expiration
- Path traversal prevention
- Image type detection and SIMD transformation
