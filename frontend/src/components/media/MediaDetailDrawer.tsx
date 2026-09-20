import React, { useState, useRef } from 'react';
import { api, MediaItem } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { copyTextToClipboard } from '../../utils/clipboard';
import { formatBytes } from '../../utils/formatters';

interface MediaDetailDrawerProps {
  media: MediaItem | null;
  onClose: () => void;
  onUpdate: (updatedMedia?: MediaItem) => void;
  onDelete: (media: MediaItem) => void;
}

export const MediaDetailDrawer: React.FC<MediaDetailDrawerProps> = ({
  media,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const { toast } = useToast();
  const permanentInputRef = useRef<HTMLInputElement>(null);

  const [signingPrivate, setSigningPrivate] = useState(false);
  const [privateExpires, setPrivateExpires] = useState(3600); // 1 hour
  const [signedPrivateUrl, setSignedPrivateUrl] = useState('');
  const [newTag, setNewTag] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!media) return null;

  const getAbsoluteUrl = (rawUrl: string) => {
    if (!rawUrl) return '';
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
    return `${window.location.origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  };

  const permanentUrl = getAbsoluteUrl(media.url);

  const handleCopy = async (
    text: string,
    keyName: string,
    inputRefToSelect?: React.RefObject<HTMLInputElement | null>
  ) => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKey(keyName);
      toast('Copied to clipboard!');
      setTimeout(() => setCopiedKey((k) => (k === keyName ? null : k)), 2000);
    } else {
      if (inputRefToSelect?.current) {
        inputRefToSelect.current.focus();
        inputRefToSelect.current.select();
        toast('Clipboard blocked: text selected, press Ctrl+C to copy', 'error');
      } else {
        toast('Unable to access clipboard. Please copy manually.', 'error');
      }
    }
  };

  const handleToggleVisibility = async () => {
    const newVis = media.visibility === 'public' ? 'private' : 'public';
    try {
      const updated = await api.updateFile(media.id, { visibility: newVis });
      toast(`Visibility updated to ${newVis}`);
      onUpdate(updated);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleGeneratePrivateUrl = async () => {
    try {
      const res = await api.signPrivateUrl(media.id, privateExpires);
      setSignedPrivateUrl(res.url);
      toast('Temporary signed private URL generated!');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handlePermanentPurge = async () => {
    if (
      !confirm(
        `Permanently delete "${media.filename}" and ALL related assets (original file, thumbnails, and clean up empty folders)? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await api.permanentDeleteFile(media.id);
      toast('Media and all related assets permanently purged!');
      onClose();
      onUpdate();
    } catch (err: any) {
      toast(err.message || 'Failed to permanently delete media', 'error');
    }
  };

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    const cleanTag = newTag.trim().toLowerCase();
    if (media.tags.includes(cleanTag)) {
      setNewTag('');
      return;
    }
    const updatedTags = [...media.tags, cleanTag];
    try {
      const updated = await api.updateFile(media.id, { tags: updatedTags });
      setNewTag('');
      toast(`Tag '${cleanTag}' added`);
      onUpdate(updated);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    const updatedTags = media.tags.filter((t) => t !== tagToRemove);
    try {
      const updated = await api.updateFile(media.id, { tags: updatedTags });
      toast(`Tag '${tagToRemove}' removed`);
      onUpdate(updated);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600 }}>Media Inspector</span>
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(255,255,255,0.06)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
              }}
            >
              {media.public_id}
            </span>
          </div>

          <button
            onClick={onClose}
            className="btn-ghost press-scale"
            style={{ padding: '6px', borderRadius: '6px' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Preview Section */}
          <div
            style={{
              width: '100%',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              background: '#070708',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '220px',
              maxHeight: '320px',
              position: 'relative',
            }}
          >
            {media.media_type === 'video' ? (
              <video
                key={media.url}
                src={media.url}
                controls
                style={{ width: '100%', maxHeight: '320px', objectFit: 'contain' }}
              />
            ) : (
              <img
                key={media.url}
                src={media.url}
                alt={media.filename}
                style={{ maxWidth: '100%', maxHeight: '320px', objectFit: 'contain' }}
              />
            )}
          </div>

          {/* Permanent URL Bar */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Permanent Media URL
              </span>
              {media.visibility === 'private' && (
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 500,
                  }}
                >
                  🔒 Private File
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                ref={permanentInputRef}
                type="text"
                readOnly
                value={permanentUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '8px 10px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
                title="Click to select full URL"
              />
              <button
                onClick={() => handleCopy(permanentUrl, 'perm-bar', permanentInputRef)}
                className="btn btn-primary press-scale"
                style={{
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  minWidth: '70px',
                  justifyContent: 'center',
                }}
              >
                {copiedKey === 'perm-bar' ? '✓ Copied' : 'Copy'}
              </button>
              <a
                href={permanentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary press-scale"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 10px' }}
                title="Open in new tab"
              >
                ↗
              </a>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => handleCopy(permanentUrl, 'perm-btn', permanentInputRef)}
              className="btn btn-primary press-scale"
            >
              {copiedKey === 'perm-btn' ? '✓ Copied Permanent URL' : 'Copy Permanent URL'}
            </button>

            {media.aliases && media.aliases.length > 0 && (
              <button
                onClick={() =>
                  handleCopy(`${window.location.origin}/a/${media.aliases[0]}`, 'alias-btn')
                }
                className="btn btn-secondary press-scale"
              >
                {copiedKey === 'alias-btn'
                  ? '✓ Copied Alias'
                  : `Copy Alias (/a/${media.aliases[0]})`}
              </button>
            )}

            <button
              onClick={() => setSigningPrivate(!signingPrivate)}
              className="btn btn-secondary press-scale"
            >
              Signed URL
            </button>

            <button
              onClick={() => onDelete(media)}
              className="btn btn-secondary press-scale"
              title="Move to trash (recoverable for 30 days)"
            >
              Move to Trash
            </button>
            <button
              onClick={handlePermanentPurge}
              className="btn btn-danger press-scale"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.35)',
              }}
              title="Permanently erase file, thumbnails, and clean up empty folder"
            >
              Delete & Purge All
            </button>
          </div>

          {/* Signed Private URL Box */}
          {signingPrivate && (
            <div
              style={{
                background: '#131316',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600 }}>Temporary Signed URL Generator</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={privateExpires}
                  onChange={(e) => setPrivateExpires(parseInt(e.target.value))}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                >
                  <option value="60">60 Seconds</option>
                  <option value="300">5 Minutes</option>
                  <option value="3600">1 Hour</option>
                  <option value="86400">24 Hours</option>
                </select>

                <button
                  onClick={handleGeneratePrivateUrl}
                  className="btn btn-primary press-scale"
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  Generate
                </button>
              </div>

              {signedPrivateUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      background: 'rgba(255,255,255,0.03)',
                      padding: '8px',
                      borderRadius: '4px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {signedPrivateUrl}
                  </div>
                  <button
                    onClick={() => handleCopy(signedPrivateUrl, 'signed-btn')}
                    className="btn btn-secondary press-scale"
                    style={{ alignSelf: 'flex-start', fontSize: '11px', padding: '4px 8px' }}
                  >
                    {copiedKey === 'signed-btn' ? '✓ Copied' : 'Copy Signed URL'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Metadata Inspector Table */}
          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              File Details
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Filename</span>
              <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{media.filename}</span>

              <span style={{ color: 'var(--text-tertiary)' }}>File Size</span>
              <span>{formatBytes(media.file_size)}</span>

              <span style={{ color: 'var(--text-tertiary)' }}>MIME Type</span>
              <span>{media.mime_type}</span>

              {media.width && media.height && (
                <>
                  <span style={{ color: 'var(--text-tertiary)' }}>Dimensions</span>
                  <span>{media.width} × {media.height} px</span>
                </>
              )}

              {media.duration && (
                <>
                  <span style={{ color: 'var(--text-tertiary)' }}>Duration</span>
                  <span>{media.duration.toFixed(1)}s</span>
                </>
              )}

              {media.video_codec && (
                <>
                  <span style={{ color: 'var(--text-tertiary)' }}>Video Codec</span>
                  <span>{media.video_codec}</span>
                </>
              )}

              <span style={{ color: 'var(--text-tertiary)' }}>SHA-256</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  wordBreak: 'break-all',
                }}
              >
                {media.sha256}
              </span>

              <span style={{ color: 'var(--text-tertiary)' }}>Visibility</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={`badge ${media.visibility === 'public' ? 'badge-public' : 'badge-private'}`}>
                  {media.visibility}
                </span>
                <button
                  onClick={handleToggleVisibility}
                  style={{ fontSize: '11px', color: 'var(--accent-blue)', textDecoration: 'underline' }}
                >
                  Make {media.visibility === 'public' ? 'Private' : 'Public'}
                </button>
              </div>

              <span style={{ color: 'var(--text-tertiary)' }}>Folder</span>
              <span>{media.folder_name || 'Root / None'}</span>

              <span style={{ color: 'var(--text-tertiary)' }}>Uploaded</span>
              <span>{new Date(media.created_at).toLocaleString()}</span>
            </div>
          </div>

          {/* Tags Section */}
          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Tags
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {media.tags.map((t) => (
                <span
                  key={t}
                  className="badge badge-tag"
                  style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}
                >
                  #{t}
                  <button
                    onClick={() => handleRemoveTag(t)}
                    style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {media.tags.length === 0 && (
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>No tags yet</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <input
                type="text"
                placeholder="Add a tag..."
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                style={{
                  flex: 1,
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '5px 8px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
              <button
                onClick={handleAddTag}
                className="btn btn-secondary press-scale"
                style={{ fontSize: '12px', padding: '5px 10px' }}
              >
                Add
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
};
