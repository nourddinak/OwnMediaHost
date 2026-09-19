# OwnMediaHost Incident Communication & Public Status Page

A lightweight, zero-dependency, out-of-band public status page designed to survive primary application downtime, server crashes, and database lockouts.

---

## 1. Architectural Redundancy

A status page hosted inside the application it monitors is an anti-pattern. If the application crashes, the status page crashes with it, eroding user trust.

OwnMediaHost provides two tiers of incident communication isolation:

### Tier 1: Independent Virtual Host (Same VPS)
- **Engine**: Caddy Web Server serves static assets from `/var/www/ownmediahost/status/`.
- **Domain**: Dedicated subdomain (e.g. `status.example.com`).
- **Resiliency**: Completely isolated from the `ownmediahost` Axum process and SQLite database. If the backend panics, crashes, or is restarted for maintenance, Caddy continues serving the status page with 100% uptime. The page's client-side probe immediately flags the outage and presents incident communication to users.

### Tier 2: Completely Independent Host (Multi-Provider Redundancy)
- **Hosts**: Cloudflare Pages, GitHub Pages, Vercel, AWS S3, or Google Cloud Storage.
- **Resiliency**: Survives total host failure, datacenter fiber cuts, VPS provider billing/hardware outages, and network partitioning.
- **Cost**: 100% free with unlimited bandwidth on Cloudflare Pages or GitHub Pages.

---

## 2. Deploying Out-of-Band to Cloudflare Pages / GitHub Pages

Because the status page consists purely of static HTML5, CSS, and vanilla JavaScript with zero build steps or npm dependencies, deploying to an independent provider takes under 2 minutes:

### Option A: Cloudflare Pages (Recommended for Zero-Latency Global Edge)
1. In Cloudflare Dashboard, go to **Workers & Pages** -> **Create application** -> **Pages**.
2. Connect your OwnMediaHost GitHub repository.
3. Build Settings:
   - **Build command**: *(leave empty)*
   - **Build output directory**: `status`
4. Deploy!
5. In **Custom Domains**, add `status.yourdomain.com`.
6. Edit `status/incidents.json` to set your main application endpoint:
   ```json
   {
     "api_endpoint": "https://media.yourdomain.com"
   }
   ```

### Option B: GitHub Pages
1. Go to your repository on GitHub -> **Settings** -> **Pages**.
2. Source: **Deploy from a branch**.
3. Branch: `main` / Folder: `/status`.
4. Add custom domain `status.yourdomain.com` and enable HTTPS.

---

## 3. Automated 1-Line VPS Deployment (`scripts/deploy.sh`)

When deploying your VPS with `scripts/deploy.sh`:

### Interactive Mode:
The deployment wizard will prompt:
```text
=== Step 2: Public Status Page (Decoupled Incident Communication) ===
Configure decoupled public status page domain? (e.g. status.example.com) [optional, press Enter to skip]:
```

### Non-Interactive / CLI Mode:
Pass the `--status-domain` flag:
```bash
sudo bash /tmp/deploy.sh \
  --domain media.example.com \
  --status-domain status.example.com \
  --email admin@example.com
```

Caddy automatically provisions a separate virtual host and Let's Encrypt TLS certificate for `status.example.com`.

---

## 4. Incident Operator Runbook: Posting Updates in 30 Seconds

When an incident or maintenance window occurs, simply edit `status/incidents.json` on the server or in Git:

### Example: Active Incident
```json
{
  "api_endpoint": "https://media.example.com",
  "incidents": [
    {
      "id": "inc-2026-09-20-01",
      "title": "Investigating Intermittent Streaming Timeouts",
      "status": "investigating",
      "severity": "major",
      "affected_components": ["Media Streaming & CDN"],
      "updates": [
        {
          "timestamp": "Sep 20, 2026 - 14:10 UTC",
          "status": "investigating",
          "message": "We have detected elevated latency on video streaming endpoints. Engineers are investigating."
        }
      ]
    }
  ]
}
```

### Supported Status & Severity Values
- **Incident Status**: `investigating` | `identified` | `monitoring` | `resolved` | `maintenance`
- **Severity**: `critical` | `major` | `minor` | `maintenance`

As soon as `incidents.json` is saved or committed, all connected users will automatically see the live banner and timeline update within 30 seconds (or immediately on manual refresh).
