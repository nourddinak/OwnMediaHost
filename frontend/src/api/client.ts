// API Client for OwnMediaHost

export interface MediaItem {
  id: string;
  public_id: string;
  filename: string;
  original_filename: string;
  extension: string;
  mime_type: string;
  media_type: 'image' | 'video';
  file_size: number;
  width?: number;
  height?: number;
  duration?: number;
  video_codec?: string;
  audio_codec?: string;
  bitrate?: number;
  frame_rate?: number;
  sha256: string;
  visibility: 'public' | 'private';
  folder_id?: string;
  folder_name?: string;
  url: string;
  thumbnail_url?: string;
  tags: string[];
  aliases: string[];
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface FolderItem {
  id: string;
  name: string;
  parent_id?: string;
  media_count: number;
  created_at: string;
  updated_at: string;
}

export interface AliasItem {
  id: string;
  alias_path: string;
  media_id: string;
  media_public_id: string;
  media_filename: string;
  url: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
  created_at: string;
  secret_key?: string;
}

export interface StorageStats {
  total_disk_bytes: number;
  available_disk_bytes: number;
  used_disk_bytes: number;
  media_storage_bytes: number;
  images_usage_bytes: number;
  videos_usage_bytes: number;
  thumbnails_usage_bytes: number;
  total_files_count: number;
  total_images_count: number;
  total_videos_count: number;
  total_trash_count: number;
}

export interface ApiLogItem {
  id: string;
  request_id: string;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  ip_address?: string;
  created_at: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

const API_BASE =
  (typeof window !== 'undefined' && (window as any).__OMH_API_BASE__) ||
  import.meta.env.VITE_API_BASE_URL ||
  '/api/v1';
const TOKEN_KEY = 'ownmediahost_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getStoredToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  const isCrossOrigin =
    typeof window !== 'undefined' &&
    API_BASE.startsWith('http') &&
    !API_BASE.includes(window.location.host);

  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (netErr: any) {
    if (isCrossOrigin) {
      try {
        response = await fetch(`/api/v1${endpoint}`, {
          ...options,
          headers,
          credentials: 'include',
        });
      } catch {
        throw netErr;
      }
    } else {
      throw netErr;
    }
  }

  const contentType = response.headers.get('content-type') || '';
  let json: any;
  if (contentType.includes('application/json')) {
    json = await response.json();
  } else {
    // If cross-origin returned non-JSON (e.g. Caddy routing or SSL error), attempt same-origin fallback
    if (isCrossOrigin) {
      try {
        const fallbackRes = await fetch(`/api/v1${endpoint}`, {
          ...options,
          headers,
          credentials: 'include',
        });
        const fbContentType = fallbackRes.headers.get('content-type') || '';
        if (fbContentType.includes('application/json')) {
          const fbJson = await fallbackRes.json();
          if (fallbackRes.ok && fbJson.success !== false) {
            return fbJson.data !== undefined ? fbJson.data : (fbJson as T);
          }
        }
      } catch {}
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText || text.slice(0, 100)}`);
    }
    throw new Error(`Received unexpected non-JSON response from server (${contentType || 'HTML'}). Reverse proxy routing error.`);
  }

  if (!response.ok || !json.success) {
    const errorMsg = json.error?.message || 'API request failed';
    throw new Error(errorMsg);
  }

  return json.data !== undefined ? json.data : (json as T);
}

export interface UpdateCheckResponse {
  has_update: boolean;
  release_ready: boolean;
  is_building: boolean;
  current_commit: string;
  current_short_commit: string;
  latest_commit: string;
  latest_short_commit: string;
  release_commit: string;
  release_short_commit: string;
  commit_message: string;
  author: string;
  published_at: string;
  release_url: string;
  release_tag: string;
  checked_at: string;
}

export const api = {
  // Auth
  login: async (data: { email: string; password?: string }) => {
    const res = await request<{ user: { id: string; email: string; role: string }; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.token) {
      setStoredToken(res.token);
    }
    return res;
  },

  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
    }
  },

  getMe: () => request<{ type: string; user?: { id: string; email: string } }>('/auth/me'),

  // Media Files
  listFiles: (params: {
    folder_id?: string;
    type?: string;
    media_type?: string;
    visibility?: string;
    search?: string;
    tag?: string;
    sort?: string;
    order?: string;
    limit?: number;
    offset?: number;
    trash?: boolean;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return request<PaginatedResult<MediaItem>>(`/files?${qs.toString()}`);
  },

  getFile: (id: string) => request<MediaItem>(`/files/${id}`),

  uploadFile: (
    file: File,
    opts: {
      folder_id?: string;
      alias?: string;
      visibility?: string;
      duplicate_mode?: string;
      tags?: string[];
      thumbnail?: Blob;
      width?: number;
      height?: number;
      duration?: number;
      onProgress?: (pct: number) => void;
    } = {}
  ): Promise<MediaItem> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/files`);
      xhr.withCredentials = true;

      const token = getStoredToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (opts.onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            opts.onProgress!(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && json.success) {
            resolve(json.data);
          } else {
            reject(new Error(json.error?.message || `Upload failed with status ${xhr.status}`));
          }
        } catch {
          reject(new Error('Invalid response from server'));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));

      const formData = new FormData();
      formData.append('file', file);
      if (opts.thumbnail) formData.append('thumbnail', opts.thumbnail, 'thumbnail.jpg');
      if (opts.width !== undefined && opts.width !== null) formData.append('width', String(opts.width));
      if (opts.height !== undefined && opts.height !== null) formData.append('height', String(opts.height));
      if (opts.duration !== undefined && opts.duration !== null) formData.append('duration', String(opts.duration));
      if (opts.folder_id) formData.append('folder_id', opts.folder_id);
      if (opts.alias) formData.append('alias', opts.alias);
      if (opts.visibility) formData.append('visibility', opts.visibility);
      if (opts.duplicate_mode) formData.append('duplicate_mode', opts.duplicate_mode);
      if (opts.tags && opts.tags.length > 0) formData.append('tags', opts.tags.join(','));

      xhr.send(formData);
    });
  },

  updateFile: (
    id: string,
    data: { filename?: string; folder_id?: string | null; visibility?: string; tags?: string[] }
  ) =>
    request<MediaItem>(`/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteFile: (id: string) => request(`/files/${id}`, { method: 'DELETE' }),

  restoreFile: (id: string) => request(`/files/${id}/restore`, { method: 'POST' }),

  permanentDeleteFile: (id: string) => request(`/files/${id}/permanent`, { method: 'DELETE' }),

  bulkOperation: (data: {
    ids: string[];
    action: 'delete' | 'restore' | 'permanent_delete' | 'move' | 'visibility';
    target_folder_id?: string;
    target_visibility?: string;
  }) =>
    request('/files/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  signPrivateUrl: (id: string, expires_seconds: number) =>
    request<{ url: string; expires_at: string; expires_seconds: number }>(`/files/${id}/sign-private`, {
      method: 'POST',
      body: JSON.stringify({ expires_seconds }),
    }),

  // Folders
  listFolders: () => request<FolderItem[]>('/folders'),
  createFolder: (data: { name: string; parent_id?: string }) =>
    request<FolderItem>('/folders', { method: 'POST', body: JSON.stringify(data) }),
  updateFolder: (id: string, data: { name?: string; parent_id?: string }) =>
    request<FolderItem>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFolder: (id: string) => request(`/folders/${id}`, { method: 'DELETE' }),

  // Tags
  listTags: () => request<string[]>('/tags'),

  // Aliases
  listAliases: () => request<AliasItem[]>('/aliases'),
  createAlias: (data: { alias_path: string; media_id: string }) =>
    request<AliasItem>('/aliases', { method: 'POST', body: JSON.stringify(data) }),
  deleteAlias: (id: string) => request(`/aliases/${id}`, { method: 'DELETE' }),

  // Keys
  listKeys: () => request<ApiKeyItem[]>('/keys'),
  createKey: (data: { name: string; permissions: string[]; expires_days?: number }) =>
    request<ApiKeyItem>('/keys', { method: 'POST', body: JSON.stringify(data) }),
  revokeKey: (id: string) => request(`/keys/${id}`, { method: 'DELETE' }),

  // Storage & Activity & Settings
  getStorageStats: () => request<StorageStats>('/storage/stats'),
  getActivityLogs: (params: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return request<PaginatedResult<ApiLogItem>>(`/activity?${qs.toString()}`);
  },
  getSettings: () => request<Record<string, string>>('/settings'),
  updateSettings: (settings: Record<string, string>) =>
    request('/settings', { method: 'PATCH', body: JSON.stringify({ settings }) }),
  triggerUpdate: () => request('/system/trigger-update', { method: 'POST' }),
  getUpdateStatus: () => request<{ running: boolean; success: boolean; log: string }>('/system/update-status'),
  checkUpdate: (force = false) =>
    request<UpdateCheckResponse>(`/system/update-check${force ? '?force=true' : ''}`),
  getVersion: () =>
    request<{ app_name: string; version: string; commit: string; short_commit: string }>('/system/version'),
  getHealth: async (): Promise<{ status: string }> => {
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      if (res.ok) {
        return await res.json();
      }
      return { status: 'degraded' };
    } catch {
      return { status: 'offline' };
    }
  },
};
