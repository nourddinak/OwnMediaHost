# OwnMediaHost Incident Communication & Public Status Platform

An ultra-pro, zero-dependency, out-of-band public status page designed to survive primary application downtime, server crashes, and database lockouts.

---

## 1. Architectural Overview & Redundancy

A status page hosted inside the application it monitors is an anti-pattern. If the application crashes, the status page goes dark with it, creating a user trust crisis.

OwnMediaHost provides full decoupled out-of-band deployment options:

```
[ Primary Infrastructure ]                        [ Global Out-of-Band Status ]
OwnMediaHost Backend (Rust/Axum)                 GitHub Pages / Cloudflare Pages
        │                                                     │
   (:5002 API)                                        (Static Edge CDN)
        │                                                     │
        ▼                                                     ▼
Synthetic Health Probes ◄───(CORS Allowed Probing)─── Status Page Engine
(/health + /health/ready)                                     │
                                                   Live Telemetry & Incidents
```

### Key Capabilities:
- **Zero Single Point of Failure**: When hosted on **GitHub Pages** or **Cloudflare Pages**, the status platform stays online even if the primary server loses power, suffers a hardware crash, or is DDoS'ed.
- **100% Real Telemetry**: Displays real process uptime, SQLite database query latency (`SELECT 1` precision timing), indexed media asset count and byte volume, and network probe round-trip latency.
- **Unified 90-Day Uptime Timeline**: Clean, slender 90-day operational timeline with interactive hover tooltips (replaces repetitive, bulky green block walls).
- **Subsystem Breakdown**: Real-time status for API Gateway, SQLite WAL Database, Media CDN Range Streaming, and Web SPA.
- **GitHub Pages 1-Click Deployment**: Built-in automated GitHub Actions workflow (`.github/workflows/deploy-status.yml`).

---

## 2. Deploying to GitHub Pages (Recommended Free Tier)

Deploying your public status page to GitHub Pages takes under 2 minutes:

### Option A: Automated GitHub Actions Workflow (Zero-Configuration)
1. Go to your repository on GitHub -> **Settings** -> **Pages**.
2. Under **Build and deployment** -> **Source**, select **GitHub Actions**.
3. Push to `main` (or go to **Actions** -> **Deploy Public Status Page to GitHub Pages** -> **Run workflow**).
4. Your status page is immediately live at `https://<username>.github.io/<repository>/`!

### Custom Domain (Optional):
- In GitHub repository **Settings** -> **Pages** -> **Custom domain**, enter your desired domain (e.g. `status.yourdomain.com`).
- Add a `CNAME` DNS record at your registrar pointing `status.yourdomain.com` to `<username>.github.io`.

---

## 3. Connecting the Status Page with Your Webapp

Once deployed to GitHub Pages, the status page needs to know which OwnMediaHost backend to probe:

### Method 1: Interactive In-Browser Connection (Fastest)
1. Open your GitHub Pages status page URL.
2. Click the **Target** pill in the top navigation bar (or the setup banner).
3. Enter your public backend URL (e.g. `https://media.yourdomain.com`).
4. Click **Test & Connect**. The status page will verify connectivity and save the target in your browser.

### Method 2: Query String Link
You can link directly to your status page with your backend pre-filled:
```text
https://username.github.io/OwnMediaHost/?api=https://media.yourdomain.com
```

### Method 3: Preconfigure in `status/config.json`
Edit `status/config.json` in your repository:
```json
{
  "app_name": "OwnMediaHost",
  "api_endpoint": "https://media.yourdomain.com",
  "poll_interval_seconds": 30,
  "github_repo": "nourddinak/OwnMediaHost"
}
```

### Method 4: Link from the Main Webapp
1. In the OwnMediaHost Web Dashboard, navigate to **Settings** -> **Platform Settings**.
2. Under **Public Out-of-Band Status Page URL**, paste your GitHub Pages or custom domain URL:
   ```text
   https://status.yourdomain.com
   ```
3. Click **Save Settings**. The sidebar will now feature a direct link to your out-of-band status page.

---

## 4. Alternative: Deploying on the Same VPS (`scripts/deploy.sh`)

If you prefer hosting the status page on your own VPS alongside the main app:
```bash
./scripts/deploy.sh --domain media.example.com --status-domain status.example.com
```
Caddy will automatically provision a separate virtual host serving `/var/www/ownmediahost/status/` with automated Let's Encrypt SSL. Even if the backend process crashes, Caddy continues serving the status page.

---

## 5. Broadcasting Incidents & Post-Mortems

To broadcast an incident or scheduled maintenance notice, edit `status/incidents.json`:

```json
{
  "api_endpoint": "",
  "incidents": [
    {
      "id": "inc_2026_09_storage",
      "title": "Scheduled Storage Volume Migration",
      "status": "investigating",
      "severity": "maintenance",
      "updates": [
        {
          "timestamp": "2026-09-20 02:00 UTC",
          "status": "scheduled",
          "message": "Routine SSD disk array expansion in progress."
        }
      ]
    }
  ],
  "past_incidents": []
}
```
Commit and push to GitHub, or update the file on your server. The status page reflects updates within 30 seconds without requiring a server restart.
