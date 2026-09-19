import React, { useState, useEffect, useCallback } from 'react';
import { api, MediaItem, FolderItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { MediaCard } from '../components/media/MediaCard';
import { MediaDetailDrawer } from '../components/media/MediaDetailDrawer';

interface MediaPageProps {
  mediaTypeFilter?: 'image' | 'video';
  searchTerm: string;
  folders: FolderItem[];
  refreshTrigger: number;
  onDataChanged: () => void;
}

export const MediaPage: React.FC<MediaPageProps> = ({
  mediaTypeFilter,
  searchTerm,
  folders,
  refreshTrigger,
  onDataChanged,
}) => {
  const { toast } = useToast();

  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listFiles({
        type: mediaTypeFilter,
        folder_id: selectedFolder || undefined,
        search: searchTerm || undefined,
        sort: sortBy,
        limit: 100,
      });
      setMediaList(res.items);
      setTotal(res.total);

      // Sync the detail drawer with fresh data so changes (visibility, tags, etc.)
      // appear immediately without requiring a page refresh
      setActiveMedia((prev) => {
        if (!prev) return null;
        const updated = res.items.find((item: MediaItem) => item.id === prev.id);
        return updated || null;
      });
    } catch (err: any) {
      toast(err.message || 'Failed to fetch media', 'error');
    } finally {
      setLoading(false);
    }
  }, [mediaTypeFilter, selectedFolder, searchTerm, sortBy, toast]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia, refreshTrigger]);

  const handleCardClick = (media: MediaItem) => {
    setActiveMedia(media);
  };

  const handleSelectCard = (media: MediaItem, multi: boolean) => {
    setSelectedIds((prev) => {
      if (prev.includes(media.id)) {
        return prev.filter((id) => id !== media.id);
      } else {
        return multi ? [...prev, media.id] : [media.id];
      }
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await api.bulkOperation({
        ids: selectedIds,
        action: 'delete',
      });
      toast(`Moved ${selectedIds.length} items to trash`);
      setSelectedIds([]);
      fetchMedia();
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleBulkMove = async (targetFolderId: string) => {
    if (selectedIds.length === 0) return;
    try {
      await api.bulkOperation({
        ids: selectedIds,
        action: 'move',
        target_folder_id: targetFolderId,
      });
      toast(`Moved ${selectedIds.length} items`);
      setSelectedIds([]);
      fetchMedia();
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleDeleteSingle = async (item: MediaItem) => {
    try {
      await api.deleteFile(item.id);
      toast('Moved to trash');
      setActiveMedia(null);
      fetchMedia();
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Filter and Control Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Folder Dropdown */}
          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 12px',
              color: 'var(--text-primary)',
              fontSize: '13px',
            }}
          >
            <option value="">All Folders</option>
            <option value="root">Root (No Folder)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.media_count})
              </option>
            ))}
          </select>

          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 12px',
              color: 'var(--text-primary)',
              fontSize: '13px',
            }}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="largest">Largest Size</option>
            <option value="smallest">Smallest Size</option>
            <option value="filename">Filename (A-Z)</option>
          </select>

          {/* View Toggle */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setViewMode('grid')}
              style={{
                padding: '6px 10px',
                background: viewMode === 'grid' ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: viewMode === 'grid' ? '#fff' : 'var(--text-tertiary)',
              }}
              title="Grid View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="7" height="7" x="3" y="3" rx="1"/>
                <rect width="7" height="7" x="14" y="3" rx="1"/>
                <rect width="7" height="7" x="14" y="14" rx="1"/>
                <rect width="7" height="7" x="3" y="14" rx="1"/>
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '6px 10px',
                background: viewMode === 'list' ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: viewMode === 'list' ? '#fff' : 'var(--text-tertiary)',
              }}
              title="List View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" x2="21" y1="6" y2="6"/>
                <line x1="8" x2="21" y1="12" y2="12"/>
                <line x1="8" x2="21" y1="18" y2="18"/>
                <line x1="3" x2="3.01" y1="6" y2="6"/>
                <line x1="3" x2="3.01" y1="12" y2="12"/>
                <line x1="3" x2="3.01" y1="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Count or Bulk Actions */}
        {selectedIds.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {selectedIds.length} selected
            </span>
            <button
              onClick={handleBulkDelete}
              className="btn btn-danger press-scale"
              style={{ padding: '5px 10px', fontSize: '12px' }}
            >
              Move to Trash
            </button>
            <select
              onChange={(e) => {
                if (e.target.value) handleBulkMove(e.target.value);
              }}
              defaultValue=""
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 8px',
                color: '#fff',
                fontSize: '12px',
              }}
            >
              <option value="" disabled>
                Move to folder...
              </option>
              <option value="root">Root</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSelectedIds([])}
              className="btn btn-ghost press-scale"
              style={{ fontSize: '12px', padding: '5px 8px' }}
            >
              Clear
            </button>
          </div>
        ) : (
          <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
            {total} {total === 1 ? 'file' : 'files'}
          </span>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Loading media...
        </div>
      ) : mediaList.length === 0 ? (
        <div
          style={{
            padding: '80px 20px',
            textAlign: 'center',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-tertiary)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <circle cx="9" cy="9" r="2"/>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
          </div>
          <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)' }}>
            No media found
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', maxWidth: '300px' }}>
            Upload your first photo or video using the upload button or press 'U'.
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="media-grid">
          {mediaList.map((item) => (
            <MediaCard
              key={item.id}
              media={item}
              isSelected={selectedIds.includes(item.id)}
              onSelect={handleSelectCard}
              onClick={handleCardClick}
            />
          ))}
        </div>
      ) : (
        /* List View */
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '12px 16px', width: '40px' }}></th>
                <th style={{ padding: '12px 16px' }}>Name</th>
                <th style={{ padding: '12px 16px' }}>Type</th>
                <th style={{ padding: '12px 16px' }}>Size</th>
                <th style={{ padding: '12px 16px' }}>Visibility</th>
                <th style={{ padding: '12px 16px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {mediaList.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <tr
                    key={item.id}
                    onClick={() => handleCardClick(item)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(41, 151, 255, 0.08)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 16px' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectCard(item, false)}
                      />
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: 500 }}>{item.filename}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>
                      {item.extension.toUpperCase()}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>
                      {(item.file_size / 1024 / 1024).toFixed(1)} MB
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span className={`badge ${item.visibility === 'public' ? 'badge-public' : 'badge-private'}`}>
                        {item.visibility}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>
                      {new Date(item.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Media Detail Drawer */}
      <MediaDetailDrawer
        media={activeMedia}
        onClose={() => setActiveMedia(null)}
        onUpdate={() => {
          fetchMedia();
          onDataChanged();
        }}
        onDelete={handleDeleteSingle}
      />
    </div>
  );
};
