# Automated Out-of-Band Status Platform (Better Stack)

OwnMediaHost integrates with **Better Stack** to provide 100% automated, 24/7 out-of-band monitoring, exact downtime tracking (to the second), incident post-mortems, and a public status page on your custom domain (`status.yourdomain.com`).

---

## ⚡ Fast Setup Card (TL;DR)

### Domain Topologies & Monitor URLs

| Setting | Topology A: Single Unified Domain (Recommended) | Topology B: Split 2-Domain Architecture |
| :--- | :--- | :--- |
| **Frontend UI** | `https://media.yourdomain.com/` | `https://media.yourdomain.com/` |
| **Backend API** | `https://media.yourdomain.com/api/*` | `https://api.yourdomain.com/api/*` |
| **Better Stack Target** | `https://media.yourdomain.com/health` | `https://api.yourdomain.com/health` |
| **Status Subdomain** | `https://status.yourdomain.com` | `https://status.yourdomain.com` |
| **DNS A/AAAA Record** | `media` -> `<YOUR_VPS_IP>` | `media` & `api` -> `<YOUR_VPS_IP>` |
| **DNS CNAME Record** | `status` -> `statuspage.betteruptime.com` | `status` -> `statuspage.betteruptime.com` |

> [!CAUTION]
> **Always monitor `/health` — Never monitor the bare root domain (`/`)!**
> In a single domain setup, Caddy serves the static React frontend SPA directly from disk. If you monitor `https://media.yourdomain.com/`, Caddy returns `HTTP 200 OK` even if the backend process has crashed or stopped (`sudo systemctl stop ownmediahost`).
> **You must target `/health`** (`https://media.yourdomain.com/health`). Requests to `/health` are reverse-proxied to the Axum backend. When the backend is down, Caddy returns `HTTP 502 Bad Gateway`, which immediately triggers Better Stack to log the incident and calculate downtime duration.

---

### 3-Minute 3-Step Setup

1. **Step 1: Create Better Stack Monitor**
   - Sign up for a free account at [betterstack.com](https://betterstack.com/).
   - Navigate to **Uptime** -> **Monitors** -> **Create Monitor**.
   - Set **URL to monitor**: `https://media.yourdomain.com/health` (or `https://api.yourdomain.com/health` for split domains).
   - Set **Check frequency**: `3 minutes`.

2. **Step 2: Create Public Status Page & DNS Record**
   - In Better Stack, go to **Status Pages** -> **Create Status Page**.
   - Select your monitor, choose the **Dark Theme**, and set **Custom Domain** to `status.yourdomain.com`.
   - In your DNS provider (Cloudflare, Namecheap, Route53, etc.), add the CNAME record:
     - **Type**: `CNAME`
     - **Name**: `status`
     - **Target**: `statuspage.betteruptime.com` (use **DNS Only** / gray-cloud on Cloudflare during initial SSL setup).

3. **Step 3: Connect OwnMediaHost (1-Click)**
   - Run the automated connection utility on your VPS:
     ```bash
     sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://status.yourdomain.com"
     ```
   - The script whitelists CORS origins, updates `/etc/ownmediahost/ownmediahost.env`, synchronizes database settings, and links the dashboard sidebar badge directly to your status page.

---

<details>
<summary><b>🔍 Deep Dive: Failure Detection Mechanics & Reverse Proxy Isolation</b></summary>

### Why Out-of-Band on a Dedicated Subdomain?
Hosting your status page on the same server as your media backend is an anti-pattern: if your VPS crashes, loses power, or experiences a network blackout, an on-server status page crashes with it.

Pointing `status.yourdomain.com` directly to Better Stack's global edge network guarantees:
- **Survives Total Host Blackouts**: The status page stays online even during complete server death or kernel panics.
- **Automated Downtime Recording**: Better Stack logs the exact second an outage begins, records the duration upon recovery (e.g., `Degraded for 14m 22s`), and generates public SLA history.
- **100% Free**: Operates entirely within Better Stack's free tier (10 monitors, 3-minute checks, email alerts).
- **Obsidian Dark Aesthetic**: Matches the OwnMediaHost design system natively.

### Reverse Proxy Routing Breakdown

```text
Client Request ─────────────────────────────────────────────────────────────┐
                                                                            │
                                                                            ▼
                                                               ┌──────────────────────────┐
                                                               │  Caddy Reverse Proxy     │
                                                               └────────────┬─────────────┘
                                                                            │
                     ┌──────────────────────────────────────────────────────┴──────────────────────────────────────────────────────┐
                     ▼                                                                                                             ▼
         GET / (Root Static SPA)                                                                                           GET /health (Health API)
    Served directly from server disk:                                                                                 Proxied to Axum (127.0.0.1:8080):
       /var/www/ownmediahost/dist                                                                                        Evaluates DB & Storage state
                     │                                                                                                             │
        ┌────────────┴────────────┐                                                                                   ┌────────────┴────────────┐
        ▼                         ▼                                                                                   ▼                         ▼
   Backend Running          Backend STOPPED                                                                      Backend Running          Backend STOPPED
    HTTP 200 OK               HTTP 200 OK                                                                          HTTP 200 OK           HTTP 502 Bad Gateway
(False Sense of Health)   (False Sense of Health)                                                               (Accurate Operational)    (INCIDENT TRIGGERED!)
```

</details>

---

<details>
<summary><b>🛠️ Testing, Validation & Outage Simulations</b></summary>

### Simulating an Outage
To verify that Better Stack captures outages and accurately records downtime:

1. Stop the backend service on your VPS:
   ```bash
   sudo systemctl stop ownmediahost
   ```
2. Within 3 minutes, Better Stack detects the `HTTP 502 Bad Gateway`, fires an email alert, and changes `status.yourdomain.com` to **Major Outage / Degraded**.
3. Restart the service:
   ```bash
   sudo systemctl start ownmediahost
   ```
4. Within 3 minutes, Better Stack records recovery and logs the exact duration (e.g. `Down for 4m 10s`).

### Diagnostic Commands

**Test live telemetry and CORS connectivity:**
```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh --test
```

**Disconnect / unlink public status page:**
```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh --disconnect
```

</details>

---

<details>
<summary><b>🔄 Automatic Redirection & Webapp Integration</b></summary>

### Built-in `/status/` Redirection
If any visitor navigates to `/status/` on your server:
- Single Domain: `https://media.yourdomain.com/status/`
- Split Domains: `https://media.yourdomain.com/status/` or `https://api.yourdomain.com/status/`

The built-in [status/index.html](file:///c:/Users/bob/Desktop/SELFmedia/status/index.html) automatically forwards them to your configured `https://status.yourdomain.com` status page.

### Dashboard UI Integration
Once connected, the status indicator dot in the OwnMediaHost sidebar:
- Links directly to `https://status.yourdomain.com`.
- Reflects real-time connection status.
- Can be customized anytime via the **Settings -> Status & Topology** panel.

</details>
