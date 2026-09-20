# Automated Out-of-Band Status Platform (Better Stack Integration)

OwnMediaHost integrates with **Better Stack** (formerly Better Uptime) to provide 100% automated 24/7 out-of-band monitoring, exact downtime tracking (to the second), incident post-mortems, and public status reporting on your custom domain (`status.yourdomain.com`).

---

## ⚡ Why Out-of-Band on a Dedicated Subdomain?

Hosting your status page on the same server as your media backend is an anti-pattern: if your VPS crashes, loses power, or experiences a network partition, your status page crashes with it.

By pointing `status.yourdomain.com` directly to Better Stack's global edge network via DNS CNAME:
- **Survives Total Host Downtime**: The status page stays online even during complete server death or kernel panics.
- **Automated Downtime Recording**: Better Stack records the exact second an outage begins, calculates duration upon recovery (e.g., `Degraded for 14m 22s`), and generates incident timelines.
- **100% Free**: Operates within Better Stack's generous free tier (10 monitors, 3-minute checks, public status page, email alerts).
- **Obsidian Dark Aesthetic**: Native dark mode that matches the OwnMediaHost design system.

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Create Your Free Better Stack Monitor

1. Sign up for a free account at [betterstack.com](https://betterstack.com/).
2. Navigate to **Uptime** -> **Monitors** -> **Create Monitor**.
3. Configure the monitor settings:
   - **What to monitor**: `URL/IP`
   - **URL to monitor**: `https://media.yourdomain.com/health` (replace with your OwnMediaHost domain)
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
2. Select your OwnMediaHost monitor to display on the page.
3. Choose the **Dark Theme** to match OwnMediaHost's Obsidian styling.
4. Under **Custom Domain**, enter:
   ```text
   status.yourdomain.com
   ```
5. In your DNS provider (Cloudflare, Namecheap, Route53, etc.), add the following DNS record:
   - **Type**: `CNAME`
   - **Name**: `status`
   - **Target**: `statuspage.betteruptime.com`
   - **Proxy status**: DNS only (or standard CNAME)

Better Stack will automatically provision a free SSL certificate for `status.yourdomain.com`.

---

### Step 3: Connect OwnMediaHost to Your Status Page

Execute the 1-click connection utility on your OwnMediaHost server to save the status URL and test probe accessibility:

```bash
sudo bash /opt/ownmediahost/scripts/connect-status.sh "https://status.yourdomain.com"
```

The script will:
1. Save `STATUS_PAGE_URL` in `/etc/ownmediahost/ownmediahost.env`.
2. Persist `status_page_url` into the SQLite `settings` table.
3. Verify that `GET /health` responds with HTTP 200 and valid JSON.
4. Update the OwnMediaHost React dashboard so the sidebar status badge links directly to your public status page.

---

## 🔄 Automatic Redirection (`yourdomain.com/status/`)

If a visitor navigates directly to `https://media.yourdomain.com/status/`, the built-in [status/index.html](file:///c:/Users/bob/Desktop/SELFmedia/status/index.html) will automatically forward them to your configured `https://status.yourdomain.com` status page.

---

## 🛠️ Testing Outage Simulation

To verify that Better Stack captures outages and accurately records downtime:

1. Temporarily stop the backend service on your VPS:
   ```bash
   sudo systemctl stop ownmediahost
   ```
2. Within 3 minutes, Better Stack will detect the failure, trigger an alert, and update `status.yourdomain.com` to **Major Outage / Degraded**.
3. Restart the service:
   ```bash
   sudo systemctl start ownmediahost
   ```
4. Within 3 minutes, Better Stack records service recovery and logs the exact duration (e.g. `Down for 4m 10s`).
