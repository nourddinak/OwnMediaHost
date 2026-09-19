import React, { useState, useEffect } from 'react';
import { api, AliasItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { copyTextToClipboard } from '../utils/clipboard';

export const AliasesPage: React.FC = () => {
  const { toast } = useToast();
  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [aliasPath, setAliasPath] = useState('');
  const [targetMediaId, setTargetMediaId] = useState('');

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
    const ok = await copyTextToClipboard(fullUrl);
    if (ok) {
      toast('Copied alias URL to clipboard!');
    } else {
      toast('Could not access clipboard. Please copy manually.', 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Vanity Aliases</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
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
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600 }}>Create New Vanity Alias</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
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
                  borderRadius: '4px',
                  padding: '6px 10px',
                  color: '#fff',
                  fontSize: '13px',
                  marginTop: '4px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
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
                  borderRadius: '4px',
                  padding: '6px 10px',
                  color: '#fff',
                  fontSize: '13px',
                  marginTop: '4px',
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
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading aliases...
          </div>
        ) : aliases.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No aliases created yet. Click "+ Create Alias" to map stable vanity URLs.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '12px 18px' }}>Alias Path</th>
                <th style={{ padding: '12px 18px' }}>Target File</th>
                <th style={{ padding: '12px 18px' }}>Target ID</th>
                <th style={{ padding: '12px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 18px', fontWeight: 600, color: 'var(--accent-blue)' }}>
                    /a/{a.alias_path}
                  </td>
                  <td style={{ padding: '12px 18px', color: 'var(--text-primary)' }}>
                    {a.media_filename}
                  </td>
                  <td style={{ padding: '12px 18px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {a.media_public_id}
                  </td>
                  <td style={{ padding: '12px 18px', textAlign: 'right' }}>
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
        )}
      </div>
    </div>
  );
};
