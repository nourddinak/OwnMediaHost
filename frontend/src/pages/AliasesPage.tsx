import React, { useState, useEffect } from 'react';
import { api, AliasItem, MediaItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { copyWithToast } from '../utils/clipboard';
import { Pagination } from '../components/common/Pagination';
import { MediaPickerModal } from '../components/media/MediaPickerModal';
import { formatBytes } from '../utils/formatters';

export const AliasesPage: React.FC = () => {
  const { toast } = useToast();
  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [aliasPath, setAliasPath] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Media Picker Modal states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reassigningAlias, setReassigningAlias] = useState<AliasItem | null>(null);

  // Guide card collapsed state (persisted in localStorage)
  const [showGuide, setShowGuide] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ownmediahost_alias_guide_collapsed') !== 'true';
    } catch {
      return true;
    }
  });

  const toggleGuide = () => {
    setShowGuide((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ownmediahost_alias_guide_collapsed', String(!next));
      } catch {
        // ignore
      }
      return next;
    });
  };

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
    const cleanPath = aliasPath.trim().replace(/^\/+|\/+$/g, '');
    if (!cleanPath) {
      toast('Please enter an alias path (e.g. avatar or logo)', 'error');
      return;
    }
    if (!selectedMedia) {
      toast('Please select a target image or video from your library', 'error');
      return;
    }

    try {
      await api.createAlias({
        alias_path: cleanPath,
        media_id: selectedMedia.id,
      });
      toast(`Alias /a/${cleanPath} created successfully!`);
      setAliasPath('');
      setSelectedMedia(null);
      setCreating(false);
      fetchAliases();
    } catch (err: any) {
      toast(err.message || 'Failed to create alias', 'error');
    }
  };

  const handleReassignSelect = async (newMedia: MediaItem) => {
    if (!reassigningAlias) return;
    try {
      await api.updateAlias(reassigningAlias.id, { media_id: newMedia.id });
      toast(`Alias /a/${reassigningAlias.alias_path} updated to point to ${newMedia.filename}!`);
      setReassigningAlias(null);
      fetchAliases();
    } catch (err: any) {
      toast(err.message || 'Failed to update alias target', 'error');
    }
  };

  const handleDelete = async (id: string, path: string) => {
    if (!confirm(`Are you sure you want to delete alias /a/${path}? Any links using this URL will stop working.`)) return;
    try {
      await api.deleteAlias(id);
      toast(`Alias /a/${path} deleted`);
      fetchAliases();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const copyUrl = async (path: string) => {
    const fullUrl = `${window.location.origin}/a/${path}`;
    await copyWithToast(fullUrl, toast, 'Copied vanity alias URL!');
  };

  const totalPages = Math.ceil(aliases.length / pageSize) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paginatedAliases = aliases.slice((safePage - 1) * pageSize, safePage * pageSize);

  const cleanPreviewPath = aliasPath.trim().replace(/^\/+|\/+$/g, '') || 'your-alias';
  const livePreviewUrl = `${window.location.origin}/a/${cleanPreviewPath}`;

  const presetChips = ['avatar', 'logo', 'banner', 'profile', 'latest'];

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">Vanity Aliases</h1>
          <p className="page-subtitle">
            Create permanent shortlinks that never break — even when you replace the underlying photo or video.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={toggleGuide}
            className="btn btn-secondary press-scale"
            style={{ fontSize: '12px' }}
          >
            {showGuide ? 'Hide Guide' : 'How Aliases Work'}
          </button>
          <button
            onClick={() => {
              setCreating(true);
              if (!selectedMedia) setPickerOpen(true);
            }}
            className="btn btn-primary press-scale"
          >
            + Create Alias
          </button>
        </div>
      </div>

      {/* Visual Guide Card */}
      {showGuide && (
        <div className="alias-guide-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>💡</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
                Why use Vanity Aliases?
              </span>
            </div>
            <button
              onClick={toggleGuide}
              className="btn-ghost"
              style={{ fontSize: '11px', color: 'var(--text-tertiary)', padding: '2px 6px' }}
            >
              Dismiss
            </button>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
            Normally, media links look like <code>/f/8cb622d7/my-pic.png</code>. If you ever update that picture, the link changes and breaks everywhere you pasted it.
            With a <strong>Vanity Alias</strong>, you get a clean URL like <code>/a/avatar</code>. When you want a new picture, you just swap the target image here and your link updates everywhere automatically!
          </p>

          {/* 3 Use-Case Examples */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '4px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-blue)', marginBottom: '4px' }}>
                👤 Discord & GitHub Avatar
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: '1.4' }}>
                Use <code>/a/avatar</code> in your bio and profiles. Swap your picture anytime without touching your bio!
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#30d158', marginBottom: '4px' }}>
                🏷️ Website & Email Logo
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: '1.4' }}>
                Embed <code>/a/logo</code> in email signatures and headers. Update your branding with zero broken links.
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#ff9f0a', marginBottom: '4px' }}>
                🖼️ Seasonal Web Banner
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: '1.4' }}>
                Embed <code>/a/banner</code> on your blog. Swap holiday or promo graphics dynamically in seconds.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {creating && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
              Create New Vanity Alias
            </span>
            <button
              onClick={() => {
                setCreating(false);
                setSelectedMedia(null);
              }}
              className="btn-ghost"
              style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {/* Step 1: Pick Path */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                1. Choose Alias Path
              </label>
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  /a/
                </span>
                <input
                  type="text"
                  placeholder="avatar (or brand/logo)"
                  value={aliasPath}
                  onChange={(e) => setAliasPath(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 12px 8px 32px',
                    color: '#fff',
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>

              {/* Quick Presets */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Presets:</span>
                {presetChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setAliasPath(chip)}
                    className="alias-preset-chip"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Real-Time Preview Bar */}
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Live URL Preview:</span>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--accent-blue)',
                    background: 'rgba(41, 151, 255, 0.08)',
                    border: '1px solid rgba(41, 151, 255, 0.2)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    wordBreak: 'break-all',
                  }}
                >
                  {livePreviewUrl}
                </div>
              </div>
            </div>

            {/* Step 2: Pick Media */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                2. Target Media File
              </label>

              {selectedMedia ? (
                <div
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      background: '#070708',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img
                      src={selectedMedia.thumbnail_url || selectedMedia.url}
                      alt={selectedMedia.filename}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedMedia.filename}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {formatBytes(selectedMedia.file_size)} {selectedMedia.width ? `• ${selectedMedia.width}×${selectedMedia.height}` : ''}
                    </span>
                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                      ID: {selectedMedia.public_id}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="btn btn-secondary press-scale"
                    style={{ fontSize: '11px', padding: '6px 10px', flexShrink: 0 }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  style={{
                    border: '2px dashed var(--border-medium)',
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '8px',
                    padding: '24px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    transition: 'all 150ms ease',
                  }}
                  className="press-scale"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
                    Select Image or Video from Library
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    Click to browse your photos & videos with thumbnail previews
                  </span>
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
            <button
              onClick={() => {
                setCreating(false);
                setSelectedMedia(null);
              }}
              className="btn btn-secondary press-scale"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!aliasPath.trim() || !selectedMedia}
              className="btn btn-primary press-scale"
            >
              Save Alias
            </button>
          </div>
        </div>
      )}

      {/* Aliases Table */}
      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading vanity aliases...
          </div>
        ) : aliases.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              No vanity aliases created yet
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', maxWidth: '380px' }}>
              Create clean, permanent shortlinks like <code>/a/avatar</code> or <code>/a/logo</code> that you can share anywhere.
            </span>
            <button
              onClick={() => {
                setCreating(true);
                setPickerOpen(true);
              }}
              className="btn btn-primary press-scale"
              style={{ marginTop: '8px' }}
            >
              + Create Your First Alias
            </button>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '64px' }}>Preview</th>
                  <th>Vanity Alias</th>
                  <th>Linked Media</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAliases.map((a) => {
                  const targetThumb = `/a/${a.alias_path}`;
                  const fullUrl = `${window.location.origin}/a/${a.alias_path}`;

                  return (
                    <tr key={a.id}>
                      {/* Image Thumbnail Preview */}
                      <td>
                        <a
                          href={fullUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Click to view full image"
                          style={{
                            display: 'block',
                            width: '40px',
                            height: '40px',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            background: '#070708',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <img
                            src={targetThumb}
                            alt={a.alias_path}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                          />
                        </a>
                      </td>

                      {/* Alias Path */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                            /a/{a.alias_path}
                          </span>
                        </div>
                      </td>

                      {/* Target File Info */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 500 }}>
                            {a.media_filename}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                            ID: {a.media_public_id}
                          </span>
                        </div>
                      </td>

                      {/* Created Date */}
                      <td style={{ fontSize: '12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {new Date(a.created_at).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button
                            onClick={() => copyUrl(a.alias_path)}
                            className="btn btn-primary press-scale"
                            style={{ padding: '5px 10px', fontSize: '11px' }}
                            title="Copy vanity link"
                          >
                            Copy URL
                          </button>

                          <a
                            href={fullUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary press-scale"
                            style={{ padding: '5px 8px', fontSize: '11px' }}
                            title="Open link in new tab"
                          >
                            ↗
                          </a>

                          <button
                            onClick={() => {
                              setReassigningAlias(a);
                              setPickerOpen(true);
                            }}
                            className="btn btn-secondary press-scale"
                            style={{ padding: '5px 10px', fontSize: '11px' }}
                            title="Change which image this alias points to without breaking the URL"
                          >
                            Change Image
                          </button>

                          <button
                            onClick={() => handleDelete(a.id, a.alias_path)}
                            className="btn btn-ghost press-scale"
                            style={{ padding: '5px 8px', fontSize: '11px', color: 'var(--accent-red)' }}
                            title="Delete alias"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {/* Visual Media Picker Modal */}
      <MediaPickerModal
        isOpen={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setReassigningAlias(null);
        }}
        onSelect={(media) => {
          if (reassigningAlias) {
            handleReassignSelect(media);
          } else {
            setSelectedMedia(media);
          }
        }}
        selectedMediaId={reassigningAlias ? reassigningAlias.media_id : selectedMedia?.id}
        title={reassigningAlias ? `Change Image for /a/${reassigningAlias.alias_path}` : 'Select Target Media Item'}
      />
    </div>
  );
};
