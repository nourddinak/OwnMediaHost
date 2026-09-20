import React, { useState, useEffect } from 'react';
import { api, ApiKeyItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { copyWithToast } from '../utils/clipboard';
import { Pagination } from '../components/common/Pagination';

export const ApiKeysPage: React.FC = () => {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [name, setName] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([
    'files:read',
    'files:write',
  ]);
  const [expiresDays, setExpiresDays] = useState<number | undefined>(undefined);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<ApiKeyItem | null>(null);

  const availablePermissions = [
    { id: 'files:read', label: 'files:read (View & search media)' },
    { id: 'files:write', label: 'files:write (Upload & update media)' },
    { id: 'files:delete', label: 'files:delete (Delete media)' },
    { id: 'folders:read', label: 'folders:read (List folders)' },
    { id: 'folders:write', label: 'folders:write (Create/delete folders)' },
    { id: 'aliases:read', label: 'aliases:read (List aliases)' },
    { id: 'aliases:write', label: 'aliases:write (Create/delete aliases)' },
    { id: 'admin', label: 'admin (Full unrestricted administrative access)' },
  ];

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const items = await api.listKeys();
      setKeys(items);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast('Please enter a name for the API key', 'error');
      return;
    }
    try {
      const created = await api.createKey({
        name: name.trim(),
        permissions: selectedPerms,
        expires_days: expiresDays,
      });
      setNewlyCreatedKey(created);
      setName('');
      setCreating(false);
      fetchKeys();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleRevoke = async (id: string, keyName: string) => {
    if (!confirm(`Are you sure you want to revoke API key '${keyName}'? Any services using it will immediately be blocked.`)) {
      return;
    }
    try {
      await api.revokeKey(id);
      toast('API key revoked');
      fetchKeys();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const togglePerm = (perm: string) => {
    setSelectedPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const copySecret = async (secret: string) => {
    await copyWithToast(secret, toast, 'API key copied to clipboard!');
  };

  const totalPages = Math.ceil(keys.length / pageSize) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paginatedKeys = keys.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="page-container" style={{ maxWidth: '920px' }}>
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">API Keys</h1>
          <p className="page-subtitle">
            Manage programmatic access keys for applications, mobile clients, scripts, and portfolio websites.
          </p>
        </div>

        <button onClick={() => setCreating(true)} className="btn btn-primary press-scale">
          + Create Key
        </button>
      </div>

      {/* Secret Display Banner (Shown ONCE upon creation) */}
      {newlyCreatedKey?.secret_key && (
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px' }}>
              Important: Copy this API key now
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            For security, the secret key is hashed and cannot be displayed again. If you lose it, you will need to generate a new key.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: '#09090b',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '8px 12px',
              flexWrap: 'wrap',
            }}
          >
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: '#fff',
                flex: 1,
                minWidth: '200px',
                wordBreak: 'break-all',
              }}
            >
              {newlyCreatedKey.secret_key}
            </code>
            <button
              onClick={() => copySecret(newlyCreatedKey.secret_key!)}
              className="btn btn-primary press-scale"
              style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '6px' }}
            >
              Copy Secret
            </button>
          </div>

          <button
            onClick={() => setNewlyCreatedKey(null)}
            style={{ alignSelf: 'flex-start', fontSize: '11px', color: 'var(--text-tertiary)', textDecoration: 'underline', marginTop: '2px' }}
          >
            Dismiss notice
          </button>
        </div>
      )}


      {/* Create Key Modal/Drawer */}
      {creating && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-md)',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600 }}>Create New API Key</div>

          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
              Key Name / Purpose
            </label>
            <input
              type="text"
              placeholder="e.g. Portfolio Website, iOS App, Automation Bot"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '6px 10px',
                color: '#fff',
                fontSize: '13px',
                marginTop: '4px',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
              Expiration
            </label>
            <select
              value={expiresDays !== undefined ? expiresDays : ''}
              onChange={(e) =>
                setExpiresDays(e.target.value ? parseInt(e.target.value) : undefined)
              }
              style={{
                width: '100%',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '6px 10px',
                color: '#fff',
                fontSize: '13px',
                marginTop: '4px',
              }}
            >
              <option value="">Never Expires</option>
              <option value="30">30 Days</option>
              <option value="90">90 Days</option>
              <option value="180">180 Days</option>
              <option value="365">1 Year</option>
            </select>
          </div>

          {/* Permissions Checklist */}
          <div>
            <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '6px' }}>
              Scoped Permissions
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '8px',
              }}
            >
              {availablePermissions.map((p) => (
                <label
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    background: selectedPerms.includes(p.id) ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPerms.includes(p.id)}
                    onChange={() => togglePerm(p.id)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button onClick={() => setCreating(false)} className="btn btn-secondary press-scale">
              Cancel
            </button>
            <button onClick={handleCreate} className="btn btn-primary press-scale">
              Generate Key
            </button>
          </div>
        </div>
      )}

      {/* Keys List */}
      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading API keys...
          </div>
        ) : keys.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No API keys created yet. Click "+ Create Key" to generate credentials.
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key Prefix</th>
                  <th>Scopes</th>
                  <th>Last Used</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedKeys.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 500 }}>
                      {k.name}
                      {k.revoked_at && (
                        <span
                          style={{
                            marginLeft: '8px',
                            fontSize: '10px',
                            color: 'var(--accent-red)',
                            border: '1px solid rgba(255,69,58,0.3)',
                            padding: '1px 5px',
                            borderRadius: '4px',
                          }}
                        >
                          REVOKED
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {k.key_prefix}...
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {k.permissions.map((p) => (
                          <span
                            key={p}
                            style={{
                              fontSize: '10px',
                              background: 'rgba(255,255,255,0.06)',
                              padding: '2px 5px',
                              borderRadius: '3px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!k.revoked_at && (
                        <button
                          onClick={() => handleRevoke(k.id, k.name)}
                          className="btn btn-ghost press-scale"
                          style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--accent-red)' }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {keys.length > 0 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)' }}>
            <Pagination
              currentPage={safePage}
              totalItems={keys.length}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageChange={(p) => setPage(p)}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
