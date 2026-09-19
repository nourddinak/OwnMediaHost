# OwnMediaHost API Documentation

> **Base URL**: `https://your-domain.com/api/v1`  
> **Content Type**: `application/json` (unless uploading files)  
> **Authentication**: API Key via `X-API-Key` header or Bearer token via `Authorization` header

---

## Authentication

OwnMediaHost supports two authentication methods:

### 1. API Key (Recommended for integrations)

Pass your API key in the `X-API-Key` request header:

```bash
curl -H "X-API-Key: mk_live_wJZ5XmnxbLa4fW6QgCYx8PL7KBySI6WY" \
  https://api.example.com/api/v1/files
```

Generate API keys from the **API Keys** page in the dashboard. Each key can be scoped with specific permissions:

| Permission | Description |
|---|---|
| `files.read` | List and download files |
| `files.write` | Upload, update, and delete files |
| `folders.read` | List folders |
| `folders.write` | Create, update, and delete folders |
| `aliases.read` | List vanity aliases |
| `aliases.write` | Create and delete aliases |
| `keys.read` | List API keys |
| `keys.write` | Create and revoke API keys |
| `settings.read` | Read platform settings |
| `settings.write` | Modify platform settings |

### 2. Session Token (Dashboard login)

For the web dashboard, authenticate via email/password login:

```bash
curl -X POST https://api.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "yourpassword"}'
```

Response:
```json
{
  "success": true,
  "data": {
    "user": { "id": "usr_abc", "email": "admin@example.com" },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

Use the returned token in subsequent requests:
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  https://api.example.com/api/v1/files
```

---

## Response Format

All API responses follow a consistent envelope format:

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "File not found"
  }
}
```

### Common HTTP Status Codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request (invalid parameters) |
| `401` | Unauthorized (missing or invalid auth) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not Found |
| `409` | Conflict (duplicate file, alias already exists) |
| `413` | Payload Too Large |
| `500` | Internal Server Error |

---

## Endpoints

### System & Telemetry Endpoints

Health endpoints do not require authentication and are accessible directly by external monitoring services, load balancers, and decoupled public status pages (such as [OwnMediaHost-status](https://github.com/nourddinak/OwnMediaHost-status)). All health endpoints automatically set `Access-Control-Allow-Origin: *` to allow seamless client-side browser probing.

#### `GET /health`
Comprehensive system telemetry endpoint. Runs a live database probe, measures database query latency, calculates process uptime, and retrieves host disk capacity.

```bash
curl https://api.example.com/health
```

Response (`200 OK`):
```json
{
  "status": "operational",
  "version": "0.1.0",
  "app_env": "production",
  "uptime_seconds": 86420,
  "database": {
    "status": "connected",
    "query_latency_ms": 0.42,
    "total_media_count": 1284,
    "total_media_bytes": 15829374020
  },
  "storage": {
    "total_disk_bytes": 512000000000,
    "available_disk_bytes": 420000000000
  }
}
```

Telemetry Fields:
| Field | Type | Description |
|---|---|---|
| `status` | string | `"operational"` when database responds; `"degraded"` if query fails |
| `version` | string | Installed platform semantic version (e.g. `"0.1.0"`) |
| `app_env` | string | Runtime environment (`"production"` or `"development"`) |
| `uptime_seconds` | integer | Continuous process runtime in seconds |
| `database.status` | string | SQLite connection status (`"connected"` or `"error"`) |
| `database.query_latency_ms` | float | Execution time of `SELECT 1` probe in milliseconds |
| `database.total_media_count` | integer | Number of active (non-deleted) media files in catalog |
| `database.total_media_bytes` | integer | Total file size in bytes stored on disk |
| `storage.total_disk_bytes` | integer | Total storage capacity of primary disk partition |
| `storage.available_disk_bytes` | integer | Free available space in bytes on primary disk partition |

#### `GET /health/ready`
Readiness probe for reverse proxies (Caddy, Nginx) and orchestrators. Returns `200 OK` only when the SQLite database is healthy and ready to accept queries; otherwise returns `500 Internal Server Error`.

```bash
curl https://api.example.com/health/ready
```

Response (`200 OK`):
```json
{
  "success": true,
  "data": "ready"
}
```

#### `GET /health/live`
Sub-millisecond liveness probe. Instantly returns HTTP `200 OK` with raw text `"live"` to confirm process liveness without performing database or I/O operations.

```bash
curl https://api.example.com/health/live
```

Response (`200 OK`):
```text
live
```

#### `GET /api/v1`
API root. Returns version info and a directory of all endpoint groups.

```bash
curl https://api.example.com/api/v1
```

Response:
```json
{
  "name": "OwnMediaHost API v1",
  "version": "1.0",
  "status": "operational",
  "endpoints": {
    "auth": "/api/v1/auth",
    "files": "/api/v1/files",
    "folders": "/api/v1/folders",
    "keys": "/api/v1/keys",
    "aliases": "/api/v1/aliases",
    "storage": "/api/v1/storage",
    "activity": "/api/v1/activity",
    "settings": "/api/v1/settings"
  }
}
```

#### `GET /api/v1/storage/stats`
Returns real-time disk and storage usage statistics.

**Auth required**: Yes

```bash
curl -H "X-API-Key: YOUR_KEY" https://api.example.com/api/v1/storage/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "total_disk_bytes": 53687091200,
    "available_disk_bytes": 41943040000,
    "used_disk_bytes": 11744051200,
    "media_storage_bytes": 8589934592,
    "images_usage_bytes": 3221225472,
    "videos_usage_bytes": 5368709120,
    "thumbnails_usage_bytes": 104857600,
    "total_files_count": 342,
    "total_images_count": 280,
    "total_videos_count": 62,
    "total_trash_count": 5
  }
}
```

---

### Media Files

#### `GET /api/v1/files`
List media files with pagination and filtering.

**Auth required**: Yes

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Max items (max 200) |
| `offset` | integer | 0 | Pagination offset |
| `type` | string | — | `"image"` or `"video"` |
| `folder_id` | string | — | Filter by folder UUID |
| `tag` | string | — | Filter by tag name |
| `search` | string | — | Full-text search on filename |
| `trash` | boolean | false | If true, return trashed files only |
| `sort` | string | `created_at` | Sort by: `created_at`, `file_size`, `filename` |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api.example.com/api/v1/files?limit=10&type=image&sort=file_size"
```

Response:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "f_abc123",
        "public_id": "xK9mP2",
        "filename": "sunset-beach.jpg",
        "original_filename": "IMG_4521.jpg",
        "extension": "jpg",
        "mime_type": "image/jpeg",
        "media_type": "image",
        "file_size": 2458912,
        "width": 3840,
        "height": 2160,
        "sha256": "a1b2c3d4...",
        "visibility": "public",
        "url": "/f/xK9mP2",
        "thumbnail_url": "/thumbnails/xK9mP2.jpg",
        "tags": ["nature", "beach"],
        "aliases": ["/i/sunset"],
        "created_at": "2026-09-19T14:30:00Z",
        "updated_at": "2026-09-19T14:30:00Z"
      }
    ],
    "total": 142,
    "limit": 10,
    "offset": 0,
    "has_more": true
  }
}
```

#### `POST /api/v1/files`
Upload a media file via `multipart/form-data`.

**Auth required**: Yes

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | The image or video file |
| `folder_id` | string | No | Target folder UUID |
| `tags` | string | No | Comma-separated tags |
| `alias` | string | No | Vanity alias path |
| `visibility` | string | No | `"public"` or `"private"` |
| `thumbnail` | file | No | Client-generated thumbnail JPEG |
| `width` | integer | No | Video width (pixels) |
| `height` | integer | No | Video height (pixels) |
| `duration` | number | No | Video duration (seconds) |

**cURL**:
```bash
curl -X POST https://api.example.com/api/v1/files \
  -H "X-API-Key: YOUR_KEY" \
  -F "file=@./photo.jpg" \
  -F "tags=portfolio,hero" \
  -F "alias=hero-banner" \
  -F "visibility=public"
```

**JavaScript**:
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('tags', 'portfolio,hero');
formData.append('alias', 'hero-banner');

const response = await fetch('https://api.example.com/api/v1/files', {
  method: 'POST',
  headers: { 'X-API-Key': 'YOUR_KEY' },
  body: formData,
});

const { data } = await response.json();
console.log('Uploaded:', data.url);
```

**Python**:
```python
import requests

url = "https://api.example.com/api/v1/files"
headers = {"X-API-Key": "YOUR_KEY"}

with open("photo.jpg", "rb") as f:
    files = {"file": ("photo.jpg", f, "image/jpeg")}
    data = {"tags": "portfolio,hero", "alias": "hero-banner"}
    response = requests.post(url, headers=headers, files=files, data=data)

result = response.json()
print("Uploaded:", result["data"]["url"])
```

#### `PATCH /api/v1/files/{id}`
Update file metadata. All fields optional.

**Auth required**: Yes

```bash
curl -X PATCH https://api.example.com/api/v1/files/f_abc123 \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename": "renamed.jpg", "tags": ["updated"], "visibility": "private"}'
```

#### `PUT /api/v1/files/{id}/content`
Replace the binary content of an existing file (keeps the same ID, public ID, aliases).

**Auth required**: Yes

```bash
curl -X PUT https://api.example.com/api/v1/files/f_abc123/content \
  -H "X-API-Key: YOUR_KEY" \
  -F "file=@./new-version.jpg"
```

#### `DELETE /api/v1/files/{id}`
Soft-delete a file (move to trash). Recoverable for 30 days.

**Auth required**: Yes

```bash
curl -X DELETE https://api.example.com/api/v1/files/f_abc123 \
  -H "X-API-Key: YOUR_KEY"
```

#### `POST /api/v1/files/{id}/restore`
Restore a file from trash.

**Auth required**: Yes

```bash
curl -X POST https://api.example.com/api/v1/files/f_abc123/restore \
  -H "X-API-Key: YOUR_KEY"
```

#### `DELETE /api/v1/files/{id}/permanent`
Permanently delete a file. **This cannot be undone.**

**Auth required**: Yes

```bash
curl -X DELETE https://api.example.com/api/v1/files/f_abc123/permanent \
  -H "X-API-Key: YOUR_KEY"
```

#### `POST /api/v1/files/{id}/sign-private`
Generate a time-limited signed URL for a private file.

**Auth required**: Yes

```bash
curl -X POST https://api.example.com/api/v1/files/f_abc123/sign-private \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"expires_seconds": 3600}'
```

Response:
```json
{
  "success": true,
  "data": {
    "url": "/f/xK9mP2?token=abc123...",
    "expires_at": "2026-09-19T16:30:00Z",
    "expires_seconds": 3600
  }
}
```

#### `POST /api/v1/files/bulk`
Perform bulk operations on multiple files.

**Auth required**: Yes

```bash
curl -X POST https://api.example.com/api/v1/files/bulk \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ids": ["f_abc123", "f_def456"],
    "action": "move",
    "target_folder_id": "fld_xyz"
  }'
```

Supported actions: `delete`, `restore`, `permanent_delete`, `move`, `visibility`

---

### Folders

#### `GET /api/v1/folders`
List all folders with media counts.

**Auth required**: Yes

```bash
curl -H "X-API-Key: YOUR_KEY" https://api.example.com/api/v1/folders
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "fld_abc",
      "name": "Portfolio",
      "parent_id": null,
      "media_count": 24,
      "created_at": "2026-09-10T10:00:00Z",
      "updated_at": "2026-09-19T14:00:00Z"
    }
  ]
}
```

#### `POST /api/v1/folders`
Create a new folder.

**Auth required**: Yes

```bash
curl -X POST https://api.example.com/api/v1/folders \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Screenshots", "parent_id": null}'
```

#### `PATCH /api/v1/folders/{id}`
Rename or move a folder.

**Auth required**: Yes

```bash
curl -X PATCH https://api.example.com/api/v1/folders/fld_abc \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Renamed Folder"}'
```

#### `DELETE /api/v1/folders/{id}`
Delete a folder. Files inside are unassigned to root, not deleted.

**Auth required**: Yes

```bash
curl -X DELETE https://api.example.com/api/v1/folders/fld_abc \
  -H "X-API-Key: YOUR_KEY"
```

---

### Vanity Aliases

Aliases map human-readable paths to media files. A file with alias `hero-banner` becomes accessible at `/i/hero-banner`.

#### `GET /api/v1/aliases`
List all aliases.

**Auth required**: Yes

```bash
curl -H "X-API-Key: YOUR_KEY" https://api.example.com/api/v1/aliases
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "als_abc",
      "alias_path": "hero-banner",
      "media_id": "f_abc123",
      "media_public_id": "xK9mP2",
      "media_filename": "sunset-beach.jpg",
      "url": "/i/hero-banner",
      "created_at": "2026-09-19T14:00:00Z",
      "updated_at": "2026-09-19T14:00:00Z"
    }
  ]
}
```

#### `POST /api/v1/aliases`
Create a vanity alias for a media file.

**Auth required**: Yes

```bash
curl -X POST https://api.example.com/api/v1/aliases \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"alias_path": "company-logo", "media_id": "f_abc123"}'
```

#### `DELETE /api/v1/aliases/{id}`
Delete a vanity alias.

**Auth required**: Yes

```bash
curl -X DELETE https://api.example.com/api/v1/aliases/als_abc \
  -H "X-API-Key: YOUR_KEY"
```

---

### API Keys

#### `GET /api/v1/keys`
List all API keys (secret values are never returned after creation).

**Auth required**: Yes (session token only)

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/api/v1/keys
```

#### `POST /api/v1/keys`
Create a new scoped API key. The full secret is returned **only once**.

**Auth required**: Yes (session token only)

```bash
curl -X POST https://api.example.com/api/v1/keys \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "permissions": ["files.read", "files.write", "folders.read"],
    "expires_days": 365
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "key_new",
    "name": "my-app",
    "key_prefix": "mk_live_abc1...",
    "secret_key": "mk_live_abc1234567890fullsecretkey",
    "permissions": ["files.read", "files.write", "folders.read"],
    "created_at": "2026-09-19T16:30:00Z"
  }
}
```

#### `DELETE /api/v1/keys/{id}`
Revoke an API key. The key immediately stops working.

**Auth required**: Yes (session token only)

```bash
curl -X DELETE https://api.example.com/api/v1/keys/key_abc \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### Activity Logs

#### `GET /api/v1/activity`
Retrieve API request logs with pagination.

**Auth required**: Yes

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Max items |
| `offset` | integer | 0 | Pagination offset |

```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://api.example.com/api/v1/activity?limit=20"
```

---

### Settings

#### `GET /api/v1/settings`
Retrieve platform settings.

**Auth required**: Yes

```bash
curl -H "X-API-Key: YOUR_KEY" https://api.example.com/api/v1/settings
```

#### `PATCH /api/v1/settings`
Update platform settings.

**Auth required**: Yes

```bash
curl -X PATCH https://api.example.com/api/v1/settings \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"settings": {"max_upload_size_mb": "100"}}'
```

---

## Serving Media Files

Files are served directly via their public URL paths:

| URL Pattern | Description |
|---|---|
| `/f/{public_id}` | Direct file access by public ID |
| `/f/{public_id}.{ext}` | Direct file with explicit extension |
| `/i/{alias_path}` | Access via vanity alias |
| `/thumbnails/{public_id}.jpg` | Auto-generated thumbnail |

### Embedding in HTML

```html
<!-- Image -->
<img src="https://media.example.com/f/xK9mP2" alt="Sunset Beach" />

<!-- Video -->
<video src="https://media.example.com/f/aB3cDe" controls></video>

<!-- Via alias -->
<img src="https://media.example.com/i/hero-banner" alt="Hero" />
```

### React Component

```jsx
function MediaImage({ publicId, alt }) {
  const BASE = 'https://media.example.com';
  return (
    <img
      src={`${BASE}/f/${publicId}`}
      alt={alt}
      decoding="async"
      style={{ maxWidth: '100%', height: 'auto' }}
    />
  );
}

function MediaVideo({ publicId }) {
  const BASE = 'https://media.example.com';
  return (
    <video
      src={`${BASE}/f/${publicId}`}
      controls
      playsInline
      style={{ maxWidth: '100%' }}
    />
  );
}
```

---

## Error Handling

All errors return a consistent JSON envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "filename is required"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `DUPLICATE` | 409 | Resource already exists |
| `PAYLOAD_TOO_LARGE` | 413 | File exceeds upload size limit |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

OwnMediaHost is self-hosted and does not enforce rate limits by default. If you deploy behind a reverse proxy (Caddy, Nginx), you can configure rate limiting at the proxy level.

---

## Integration Guides

### Next.js (App Router)

```typescript
// lib/media.ts
const API_BASE = process.env.MEDIA_API_URL!;
const API_KEY = process.env.MEDIA_API_KEY!;

export async function getMediaFiles(limit = 20) {
  const res = await fetch(`${API_BASE}/api/v1/files?limit=${limit}`, {
    headers: { 'X-API-Key': API_KEY },
    next: { revalidate: 60 },
  });
  const { data } = await res.json();
  return data.items;
}

export async function uploadMedia(formData: FormData) {
  const res = await fetch(`${API_BASE}/api/v1/files`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: formData,
  });
  return res.json();
}
```

### Python SDK Pattern

```python
import requests

class OwnMediaClient:
    def __init__(self, base_url: str, api_key: str):
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["X-API-Key"] = api_key

    def list_files(self, limit=50, media_type=None):
        params = {"limit": limit}
        if media_type:
            params["type"] = media_type
        r = self.session.get(f"{self.base}/api/v1/files", params=params)
        r.raise_for_status()
        return r.json()["data"]

    def upload(self, filepath: str, tags=None, alias=None):
        data = {}
        if tags:
            data["tags"] = ",".join(tags)
        if alias:
            data["alias"] = alias
        with open(filepath, "rb") as f:
            files = {"file": f}
            r = self.session.post(f"{self.base}/api/v1/files", files=files, data=data)
        r.raise_for_status()
        return r.json()["data"]

    def delete(self, file_id: str, permanent=False):
        endpoint = f"/api/v1/files/{file_id}"
        if permanent:
            endpoint += "/permanent"
        r = self.session.delete(f"{self.base}{endpoint}")
        r.raise_for_status()
        return r.json()

# Usage
client = OwnMediaClient("https://api.example.com", "mk_live_...")
files = client.list_files(limit=10, media_type="image")
uploaded = client.upload("photo.jpg", tags=["portfolio"], alias="my-photo")
```
