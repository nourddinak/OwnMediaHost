import React from 'react';
import { MediaItem } from '../../api/client';
import { formatBytes, formatDuration } from '../../utils/formatters';

interface MediaCardProps {
  media: MediaItem;
  isSelected: boolean;
  onSelect: (media: MediaItem, multiSelect: boolean) => void;
  onClick: (media: MediaItem) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  media,
  isSelected,
  onSelect,
  onClick,
}) => {
  const getVersionedUrl = (url?: string) => {
    if (!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}v=${encodeURIComponent(media.updated_at || '')}`;
  };

  const versionedThumb = getVersionedUrl(media.thumbnail_url);
  const versionedMedia = getVersionedUrl(media.url);

  return (
    <div
      className={`media-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onClick(media)}
    >
      <div className="media-thumbnail-container">
        {media.media_type === 'video' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#0d0d0e',
              overflow: 'hidden',
            }}
          >
            {versionedThumb ? (
              <img
                src={versionedThumb}
                alt={media.filename}
                className="media-thumbnail-img"
                decoding="async"
              />
            ) : (
              <video
                src={`${versionedMedia}#t=1.0`}
                preload="metadata"
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Play Badge */}
            <div
              style={{
                position: 'absolute',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                pointerEvents: 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
            {media.duration && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '6px',
                  right: '6px',
                  fontSize: '10px',
                  background: 'rgba(0,0,0,0.7)',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              >
                {formatDuration(media.duration)}
              </span>
            )}
          </div>
        ) : (
          <img
            src={versionedThumb || versionedMedia}
            alt={media.filename}
            className="media-thumbnail-img"
            decoding="async"
          />
        )}

        {/* Selection Checkbox */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelect(media, e.shiftKey);
          }}
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.4)',
            background: isSelected ? 'var(--accent-blue)' : 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>

        {/* Visibility indicator */}
        {media.visibility === 'private' && (
          <div
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(0,0,0,0.7)',
              fontSize: '10px',
              color: '#ff9f0a',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Private
          </div>
        )}
      </div>

      {/* Info footer */}
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--text-primary)',
          }}
          title={media.filename}
        >
          {media.filename}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
            marginTop: '4px',
          }}
        >
          <span>{formatBytes(media.file_size)}</span>
          <span>{media.extension.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};
