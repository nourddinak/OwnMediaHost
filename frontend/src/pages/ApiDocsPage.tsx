import React, { useState, useEffect, useRef } from 'react';


interface EndpointDef {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  title: string;
  description: string;
  category: string;
  auth: boolean;
  permission?: string;
  params?: { name: string; in: 'query' | 'path' | 'body'; type: string; required: boolean; description: string }[];
  bodyExample?: string;
  responseExample: string;
}

const ENDPOINTS: EndpointDef[] = [
  // Health
  {
    id: 'health',
    method: 'GET',
    path: '/health',
    title: 'Health Check',
    description: 'Returns the operational status of the OwnMediaHost backend. Use this for uptime monitoring and load balancer health probes.',
    category: 'System',
    auth: false,
    responseExample: `{
  "success": true,
  "data": "OwnMediaHost is healthy"
}`,
  },
  {
    id: 'health-ready',
    method: 'GET',
    path: '/health/ready',
    title: 'Readiness Probe',
    description: 'Verifies the backend can connect to the SQLite database and is ready to serve requests. Returns 200 only when the database is reachable.',
    category: 'System',
    auth: false,
    responseExample: `{
  "success": true,
  "data": "ready"
}`,
  },
  {
    id: 'api-v1-root',
    method: 'GET',
    path: '/api/v1',
    title: 'API Root & Endpoint Directory',
    description: 'Returns API version information and a directory of all available endpoint groups.',
    category: 'System',
    auth: false,
    responseExample: `{
  "name": "OwnMediaHost API v1",
  "version": "1.0",
  "status": "operational",
  "documentation": "/docs",
  "endpoints": {
    "auth": "/api/v1/auth",
    "files": "/api/v1/files",
    "folders": "/api/v1/folders",
    "tags": "/api/v1/tags",
    "keys": "/api/v1/keys",
    "storage": "/api/v1/storage",
    "activity": "/api/v1/activity",
    "settings": "/api/v1/settings"
  }
}`,
  },
  // Files
  {
    id: 'list-files',
    method: 'GET',
    path: '/api/v1/files',
    title: 'List Media Files',
    description: 'Retrieve a paginated list of media files with optional filtering by type, folder, tag, visibility, and full-text search. Supports sorting and pagination.',
    category: 'Media',
    auth: true,
    permission: 'files:read',
    params: [
      { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Max items to return (default: 50, max: 200)' },
      { name: 'offset', in: 'query', type: 'integer', required: false, description: 'Pagination offset (default: 0)' },
      { name: 'type', in: 'query', type: 'string', required: false, description: 'Filter by media type: "image" or "video"' },
      { name: 'folder_id', in: 'query', type: 'string', required: false, description: 'Filter by folder UUID' },
      { name: 'tag', in: 'query', type: 'string', required: false, description: 'Filter by tag name' },
      { name: 'search', in: 'query', type: 'string', required: false, description: 'Full-text search across filename' },
      { name: 'trash', in: 'query', type: 'boolean', required: false, description: 'If true, returns only soft-deleted files' },
      { name: 'sort', in: 'query', type: 'string', required: false, description: 'Sort field: "created_at", "file_size", "filename" (default: created_at desc)' },
    ],
    responseExample: `{
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
    "limit": 50,
    "offset": 0,
    "has_more": true
  }
}`,
  },
  {
    id: 'upload-file',
    method: 'POST',
    path: '/api/v1/files',
    title: 'Upload Media File',
    description: 'Upload an image or video file via multipart/form-data. Supports optional folder assignment, tags, vanity alias, and client-generated thumbnail for videos.',
    category: 'Media',
    auth: true,
    permission: 'files:write',
    params: [
      { name: 'file', in: 'body', type: 'file', required: true, description: 'The media file to upload (multipart field)' },
      { name: 'folder_id', in: 'body', type: 'string', required: false, description: 'UUID of folder to place the file in' },
      { name: 'tags', in: 'body', type: 'string', required: false, description: 'Comma-separated list of tags' },
      { name: 'alias', in: 'body', type: 'string', required: false, description: 'Vanity alias path (e.g. "hero-banner")' },
      { name: 'visibility', in: 'body', type: 'string', required: false, description: '"public" or "private" (default: public)' },
      { name: 'thumbnail', in: 'body', type: 'file', required: false, description: 'Client-generated thumbnail JPEG for videos' },
      { name: 'width', in: 'body', type: 'integer', required: false, description: 'Video width in pixels (from client extraction)' },
      { name: 'height', in: 'body', type: 'integer', required: false, description: 'Video height in pixels (from client extraction)' },
      { name: 'duration', in: 'body', type: 'number', required: false, description: 'Video duration in seconds (from client extraction)' },
    ],
    bodyExample: `# Using cURL multipart form upload:
curl -X POST {BASE_URL}/api/v1/files \\
  -H "X-API-Key: {API_KEY}" \\
  -F "file=@./photo.jpg" \\
  -F "tags=portfolio,hero" \\
  -F "alias=hero-banner"`,
    responseExample: `{
  "success": true,
  "data": {
    "id": "f_new789",
    "public_id": "aB3cDe",
    "filename": "photo.jpg",
    "original_filename": "photo.jpg",
    "extension": "jpg",
    "mime_type": "image/jpeg",
    "media_type": "image",
    "file_size": 1548288,
    "width": 1920,
    "height": 1080,
    "sha256": "e5f6a7b8...",
    "visibility": "public",
    "url": "/f/aB3cDe",
    "thumbnail_url": "/thumbnails/aB3cDe.jpg",
    "tags": ["portfolio", "hero"],
    "aliases": ["/i/hero-banner"],
    "created_at": "2026-09-19T15:00:00Z",
    "updated_at": "2026-09-19T15:00:00Z"
  }
}`,
  },
  {
    id: 'update-file',
    method: 'PATCH',
    path: '/api/v1/files/{id}',
    title: 'Update File Metadata',
    description: 'Update a file\'s metadata including filename, folder assignment, visibility, and tags. All fields are optional.',
    category: 'Media',
    auth: true,
    permission: 'files:write',
    params: [
      { name: 'id', in: 'path', type: 'string', required: true, description: 'File UUID or public ID' },
    ],
    bodyExample: `{
  "filename": "renamed-photo.jpg",
  "folder_id": "folder_uuid_here",
  "visibility": "public",
  "tags": ["updated", "portfolio"]
}`,
    responseExample: `{
  "success": true,
  "data": { "id": "f_abc123", "filename": "renamed-photo.jpg", "..." : "..." }
}`,
  },
  {
    id: 'delete-file',
    method: 'DELETE',
    path: '/api/v1/files/{id}',
    title: 'Soft-Delete File (Trash)',
    description: 'Moves a file to the trash. The file can be restored within the retention period (default: 30 days).',
    category: 'Media',
    auth: true,
    permission: 'files:delete',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'File UUID or public ID' }],
    responseExample: `{
  "success": true,
  "data": "File moved to trash"
}`,
  },
  {
    id: 'restore-file',
    method: 'POST',
    path: '/api/v1/files/{id}/restore',
    title: 'Restore File from Trash',
    description: 'Restores a previously soft-deleted file from the trash back to the media library.',
    category: 'Media',
    auth: true,
    permission: 'files:write',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'File UUID or public ID' }],
    responseExample: `{
  "success": true,
  "data": "File restored"
}`,
  },
  {
    id: 'permanent-delete',
    method: 'DELETE',
    path: '/api/v1/files/{id}/permanent',
    title: 'Permanently Delete File',
    description: 'Irrevocably deletes the file from disk and database. This action cannot be undone.',
    category: 'Media',
    auth: true,
    permission: 'files:delete',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'File UUID or public ID' }],
    responseExample: `{
  "success": true,
  "data": "File permanently deleted"
}`,
  },
  {
    id: 'replace-content',
    method: 'PUT',
    path: '/api/v1/files/{id}/content',
    title: 'Replace File Content',
    description: 'Replace the actual file content of an existing media item while preserving its ID, public ID, aliases, and metadata.',
    category: 'Media',
    auth: true,
    permission: 'files:write',
    params: [
      { name: 'id', in: 'path', type: 'string', required: true, description: 'File UUID or public ID' },
      { name: 'file', in: 'body', type: 'file', required: true, description: 'Replacement file (multipart)' },
    ],
    responseExample: `{
  "success": true,
  "data": { "id": "f_abc123", "filename": "updated.jpg", "..." : "..." }
}`,
  },
  // Folders
  {
    id: 'list-folders',
    method: 'GET',
    path: '/api/v1/folders',
    title: 'List Folders',
    description: 'Retrieve all folders. Each folder includes its media count.',
    category: 'Folders',
    auth: true,
    permission: 'folders:read',
    responseExample: `{
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
}`,
  },
  {
    id: 'create-folder',
    method: 'POST',
    path: '/api/v1/folders',
    title: 'Create Folder',
    description: 'Create a new folder for organizing media files.',
    category: 'Folders',
    auth: true,
    permission: 'folders:write',
    bodyExample: `{
  "name": "Screenshots",
  "parent_id": null
}`,
    responseExample: `{
  "success": true,
  "data": {
    "id": "fld_new",
    "name": "Screenshots",
    "parent_id": null,
    "media_count": 0,
    "created_at": "2026-09-19T15:30:00Z",
    "updated_at": "2026-09-19T15:30:00Z"
  }
}`,
  },
  {
    id: 'delete-folder',
    method: 'DELETE',
    path: '/api/v1/folders/{id}',
    title: 'Delete Folder',
    description: 'Delete a folder. Files inside are unassigned (moved to root), not deleted.',
    category: 'Folders',
    auth: true,
    permission: 'folders:write',
    params: [{ name: 'id', in: 'path', type: 'string', required: true, description: 'Folder UUID' }],
    responseExample: `{
  "success": true,
  "data": "Folder deleted"
}`,
  },
  // Aliases
  {
    id: 'list-aliases',
    method: 'GET',
    path: '/api/v1/aliases',
    title: 'List Vanity Aliases',
    description: 'Retrieve all vanity URL aliases. Aliases map human-readable paths like /i/hero to media files.',
    category: 'Aliases',
    auth: true,
    permission: 'aliases:read',
    responseExample: `{
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
}`,
  },
  {
    id: 'create-alias',
    method: 'POST',
    path: '/api/v1/aliases',
    title: 'Create Vanity Alias',
    description: 'Create a human-readable vanity URL alias for a media file. The alias becomes accessible at /i/{alias_path}.',
    category: 'Aliases',
    auth: true,
    permission: 'aliases:write',
    bodyExample: `{
  "alias_path": "logo",
  "media_id": "f_abc123"
}`,
    responseExample: `{
  "success": true,
  "data": {
    "id": "als_new",
    "alias_path": "logo",
    "media_id": "f_abc123",
    "url": "/i/logo",
    "created_at": "2026-09-19T16:00:00Z"
  }
}`,
  },
  // Keys
  {
    id: 'list-keys',
    method: 'GET',
    path: '/api/v1/keys',
    title: 'List API Keys',
    description: 'List all API keys for the authenticated user. Secret key values are never returned after creation.',
    category: 'API Keys',
    auth: true,
    permission: 'admin',
    responseExample: `{
  "success": true,
  "data": [
    {
      "id": "key_abc",
      "name": "portfolio",
      "key_prefix": "mk_live_wJZ5...",
      "permissions": ["files.read", "files.write", "folders.read"],
      "last_used_at": null,
      "created_at": "2026-09-19T14:00:00Z"
    }
  ]
}`,
  },
  {
    id: 'create-key',
    method: 'POST',
    path: '/api/v1/keys',
    title: 'Create API Key',
    description: 'Generate a new scoped API key. The full secret key is returned ONLY once in the response and cannot be retrieved again.',
    category: 'API Keys',
    auth: true,
    permission: 'admin',
    bodyExample: `{
  "name": "my-app",
  "permissions": ["files.read", "files.write", "folders.read", "folders.write"],
  "expires_days": 365
}`,
    responseExample: `{
  "success": true,
  "data": {
    "id": "key_new",
    "name": "my-app",
    "key_prefix": "mk_live_abc1...",
    "secret_key": "mk_live_abc1234567890fullsecretkey",
    "permissions": ["files.read", "files.write", "folders.read", "folders.write"],
    "created_at": "2026-09-19T16:30:00Z"
  }
}`,
  },
  // Storage
  {
    id: 'storage-stats',
    method: 'GET',
    path: '/api/v1/storage/stats',
    title: 'Storage Statistics',
    description: 'Returns real-time disk usage statistics including total/available disk space, per-type breakdowns, and file counts.',
    category: 'System',
    auth: true,
    permission: 'admin',
    responseExample: `{
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
}`,
  },
];

const CATEGORIES = ['System', 'Media', 'Folders', 'Aliases', 'API Keys'];

const METHOD_COLORS: Record<string, string> = {
  GET: '#22c55e',
  POST: '#3b82f6',
  PATCH: '#f59e0b',
  PUT: '#a855f7',
  DELETE: '#ef4444',
};

type SnippetLang = 'curl' | 'javascript' | 'python' | 'react';

function generateSnippet(ep: EndpointDef, lang: SnippetLang, baseUrl: string, apiKey: string): string {
  const fullUrl = `${baseUrl}${ep.path}`;
  const keyHeader = apiKey ? apiKey : 'YOUR_API_KEY';

  if (lang === 'curl') {
    let cmd = `curl -X ${ep.method} "${fullUrl}"`;
    if (ep.auth) cmd += ` \\\n  -H "Authorization: Bearer ${keyHeader}"`;
    if (ep.bodyExample && !ep.bodyExample.startsWith('#')) {
      cmd += ` \\\n  -H "Content-Type: application/json"`;
      cmd += ` \\\n  -d '${ep.bodyExample.trim()}'`;
    }
    if (ep.method === 'POST' && ep.path.endsWith('/files') && !ep.path.includes('{')) {
      cmd = `curl -X POST "${fullUrl}"`;
      if (ep.auth) cmd += ` \\\n  -H "Authorization: Bearer ${keyHeader}"`;
      cmd += ` \\\n  -F "file=@./photo.jpg"`;
      cmd += ` \\\n  -F "tags=portfolio,nature"`;
      cmd += ` \\\n  -F "alias=my-photo"`;
    }
    return cmd;
  }

  if (lang === 'javascript') {
    if (ep.method === 'POST' && ep.path.endsWith('/files') && !ep.path.includes('{')) {
      return `const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('tags', 'portfolio,nature');
formData.append('alias', 'my-photo');

const response = await fetch('${fullUrl}', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${keyHeader}',
  },
  body: formData,
});

const { success, data } = await response.json();
console.log('Uploaded:', data.url);`;
    }

    let body = '';
    if (ep.bodyExample && !ep.bodyExample.startsWith('#')) {
      body = `,\n  body: JSON.stringify(${ep.bodyExample.trim()})`;
    }
    return `const response = await fetch('${fullUrl}', {
  method: '${ep.method}',
  headers: {
    'Content-Type': 'application/json',${ep.auth ? `\n    'Authorization': 'Bearer ${keyHeader}',` : ''}
  }${body},
});

const { success, data } = await response.json();
console.log(data);`;
  }

  if (lang === 'python') {
    if (ep.method === 'POST' && ep.path.endsWith('/files') && !ep.path.includes('{')) {
      return `import requests

url = "${fullUrl}"
headers = {"Authorization": "Bearer ${keyHeader}"}

with open("photo.jpg", "rb") as f:
    files = {"file": ("photo.jpg", f, "image/jpeg")}
    data = {"tags": "portfolio,nature", "alias": "my-photo"}
    response = requests.post(url, headers=headers, files=files, data=data)

result = response.json()
print("Uploaded:", result["data"]["url"])`;
    }

    let body = '';
    if (ep.bodyExample && !ep.bodyExample.startsWith('#')) {
      body = `, json=${ep.bodyExample.trim()}`;
    }
    return `import requests

url = "${fullUrl}"
headers = {${ep.auth ? `\n    "Authorization": "Bearer ${keyHeader}",` : ''}
    "Content-Type": "application/json",
}

response = requests.${ep.method.toLowerCase()}(url, headers=headers${body})
data = response.json()
print(data)`;
  }

  if (lang === 'react') {
    if (ep.id === 'list-files') {
      return `import { useEffect, useState } from 'react';

function MediaGallery() {
  const [files, setFiles] = useState([]);
  const API_KEY = '${keyHeader}';
  const BASE = '${baseUrl}';

  useEffect(() => {
    fetch(\`\${BASE}/api/v1/files?limit=20\`, {
      headers: { 'Authorization': \`Bearer \${API_KEY}\` },
    })
      .then(res => res.json())
      .then(({ data }) => setFiles(data.items));
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
      {files.map((file) => (
        <div key={file.id}>
          {file.media_type === 'video' ? (
            <video src={\`\${BASE}\${file.url}\`} controls style={{ width: '100%' }} />
          ) : (
            <img src={\`\${BASE}\${file.thumbnail_url || file.url}\`} alt={file.filename} style={{ width: '100%' }} />
          )}
          <p style={{ fontSize: 12 }}>{file.filename}</p>
        </div>
      ))}
    </div>
  );
}`;
    }
    if (ep.id === 'upload-file') {
      return `import { useState, useRef } from 'react';

function FileUploader() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const API_KEY = '${keyHeader}';
  const BASE = '${baseUrl}';

  const handleUpload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('tags', 'uploaded-via-react');

    const res = await fetch(\`\${BASE}/api/v1/files\`, {
      method: 'POST',
      headers: { 'Authorization': \`Bearer \${API_KEY}\` },
      body: form,
    });
    const { data } = await res.json();
    setResult(data);
    setUploading(false);
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*,video/*" />
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? 'Uploading...' : 'Upload'}
      </button>
      {result && <p>Uploaded: <a href={\`\${BASE}\${result.url}\`}>{result.filename}</a></p>}
    </div>
  );
}`;
    }
    return `// React component example not available for this endpoint.\n// Use the JavaScript tab for fetch-based usage.`;
  }
  return '';
}

export const ApiDocsPage: React.FC = () => {
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('health');
  const [selectedLang, setSelectedLang] = useState<SnippetLang>('curl');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [copiedId, setCopiedId] = useState('');

  // Try It Live state
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveResponse, setLiveResponse] = useState<{ status: number; latency: number; body: string } | null>(null);

  const responseRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Auto-detect base URL: prefer explicit backend URL, then API base origin, then current origin
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const envBase = import.meta.env.VITE_API_BASE_URL || '';
    if (backendUrl) {
      setBaseUrl(backendUrl.replace(/\/+$/, ''));
    } else if (envBase && envBase.startsWith('http')) {
      const url = new URL(envBase);
      setBaseUrl(`${url.protocol}//${url.host}`);
    } else {
      setBaseUrl(window.location.origin);
    }
  }, []);

  const ep = ENDPOINTS.find((e) => e.id === selectedEndpoint)!;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const handleTryItLive = async () => {
    setLiveLoading(true);
    setLiveResponse(null);
    const start = performance.now();
    try {
      // In local dev targeting localhost, route through Vite proxy (/api, /health)
      // In production (or targeting external URL), fetch directly from the API base domain
      const isLocalhost = !baseUrl || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
      const url = (import.meta.env.DEV && isLocalhost)
        ? ep.path
        : `${baseUrl.replace(/\/+$/, '')}${ep.path}`;

      const headers: Record<string, string> = {};
      if (ep.auth && apiKey) {
        // Universal Authorization header allowed by CORS on all server & proxy environments
        headers['Authorization'] = `Bearer ${apiKey.trim()}`;
      }
      const res = await fetch(url, {
        method: ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH' ? 'GET' : ep.method,
        headers,
        credentials: 'include',
      });
      const latency = Math.round(performance.now() - start);
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch { /* not JSON */ }
      setLiveResponse({ status: res.status, latency, body });
    } catch (err: any) {
      const latency = Math.round(performance.now() - start);
      setLiveResponse({ status: 0, latency, body: `Network error: ${err.message}` });
    } finally {
      setLiveLoading(false);
    }
  };

  const snippet = generateSnippet(ep, selectedLang, baseUrl, apiKey);

  const langLabels: Record<SnippetLang, string> = {
    curl: 'cURL',
    javascript: 'JavaScript',
    python: 'Python',
    react: 'React',
  };

  return (
    <div style={{ display: 'flex', gap: '0', height: '100%', overflow: 'hidden' }}>
      {/* Left sidebar: endpoint list */}
      <div
        style={{
          width: '260px',
          minWidth: '260px',
          borderRight: '1px solid var(--border-subtle)',
          overflowY: 'auto',
          background: 'var(--bg-secondary)',
          padding: '12px 0',
        }}
      >
        <div style={{ padding: '0 16px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Endpoints
        </div>
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <div
              style={{
                padding: '6px 16px',
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                marginTop: '8px',
              }}
            >
              {cat}
            </div>
            {ENDPOINTS.filter((e) => e.category === cat).map((e) => (
              <div
                key={e.id}
                onClick={() => { setSelectedEndpoint(e.id); setLiveResponse(null); }}
                style={{
                  padding: '7px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  background: selectedEndpoint === e.id ? 'var(--bg-tertiary)' : 'transparent',
                  color: selectedEndpoint === e.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderLeft: selectedEndpoint === e.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    background: `${METHOD_COLORS[e.method]}20`,
                    color: METHOD_COLORS[e.method],
                    minWidth: '38px',
                    textAlign: 'center',
                  }}
                >
                  {e.method}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.title}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Right panel: endpoint detail */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {/* API Configuration Bar */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: '24px',
            padding: '12px 16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Base URL
          </div>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '5px',
              padding: '5px 10px',
              color: '#fff',
              fontSize: '12px',
              fontFamily: 'monospace',
              width: '240px',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            API Key
          </div>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="mk_live_..."
            type="password"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '5px',
              padding: '5px 10px',
              color: '#fff',
              fontSize: '12px',
              fontFamily: 'monospace',
              flex: 1,
              minWidth: '180px',
            }}
          />
        </div>

        {/* Endpoint Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                fontFamily: 'monospace',
                padding: '3px 10px',
                borderRadius: '4px',
                background: `${METHOD_COLORS[ep.method]}20`,
                color: METHOD_COLORS[ep.method],
              }}
            >
              {ep.method}
            </span>
            <code style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
              {ep.path}
            </code>
            {ep.auth && (
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(251, 146, 60, 0.15)', color: '#fb923c', fontWeight: 600 }}>
                AUTH
              </span>
            )}
            {ep.permission && (
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', fontWeight: 600, fontFamily: 'monospace' }}>
                SCOPE: {ep.permission}
              </span>
            )}
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '8px 0 4px' }}>{ep.title}</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', maxWidth: '700px' }}>{ep.description}</p>
        </div>

        {/* Parameters */}
        {ep.params && ep.params.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>Parameters</h3>
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)' }}>Name</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)' }}>In</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)' }}>Type</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)' }}>Required</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-tertiary)' }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ep.params.map((p) => (
                    <tr key={p.name} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '8px 12px' }}><code style={{ color: '#93c5fd', fontFamily: 'monospace' }}>{p.name}</code></td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>{p.in}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-tertiary)' }}>{p.type}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {p.required ? <span style={{ color: '#ef4444' }}>Yes</span> : <span style={{ color: 'var(--text-tertiary)' }}>No</span>}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Code Snippets */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Code Examples</h3>
            <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '2px' }}>
              {(Object.keys(langLabels) as SnippetLang[]).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setSelectedLang(lang)}
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 500,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: selectedLang === lang ? 'var(--accent-primary)' : 'transparent',
                    color: selectedLang === lang ? '#fff' : 'var(--text-tertiary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {langLabels[lang]}
                </button>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <pre
              style={{
                background: '#0d0d0e',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '16px',
                fontSize: '12px',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: '#d4d4d8',
                overflow: 'auto',
                maxHeight: '400px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {snippet}
            </pre>
            <button
              onClick={() => copyToClipboard(snippet, 'snippet')}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: copiedId === 'snippet' ? '#22c55e' : 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                padding: '4px 10px',
                color: '#fff',
                fontSize: '11px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {copiedId === 'snippet' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Try It Live */}
        {(ep.method === 'GET') && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Try It Live</h3>
              <button
                onClick={handleTryItLive}
                disabled={liveLoading}
                style={{
                  background: liveLoading ? 'var(--bg-tertiary)' : 'var(--accent-primary)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 16px',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: liveLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                {liveLoading ? (
                  <span>Sending...</span>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Send Request
                  </>
                )}
              </button>
            </div>
            {liveResponse && (
              <div
                style={{
                  background: '#0d0d0e',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '16px',
                    padding: '8px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '12px',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: liveResponse.status >= 200 && liveResponse.status < 300 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                    {liveResponse.status || 'ERR'}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{liveResponse.latency}ms</span>
                  <button
                    onClick={() => copyToClipboard(liveResponse.body, 'live')}
                    style={{
                      marginLeft: 'auto',
                      background: copiedId === 'live' ? '#22c55e' : 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      color: '#fff',
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    {copiedId === 'live' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre
                  ref={responseRef}
                  style={{
                    padding: '12px 16px',
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    color: '#a1a1aa',
                    overflow: 'auto',
                    maxHeight: '350px',
                    lineHeight: '1.5',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {liveResponse.body}
                </pre>
                {liveResponse.status === 403 && (
                  <div style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.1)', borderTop: '1px solid rgba(239, 68, 68, 0.2)', fontSize: '12px', color: '#fca5a5' }}>
                    ⚠️ <strong>Permission Denied (403):</strong> Your API key does not have the <code>{ep.permission || 'required'}</code> permission for this endpoint. Go to <strong>Settings → API Keys</strong> to generate a key with the appropriate scope.
                  </div>
                )}
                {liveResponse.status === 401 && (
                  <div style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.1)', borderTop: '1px solid rgba(239, 68, 68, 0.2)', fontSize: '12px', color: '#fca5a5' }}>
                    ⚠️ <strong>Unauthorized (401):</strong> Missing or invalid API key. Make sure to paste a valid key starting with <code>mk_live_</code> into the API Key input above.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Example Response */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Response Example</h3>
            <button
              onClick={() => copyToClipboard(ep.responseExample, 'response')}
              style={{
                background: copiedId === 'response' ? '#22c55e' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                padding: '3px 10px',
                color: '#fff',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {copiedId === 'response' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre
            style={{
              background: '#0d0d0e',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              color: '#86efac',
              overflow: 'auto',
              maxHeight: '400px',
              lineHeight: '1.5',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {ep.responseExample}
          </pre>
        </div>

        {/* Authentication note */}
        {ep.auth && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(251, 146, 60, 0.08)',
            border: '1px solid rgba(251, 146, 60, 0.2)',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#fdba74',
            lineHeight: '1.6',
          }}>
            <strong>Authentication Required</strong> &mdash; Pass your API key via the <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: '3px' }}>X-API-Key</code> header
            or use <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: '3px' }}>Authorization: Bearer {'<token>'}</code> from a session login.
            Generate API keys from the <strong>API Keys</strong> page in the dashboard.
          </div>
        )}
      </div>
    </div>
  );
};
