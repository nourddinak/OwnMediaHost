# OwnMediaHost — Personal Media Infrastructure Platform

A high-performance, production-ready, self-hosted personal media infrastructure platform built with **Rust (Axum, Tokio, SQLx)**, **SQLite (WAL mode)**, **Caddy (Auto-SSL)**, and an **Obsidian Dark React dashboard**. A bare-metal alternative to Cloudinary, ImageKit, and Imgix with **zero Docker overhead**.

---

## ⚡ 3-Step Fast Track (Quick Start)

Get OwnMediaHost up and running on a fresh VPS in under 5 minutes:

### Step 1: Configure DNS Records

Configure your DNS records at your domain registrar (Cloudflare, Namecheap, Route53, etc.) pointing to your VPS IP:

#### Topology A: Single Unified Domain (Recommended)
| Record Type | Host | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Serves both React Dashboard UI and Rust Media APIs |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Dedicated out-of-band Better Stack status page |

#### Topology B: Split 2-Domain Architecture
| Record Type | Host | Target / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Dedicated React Dashboard UI |
| `A` / `AAAA` | `api` | `<YOUR_VPS_IP>` | Dedicated Rust Axum API and media streaming |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Dedicated out-of-band Better Stack status page |

---

### Step 2: 1-Line Server Deployment

SSH into your fresh Ubuntu or Debian VPS and execute the automated installer bot:

**Run as root:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh)
```

**Run with sudo (standard user):**
```bash
curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/deploy.sh -o /tmp/deploy.sh && sudo bash /tmp/deploy.sh
```

The installer provisions Caddy reverse proxy, downloads pre-compiled release binaries (~5s install), initializes SQLite WAL mode, configures systemd services, and secures automatic Let's Encrypt SSL.

---

### Step 3: Connect 24/7 Status Page

Connect Better Stack out-of-band monitoring to track 100% automated downtime down to the second on `status.yourdomain.com`:

```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://status.yourdomain.com"
```

> [!CAUTION]
> **Always monitor `/health` (`https://media.yourdomain.com/health`) in Better Stack!**
> Do not monitor the root domain (`/`). In a single unified domain setup, Caddy serves the static frontend HTML directly. Probing `/` returns HTTP 200 even if the backend service is down. Probing `/health` accurately triggers an `HTTP 502 Bad Gateway` incident during server or backend outages.

---

## 📋 Daily Operations Cheat Sheet

| Task | Command |
| :--- | :--- |
| **Update Server** | `bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)` |
| **Check Service Status** | `sudo systemctl status ownmediahost` |
| **Stream Live Backend Logs** | `sudo journalctl -u ownmediahost -f` |
| **Restart Backend Service** | `sudo systemctl restart ownmediahost` |
| **Reload Caddy SSL Proxy** | `sudo systemctl reload caddy` |
| **View Admin Credentials** | `sudo grep -s -E "^ADMIN_(EMAIL\|PASSWORD)=" /etc/ownmediahost/ownmediahost.env` |
| **Reset Admin Password** | `sudo bash /opt/ownmediahost/scripts/reset-password.sh "NewPassword123"` |
| **Create Atomic Backup** | `sudo bash /opt/ownmediahost/scripts/backup.sh /var/backups/ownmediahost` |
| **Restore Backup** | `sudo bash /opt/ownmediahost/scripts/restore.sh /path/to/backup_folder` |
| **Test Status Connectivity** | `sudo bash /opt/ownmediahost/scripts/connect-status.sh --test` |
| **Uninstall Platform** | `bash <(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/uninstall.sh)` |

---

<details>
<summary><b>🏗️ Architecture & Reverse Proxy Routing</b></summary>

### System Architecture

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

### Out-of-Band Status Page Principle
Hosting your status page on the same server as your media backend is an anti-pattern: if your VPS crashes or loses network connectivity, an on-server status page crashes with it.

By pointing `status.yourdomain.com` directly to Better Stack via DNS CNAME:
- **Survives Total Host Downtime**: Remains 100% online during kernel panics, reboots, or host network failures.
- **Precision Downtime Recording**: Measures the exact duration of incidents (e.g. `Down for 12m 40s`).
- **Zero Resource Consumption**: 0 MB RAM, 0 CPU on your host server.

</details>

---

<details>
<summary><b>⚙️ System Requirements & What the Installer Provisions</b></summary>

### System Requirements
- **OS**: Ubuntu 22.04 LTS+, Debian 12+ (x86_64)
- **RAM**: Minimum 1 GB (2 GB recommended)
- **CPU**: 1 vCPU or higher
- **Disk**: 10 GB+ SSD recommended
- **Ports**: 80 (HTTP) and 443 (HTTPS) accessible to the public internet

### What the Deploy Script Automates:
1. **Package Provisioning**: Installs `git`, `curl`, `build-essential`, and `sqlite3`.
2. **Web Server & SSL**: Installs Caddy v2, configures reverse-proxy with streaming flush intervals, and automatically issues Let's Encrypt certificates.
3. **Instant Precompiled Binaries**: Fetches precompiled Rust release binaries and React dashboard bundles directly from GitHub releases (~5 seconds).
4. **Security & Cryptography**: Auto-generates 5 high-entropy 32-byte cryptographic keys (JWT, session cookies, password pepper, URL signatures) with `chmod 600` permissions.
5. **Systemd Daemon**: Registers and starts `/etc/systemd/system/ownmediahost.service` running as dedicated unprivileged user `ownmediahost`.

</details>

---

<details>
<summary><b>📁 Media Delivery: Permanent URLs, Aliases, Formats & Private Links</b></summary>

### 1. Permanent Media URLs
Clean, durable URLs that never break:
```text
https://media.example.com/f/7fd92abc/photo.jpg
https://media.example.com/f/v_a8129/video.mp4
```

### 2. Stable Vanity Aliases
Permanent vanity URLs for avatars, branding, and assets:
```text
https://media.example.com/a/profile/avatar
https://media.example.com/a/branding/logo
```

Replace the underlying file in-place without changing the URL:
```bash
curl -X PUT https://media.example.com/api/v1/files/med_xxx/content \
  -H "Authorization: Bearer mk_live_xxxx" \
  -F "file=@new_avatar.png"
```

### 3. Media Format Whitelisting
Strict extension and MIME-type enforcement at upload time. Configured via `/etc/ownmediahost/ownmediahost.env`:
```env
ALLOWED_IMAGE_FORMATS=jpeg,png,webp,gif,avif,svg,bmp,ico,tiff,heic
ALLOWED_VIDEO_FORMATS=mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp,ogv
```

### 4. Private Media & Signed Temporary URLs
Generate time-limited signed links for confidential assets:
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

### 5. High-Performance Streaming & Range Requests
- **HTTP 206 Partial Content**: Video scrubbing and audio playback stream directly without loading multi-gigabyte files into server RAM.
- **Zero Orphaned Files**: Direct multipart streaming aborts cleanly on client disconnect with zero partial files left on disk.

</details>

---

<details>
<summary><b>💻 Developer SDK & API Usage Examples</b></summary>

### Uploading Files via API

#### cURL
```bash
curl -X POST https://media.example.com/api/v1/files \
  -H "Authorization: Bearer mk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -F "file=@photo.jpg" \
  -F "visibility=public" \
  -F "alias=gallery/cover"
```

#### TypeScript / JavaScript
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

</details>

---

<details>
<summary><b>💾 Backups, Restores & Disaster Recovery</b></summary>

### Atomic Backup
Creates an atomic copy of `media.db` (safe during active writes under SQLite WAL mode) and packages all original media into a compressed archive with SHA-256 checksums:
```bash
sudo bash /opt/ownmediahost/scripts/backup.sh /var/backups/ownmediahost
```

### Restore Backup
Restores database, storage files, and environment configuration:
```bash
sudo bash /opt/ownmediahost/scripts/restore.sh /var/backups/ownmediahost/backup_YYYYMMDD_HHMMSS
```

</details>

---

<details>
<summary><b>🛠️ Local Development & Automated Tests</b></summary>

### Running Locally

1. **Clone & Environment**:
   ```bash
   git clone https://github.com/nourddinak/OwnMediaHost.git
   cd OwnMediaHost
   cp .env.example .env
   ```

2. **Run Backend (Port 5002)**:
   ```bash
   cd backend && cargo run
   ```

3. **Run Frontend Dashboard (Port 5173)**:
   ```bash
   cd frontend && npm install && npm run dev
   ```

### Executing Backend Tests
```bash
cd backend && cargo test
```
Validates Argon2id password hashing, API key hashing, signed private URL expiration, path traversal guards, format whitelisting, and image thumbnail processing.

</details>