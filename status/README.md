# Automated Out-of-Band Status Platform (Better Stack Integration)

OwnMediaHost integrates with **Better Stack** (formerly Better Uptime) to provide 100% automated 24/7 out-of-band monitoring, exact downtime tracking (to the second), incident post-mortems, and public status reporting on your custom domain (`status.yourdomain.com`).

---

## Why Out-of-Band on a Dedicated Subdomain?

Hosting your status page on the same server as your media backend is an anti-pattern: if your VPS crashes, loses power, or experiences a network partition, your status page crashes with it.

By pointing `status.yourdomain.com` directly to Better Stack's global edge network via DNS CNAME:
- **Survives Total Host Downtime**: The status page stays online even during complete server death or kernel panics.
- **Automated Downtime Recording**: Better Stack records the exact second an outage begins, calculates duration upon recovery (e.g., `Degraded for 14m 22s`), and generates incident timelines.
- **100% Free**: Operates within Better Stack's free tier (10 monitors, 3-minute checks, public status page, email alerts).
- **Obsidian Dark Aesthetic**: Native dark mode that matches the OwnMediaHost design system.

---

## Domain Topologies: Single Unified Domain vs. Split 2-Domain

OwnMediaHost supports two deployment architectures. Configure your Better Stack monitors according to your chosen routing topology:

### Topology A: Single Unified Domain (Recommended)
In a single domain deployment, Caddy routes both the static frontend dashboard and the backend API on the same domain:
- **Unified Domain**: `media.yourdomain.com`
- **Dashboard UI**: `https://media.yourdomain.com/`
- **API & Media**: `https://media.yourdomain.com/api/*`, `https://media.yourdomain.com/f/*`
- **Health Check**: `https://media.yourdomain.com/health`
- **Status Subdomain**: `https://status.yourdomain.com`

#### Monitor Configuration for Topology A:
- **Better Stack Monitor Target**: `https://media.yourdomain.com/health`
- **Probing Logic**: Better Stack probes the Axum backend via Caddy. If the backend process crashes or the server goes down, Better Stack flags an incident.

---

### Topology B: Split 2-Domain Architecture
In a split domain deployment, frontend UI and backend API run on distinct subdomains for operational isolation:
- **Frontend Domain**: `media.yourdomain.com` (serves static React SPA dashboard)
- **Backend API Domain**: `api.yourdomain.com` (serves Axum API, media streaming, and uploads)
- **Health Check**: `https://api.yourdomain.com/health`
- **Status Subdomain**: `https://status.yourdomain.com`

#### Monitor Configuration for Topology B:
With two separate domains, you can configure one or two monitors in Better Stack:
1. **Primary Backend Monitor (Critical)**:
   - **URL**: `https://api.yourdomain.com/health`
   - **Monitors**: Rust backend process, SQLite database connectivity, storage disk readiness, and API latency.
2. **Frontend UI Monitor (Optional)**:
   - **URL**: `https://media.yourdomain.com/`
   - **Monitors**: Web server (Caddy) availability and static asset delivery.

---

## DNS Records Reference Table

Ensure your DNS provider (Cloudflare, Namecheap, Route53, etc.) has the correct records configured:

### Topology A: Single Unified Domain DNS
| Record Type | Name / Host | Value / Target | Notes |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Points to Caddy on your server |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Points directly to Better Stack edge |

### Topology B: Split 2-Domain DNS
| Record Type | Name / Host | Value / Target | Notes |
| :--- | :--- | :--- | :--- |
| `A` / `AAAA` | `media` | `<YOUR_VPS_IP>` | Frontend dashboard domain |
| `A` / `AAAA` | `api` | `<YOUR_VPS_IP>` | Backend API and media streaming domain |
| `CNAME` | `status` | `statuspage.betteruptime.com` | Points directly to Better Stack edge |

> [!NOTE]
> When using Cloudflare, ensure the `status` CNAME record is set to **DNS Only** (gray cloud) during initial SSL certificate issuance by Better Stack, or configure SSL mode to Full/Strict.

---

## Step-by-Step Setup Guide

### Step 1: Create Your Better Stack Monitor

1. Sign up for a free account at [betterstack.com](https://betterstack.com/).
2. Navigate to **Uptime** -> **Monitors** -> **Create Monitor**.
3. Configure the monitor settings:
   - **What to monitor**: `URL/IP`
   - **URL to monitor**:
     - For **Single Domain**: `https://media.yourdomain.com/health`
     - For **Split Domains**: `https://api.yourdomain.com/health`
   - **Check frequency**: `3 minutes` (Free plan default)
   - **Alert us when**: `URL returns an unexpected status code (non-200)` or `Contains keyword: "operational"`
4. Click **Create Monitor**.

> [!TIP]
> OwnMediaHost exposes two specialized zero-overhead health endpoints:
> - `GET /health`: Comprehensive health diagnostics (database connection status, disk space, uptime, media counts).
> - `GET /health/ready`: Fast lightweight readiness probe testing SQLite transaction readiness.

---

### Step 2: Set Up Your Public Status Page & Custom Domain

1. In Better Stack, go to **Status Pages** -> **Create Status Page**.
2. Select your OwnMediaHost monitor(s) to display on the page.
3. Choose the **Dark Theme** to match OwnMediaHost's Obsidian styling.
4. Under **Custom Domain**, enter:
   ```text
   status.yourdomain.com
   ```
5. In your DNS provider, add the CNAME record:
   - **Type**: `CNAME`
   - **Name**: `status`
   - **Target**: `statuspage.betteruptime.com`

Better Stack will automatically provision a free SSL certificate for `status.yourdomain.com`.

---

### Step 3: Connect OwnMediaHost to Your Status Page

Execute the 1-click connection utility on your OwnMediaHost server to save the status URL and test probe accessibility:

```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://status.yourdomain.com"
```

The script automatically:
1. Whitelists `https://status.yourdomain.com` in `ALLOWED_ORIGINS` in `/etc/ownmediahost/ownmediahost.env`.
2. Saves `STATUS_PAGE_URL` in `/etc/ownmediahost/ownmediahost.env`.
3. Synchronizes `status_page_url` into the SQLite `settings` table.
4. Restarts `ownmediahost.service` to apply CORS and configuration changes.
5. Verifies that `GET /health` responds with HTTP 200 and valid JSON.
6. Links the Sidebar status indicator in the React dashboard directly to `https://status.yourdomain.com`.

---

## Automatic Redirection (`/status/`)

If a visitor navigates directly to the `/status/` path on your server:
- Single Domain: `https://media.yourdomain.com/status/`
- Split Domains: `https://media.yourdomain.com/status/` or `https://api.yourdomain.com/status/`

The built-in [status/index.html](file:///c:/Users/bob/Desktop/SELFmedia/status/index.html) will automatically forward the visitor to your configured `https://status.yourdomain.com` status page.

---

## Testing Outage Simulation

To verify that Better Stack captures outages and accurately records downtime:

1. Stop the backend service on your VPS:
   ```bash
   sudo systemctl stop ownmediahost
   ```
2. Within 3 minutes, Better Stack will detect the failure, trigger an alert, and update `status.yourdomain.com` to **Major Outage / Degraded**.
3. Restart the service:
   ```bash
   sudo systemctl start ownmediahost
   ```
4. Within 3 minutes, Better Stack records service recovery and logs the exact duration (e.g. `Down for 4m 10s`).
