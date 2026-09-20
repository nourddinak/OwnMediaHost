import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, MediaItem } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatBytes, formatDuration } from '../../utils/formatters';

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (media: MediaItem) => void;
  selectedMediaId?: string;
  title?: string;
}

export const MediaPickerModal: React.FC<MediaPickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  selectedMediaId,
  title = 'Select Media from Library',
}) => {
  const { toast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all');

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listFiles({
        search: searchTerm.trim() || undefined,
        type: typeFilter === 'all' ? undefined : typeFilter,
        visibility: 'public', // Aliases point to public media
        limit: 48,
        sort: 'newest',
      });
      setMediaList(res.items);
    } catch (err: any) {
      toast(err.message || 'Failed to load media library', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, typeFilter, toast]);

  useEffect(() => {
    if (isOpen) {
      fetchMedia();
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, fetchMedia]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="media-picker-backdrop" onClick={onClose}>
      <div
        className="media-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="media-picker-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#ffffff' }}>
              {title}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                background: 'rgba(255, 255, 255, 0.06)',
                padding: '2px 8px',
                borderRadius: '12px',
              }}
            >
              Public Files Only
            </span>
          </div>

          <button
            onClick={onClose}
            className="btn-ghost press-scale"
            style={{ padding: '6px', borderRadius: '6px', color: 'var(--text-secondary)' }}
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="media-picker-toolbar">
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search by filename..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="settings-input"
              style={{ paddingLeft: '34px', fontSize: '13px' }}
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
                pointerEvents: 'none',
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-tertiary)', padding: '3px', borderRadius: '6px' }}>
            {(['all', 'image', 'video'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`picker-tab ${typeFilter === type ? 'active' : ''}`}
              >
                {type === 'all' ? 'All' : type === 'image' ? 'Images' : 'Videos'}
              </button>
            ))}
          </div>
        </div>

        {/* Grid Body */}
        <div className="media-picker-body">
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Loading media files...
            </div>
          ) : mediaList.length === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No public media items found</span>
              <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                {searchTerm ? 'Try a different search query or filter' : 'Upload an image first to link it to an alias'}
              </span>
            </div>
          ) : (
            <div className="media-picker-grid">
              {mediaList.map((item) => {
                const isSelected = item.id === selectedMediaId || item.public_id === selectedMediaId;
                const thumb = item.thumbnail_url || item.url;

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelect(item);
                      onClose();
                    }}
                    className={`media-picker-card ${isSelected ? 'selected' : ''}`}
                    title={`${item.filename} (${formatBytes(item.file_size)})`}
                  >
                    <div className="picker-thumb-box">
                      {item.media_type === 'video' ? (
                        <>
                          <img
                            src={thumb}
                            alt={item.filename}
                            className="picker-img"
                            loading="lazy"
                          />
                          <div className="picker-play-badge">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          </div>
                          {item.duration && (
                            <span className="picker-duration-tag">
                              {formatDuration(item.duration)}
                            </span>
                          )}
                        </>
                      ) : (
                        <img
                          src={thumb}
                          alt={item.filename}
                          className="picker-img"
                          loading="lazy"
                        />
                      )}

                      {isSelected && (
                        <div className="picker-check-badge">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="picker-card-info">
                      <span className="picker-filename">{item.filename}</span>
                      <div className="picker-meta-row">
                        <span>{formatBytes(item.file_size)}</span>
                        {item.width && item.height && (
                          <span>• {item.width}×{item.height}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="media-picker-footer">
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            Showing {mediaList.length} items
          </span>
          <button onClick={onClose} className="btn btn-secondary press-scale">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
