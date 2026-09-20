import React, { useState, useEffect } from 'react';
import { api, AliasItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { copyWithToast } from '../utils/clipboard';
import { Pagination } from '../components/common/Pagination';

export const AliasesPage: React.FC = () => {
  const { toast } = useToast();
  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [aliasPath, setAliasPath] = useState('');
  const [targetMediaId, setTargetMediaId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchAliases = async () => {
    setLoading(true);
    try {
      const items = await api.listAliases();
      setAliases(items);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAliases();
  }, []);

  const handleCreate = async () => {
    if (!aliasPath.trim() || !targetMediaId.trim()) {
      toast('Please provide both an alias path and a target media ID', 'error');
      return;
    }
    try {
      await api.createAlias({
        alias_path: aliasPath.trim(),
        media_id: targetMediaId.trim(),
      });
      toast(`Alias /a/${aliasPath.trim()} created!`);
      setAliasPath('');
      setTargetMediaId('');
      setCreating(false);
      fetchAliases();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleDelete = async (id: string, path: string) => {
    if (!confirm(`Are you sure you want to delete alias /a/${path}?`)) return;
    try {
      await api.deleteAlias(id);
      toast('Alias deleted');
      fetchAliases();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const copyUrl = async (path: string) => {
    const fullUrl = `${window.location.origin}/a/${path}`;
    await copyWithToast(fullUrl, toast, 'Copied alias URL to clipboard!');
  };

  const totalPages = Math.ceil(aliases.length / pageSize) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paginatedAliases = aliases.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="page-container" style={{ maxWidth: '920px' }}>
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">Vanity Aliases</h1>
          <p className="page-subtitle">
            Permanent, human-readable URLs that remain stable even when replacing the underlying image.
          </p>
        </div>

        <button onClick={() => setCreating(true)} className="btn btn-primary press-scale">
          + Create Alias
        </button>
      </div>

      {creating && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 'var(--radius-md)',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600 }}>Create New Vanity Alias</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>
                Alias Path (e.g. profile/avatar or brand/logo)
              </label>
              <input
                type="text"
                placeholder="profile/avatar"
                value={aliasPath}
                onChange={(e) => setAliasPath(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>
                Target Media ID or Public ID
              </label>
              <input
                type="text"
                placeholder="e.g. 7fd92abc or med_xxx"
                value={targetMediaId}
                onChange={(e) => setTargetMediaId(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button onClick={() => setCreating(false)} className="btn btn-secondary press-scale">
              Cancel
            </button>
            <button onClick={handleCreate} className="btn btn-primary press-scale">
              Save Alias
            </button>
          </div>
        </div>
      )}

      {/* Aliases Table */}
      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading aliases...
          </div>
        ) : aliases.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No aliases created yet. Click "+ Create Alias" to map stable vanity URLs.
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Alias Path</th>
                  <th>Target File</th>
                  <th>Target ID</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAliases.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      /a/{a.alias_path}
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>
                      {a.media_filename}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {a.media_public_id}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => copyUrl(a.alias_path)}
                          className="btn btn-secondary press-scale"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                        >
                          Copy URL
                        </button>
                        <button
                          onClick={() => handleDelete(a.id, a.alias_path)}
                          className="btn btn-ghost press-scale"
                          style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--accent-red)' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {aliases.length > 0 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)' }}>
            <Pagination
              currentPage={safePage}
              totalItems={aliases.length}
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

