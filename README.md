# OwnMediaHost — Personal Media Infrastructure Platform

A high-performance, production-ready, self-hosted personal media infrastructure platform built with **Rust (Axum, Tokio, SQLx)**, **SQLite (WAL mode)**, **Caddy (Auto-SSL)**, and an **Obsidian Dark React dashboard**.

---

## ⚡ Quick Command Reference (1-Click Copy)

> Every command below is in its own code block so GitHub displays a dedicated **Copy** button.

### 🚀 Deploy / Install

**Run as root**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)
```

**Run with sudo**
```bash
curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh
```

### 🔄 Update Server
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)
```

### 🔐 Admin Credentials & Password Management

**View current admin email and password**
```bash
sudo grep -s -E "^ADMIN_(EMAIL|PASSWORD)=" /etc/ownmediahost/ownmediahost.env /opt/ownmediahost/.env
```

**Reset admin password**
```bash
sudo bash /opt/ownmediahost/scripts/reset-password.sh "YourNewPassword123"
```

### 🛠️ Daily Service Operations

**View live backend logs**
```bash
sudo journalctl -u ownmediahost -f
```

**Check service status**
```bash
sudo systemctl status ownmediahost
```

**Restart backend service**
```bash
sudo systemctl restart ownmediahost
```

**Reload Caddy reverse proxy**
```bash
sudo systemctl reload caddy
```

**Edit production configuration**
```bash
sudo nano /etc/ownmediahost/ownmediahost.env
```

**Query SQLite database directly**
```bash
sqlite3 /var/lib/ownmediahost/storage/database/media.db
```

### 🌐 Incident Communication & Status Page

**Connect public status page (1-Click)**
```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://status.yourdomain.com"
```

**Test live telemetry & CORS connectivity**
```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh --test
```

### 💾 Backup & Disaster Recovery

**Create atomic backup**
```bash
sudo bash /opt/ownmediahost/scripts/backup.sh /var/backups/ownmediahost
```

**Restore backup**
```bash
sudo bash /opt/ownmediahost/scripts/restore.sh /path/to/backup_folder
```

### 🗑️ Uninstall Platform
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)
```

---

OwnMediaHost gives you a dedicated bare-metal alternative to Cloudinary, ImageKit, Uploadcare, and Imgix with **zero Docker overhead**:

- **Your VPS & Pure Bare-Metal Performance**: Runs natively on your server with direct disk I/O, SIMD image acceleration, and native systemd management.
- **Permanent Clean URLs**: Clean permanent links (`/f/7fd92abc/photo.jpg`) and stable vanity aliases (`/a/profile/avatar`).
- **Decoupled Incident Communication & Status Page**: Out-of-band public status platform powered by Better Stack on a dedicated DNS CNAME (`status.yourdomain.com`) that survives primary backend outages with 100% automated 24/7 downtime tracking (to the second), real-time incident post-mortems, and 90-day SLA history.
- **Browser-Native Canvas & Video Thumbnails**: Ultra-fast video frame and image thumbnail generation directly in the browser using HTML5 `<canvas>` and `<video>` elements—eliminating server-side CPU spikes and heavy external dependencies.
- **Pure Rust Image Processing**: High-speed, SIMD-accelerated image scaling and format handling via native Rust libraries with zero external command-line utilities.
- **Streaming Media Uploads & Format Whitelisting**: High-throughput streaming multipart uploads with zero disk buffering and no orphan chunks, backed by configurable image and video format whitelists (`ALLOWED_IMAGE_FORMATS`, `ALLOWED_VIDEO_FORMATS`).
- **Private Media & Time-Limited URLs**: Time-limited signed URLs (`/private/:public_id?expires=...&signature=...`).
- **Obsidian Dark Dashboard**: Desktop and mobile responsive dashboard with multi-file selection (Ctrl/Shift-click), drag-and-drop drawer, video player, and live storage gauges.

---

## Architecture & Domain Routing

OwnMediaHost supports two production routing topologies, both backed by an out-of-band Better Stack status platform:

```text
                                  Client Request
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     Topology A: Unified Domain                      Topology B: Split 2-Domain
    (media.yourdomain.com)                          (media.yourdomain.com + api.yourdomain.com)
                 │                                               │
                 ▼                                               ▼
   ┌──────────────────────────┐                    ┌──────────────────────────┐
   │       Caddy Server       │                    │       Caddy Server       │
   │  ┌────────────────────┐  │                    │  ┌────────────────────┐  │
   │  │ /                  │  │                    │  │ media.yourdomain   │  │
   │  │ React SPA Frontend │  │                    │  │ React SPA Frontend │  │
   │  ├────────────────────┤  │                    │  ├────────────────────┤  │
   │  │ /api, /f, /health  │  │                    │  │ api.yourdomain     │  │
   │  │ Axum Rust Backend  │  │                    │  │ Axum Rust Backend  │  │
   │  └────────────────────┘  │                    │  └────────────────────┘  │
   └─────────────┬────────────┘                    └─────────────┬────────────┘
                 │                                               │
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │ Axum Engine (127.0.0.1)│                      │ Axum Engine (127.0.0.1)│
     │ SQLite WAL + Storage  │                       │ SQLite WAL + Storage  │
     └───────────────────────┘                       └───────────────────────┘
                 ▲                                               ▲
                 │                                               │
                 │ 24/7 Health Probes (GET /health)              │ 24/7 Health Probes (GET /health)
                 │                                               │
   ┌─────────────┴───────────────────────────────────────────────┴────────────┐
   │             Out-of-Band Public Status Page (status.yourdomain.com)       │
   │            Hosted on Better Stack Global Edge (DNS CNAME Isolated)       │
   │            Survives Total VPS Blackouts • 100% Automated Downtime Logs   │
   └──────────────────────────────────────────────────────────────────────────┘
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

### DNS Pre-Requisites

Before or immediately after running the installer, configure your DNS records:

#### Setup 1: Single Unified Domain (Recommended)
| Record Type | Name / Host | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Serves both React dashboard UI and media streaming APIs |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Dedicated out-of-band Better Stack status page |

#### Setup 2: Split 2-Domain Architecture
| Record Type | Name / Host | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Dedicated static React dashboard UI |
| `A` / `AAAA` | `api` | `<YOUR_VPS_IP>` | Dedicated Rust Axum API and media streaming backend |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Dedicated out-of-band Better Stack status page |

### What the Deploy Bot Does Automatically:

1. **Self-Bootstrapping**: If executed on a fresh server, it automatically installs `git` and `curl`, clones the repository into `/opt/ownmediahost`, and switches into the project folder.
2. **Interactive Configuration Wizard**:
   - **Domain Routing Choice**:
     - **[1] Single Domain (Recommended)**: e.g. `media.yourdomain.com`. Caddy serves the React dashboard at `/` and reverse-proxies `/api/*`, `/f/*`, `/a/*`, `/thumbnails/*`, `/private/*`, and `/health` to the Rust Axum backend on a single domain. Zero cross-domain CORS issues, single SSL certificate.
     - **[2] Separate Domains (Split)**: e.g. `media.yourdomain.com` for Frontend UI and `api.yourdomain.com` for Backend API. Configures Caddy virtual hosts for each domain and automatically sets up cross-origin CORS headers.
   - **Public Status Domain / URL**: Prompts for `status.yourdomain.com` or Better Stack status URL to link directly to your out-of-band status page.
   - **Internal Backend Port**: Default `8080`, with active port collision checking.
   - **Persistent Storage Path**: Default `/var/lib/ownmediahost/storage`.
   - **Initial Administrator Account**: Prompts for admin email and password (or auto-generates a high-entropy password).
3. **Automated Dependency Provisioning**:
   - Installs native system build tools and SQLite3 (`build-essential`, `pkg-config`, `libssl-dev`, `libsqlite3-dev`, `sqlite3`). No external multimedia CLI binaries required.
   - Checks and installs Node.js v22 (LTS) via official NodeSource repository if missing or `< v20`.
   - Checks and installs stable Rust & Cargo via official `rustup` if absent.
4. **Caddy Reverse Proxy & Automatic SSL**:
   - Installs official Caddy v2 if missing.
   - Backs up your existing `/etc/caddy/Caddyfile` with a timestamp.
   - Injects the reverse-proxy block with unbuffered streaming (`flush_interval -1`), routing streaming uploads and media endpoints with automatic HTTPS via Let's Encrypt.
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

### Service Status & Logs

**Check backend service status**
```bash
sudo systemctl status ownmediahost
```

**Stream live backend logs**
```bash
sudo journalctl -u ownmediahost -f
```

**Restart backend service**
```bash
sudo systemctl restart ownmediahost
```

**Reload Caddy reverse proxy**
```bash
sudo systemctl reload caddy
```

### Configuration & Database

**Edit production environment variables**
```bash
sudo nano /etc/ownmediahost/ownmediahost.env
```

**Query SQLite database directly**
```bash
sqlite3 /var/lib/ownmediahost/storage/database/media.db
```

### Password Management

**View saved administrator credentials**
```bash
sudo grep -s -E "^ADMIN_(EMAIL|PASSWORD)=" /etc/ownmediahost/ownmediahost.env /opt/ownmediahost/.env
```

**Reset administrator password**
```bash
sudo bash /opt/ownmediahost/scripts/reset-password.sh "MyNewSecurePassword2026!"
```

### 🌐 Public Status Page & Out-of-Band Incident Monitoring

OwnMediaHost integrates with **Better Stack** to provide a 100% automated, out-of-band status page platform running on a dedicated DNS CNAME (`status.yourdomain.com`).

Hosting a status page on the same server as your application is an anti-pattern: when your app server, database, or network crashes, your status page crashes with it. By pointing `status.yourdomain.com` directly to Better Stack's global edge network, your status monitoring remains 100% online even during complete VPS blackouts.

```text
┌────────────────────────────────────────┐       ┌────────────────────────────────────────┐
│  Out-of-Band Status (Better Stack Edge)│       │    OwnMediaHost VPS (Bare-Metal)       │
│  https://status.yourdomain.com         │       │    (Single Domain or Split 2-Domain)   │
│                                        │       │                                        │
│  • 100% Automated 24/7 Probing         │       │  • Unified: media.yourdomain.com       │
│  • Exact Downtime Tracking to second   │       │  • Split:   api.yourdomain.com         │
│  • Survives Complete VPS Blackouts     │       │  • Axum Rust Engine + SQLite WAL       │
│  • Native Obsidian Dark Aesthetic      │       │  • Zero-Overhead GET /health Endpoint  │
└───────────────────┬────────────────────┘       └───────────────────┬────────────────────┘
                    │                                                │
                    │      24/7 Automated Probes to GET /health      │
                    └───────────────────────────────────────────────►│
```

#### Monitoring Targets by Domain Setup:

- **Topology A: Single Unified Domain (`media.yourdomain.com`)**:
  - Better Stack Monitor URL: `https://media.yourdomain.com/health`
  - Caddy forwards `/health` to Axum on `127.0.0.1:8080`.
- **Topology B: Split 2-Domain Architecture (`media.yourdomain.com` UI + `api.yourdomain.com` API)**:
  - Better Stack Primary Backend Monitor: `https://api.yourdomain.com/health` (monitors Rust backend, database connection, and storage).
  - Optional Frontend UI Monitor: `https://media.yourdomain.com/` (monitors Caddy static file delivery).

#### DNS Configuration:

##### Single Unified Domain Setup:
| Type | Host | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Dashboard UI and API endpoints |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Isolated Better Stack status edge |

##### Split 2-Domain Setup:
| Type | Host | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Static React dashboard UI |
| `A` / `AAAA` | `api` | `<YOUR_VPS_IP>` | Rust Axum API and media streaming |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Isolated Better Stack status edge |

#### Quick Setup:

1. **Create Better Stack Monitor**:
   - Sign up for a free account at [betterstack.com](https://betterstack.com/).
   - Add monitor URL (`https://media.yourdomain.com/health` or `https://api.yourdomain.com/health`).
2. **Create Status Page & Custom Domain**:
   - Create a status page in Better Stack, set dark theme, and configure custom domain `status.yourdomain.com`.
   - Add the `status` CNAME record in your DNS provider pointing to `statuspage.betteruptime.com`.
3. **Connect OwnMediaHost Server**:
   ```bash
   # Direct 1-line connection:
   sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://status.yourdomain.com"
   ```

The script automatically:
- Whitelists `https://status.yourdomain.com` in `ALLOWED_ORIGINS` for CORS compliance.
- Saves `STATUS_PAGE_URL` in `/etc/ownmediahost/ownmediahost.env`.
- Synchronizes the status URL into the platform SQLite `settings` table.
- Restarts `ownmediahost.service` to apply changes.
- Validates the `/health` endpoint and tests connectivity.
- Links the Sidebar status indicator in the React dashboard directly to `status.yourdomain.com`.

#### Test & Verify Connection:

```bash
# Verify live telemetry & CORS probe response:
sudo bash /opt/ownmediahost/scripts/connect-status.sh --test

# Disconnect / unlink public status page:
sudo bash /opt/ownmediahost/scripts/connect-status.sh --disconnect
```

#### Built-in Forwarding (`/status/`):

If any user navigates to `https://media.yourdomain.com/status/` (or `https://api.yourdomain.com/status/`), the server automatically redirects them to your public `https://status.yourdomain.com` status page.

#### Outage Simulation Test:

```bash
# Simulate an outage by stopping the backend service:
sudo systemctl stop ownmediahost

# Within 3 minutes, Better Stack marks status.yourdomain.com as Degraded/Down.
# Restart service to verify automatic recovery and downtime duration logging:
sudo systemctl start ownmediahost
```

### Complete Platform Uninstallation

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

## Media URLs, Aliases & Format Management

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

### 3. Media Format Whitelisting & Ingestion

Permitted image and video formats are strictly enforced at ingestion time. Formats can be configured in your environment or dynamically updated in the dashboard Settings:

```env
ALLOWED_IMAGE_FORMATS=jpeg,png,webp,gif,avif,svg,bmp,ico,tiff,heic
ALLOWED_VIDEO_FORMATS=mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp,ogv
```

Uploads and replacements with disallowed extensions or mismatched MIME types are rejected with a `400 Bad Request` before persisting to disk.

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

## High-Performance Streaming Delivery & Range Requests

Media files are streamed directly with zero intermediate full-file RAM buffering:

1. **HTTP 200 & HTTP 206 Partial Content**:
   Streaming delivery supports `Range: bytes=start-end` headers natively. Video scrubbing and resumption work seamlessly in modern web players and mobile streaming clients without holding entire multi-gigabyte media objects in server memory.

2. **Zero Orphaned Files**:
   Uploads stream directly via standard multipart form data. If a client disconnects mid-upload, the TCP connection drops and the Axum stream aborts immediately in memory—leaving zero partial or abandoned files on disk.

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

### Create Atomic Backup

```bash
sudo bash /opt/ownmediahost/scripts/backup.sh /var/backups/ownmediahost
```

Creates an atomic copy of `media.db` (safe in SQLite WAL mode) and archives media originals into `originals.tar.gz` with SHA-256 manifest.

### Restore Backup

```bash
sudo bash /opt/ownmediahost/scripts/restore.sh /path/to/backup_folder
```

---

## Automated Tests

To execute the backend test suites:

```bash
cd backend && cargo test
```

All unit and integration test suites will execute:
- Password hashing (Argon2id)
- API key generation and hashing
- Session token signing and expiry
- Signed private URL expiration
- Path traversal prevention
- Media format whitelisting & MIME type detection
- High-speed JPEG thumbnail generation