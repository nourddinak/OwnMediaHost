import React, { useState, useEffect, useCallback } from 'react';
import { api, MediaItem, FolderItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useOnDataRefresh } from '../context/DataRefreshContext';
import { MediaCard } from '../components/media/MediaCard';
import { MediaDetailDrawer } from '../components/media/MediaDetailDrawer';
import { Pagination } from '../components/common/Pagination';
import { formatBytes } from '../utils/formatters';

interface MediaPageProps {
  mediaTypeFilter?: 'image' | 'video';
  searchTerm: string;
  folders: FolderItem[];
  refreshTrigger: number;
  onDataChanged: () => void;
  folderId?: string;
}

export const MediaPage: React.FC<MediaPageProps> = ({
  mediaTypeFilter,
  searchTerm,
  folders,
  refreshTrigger,
  onDataChanged,
  folderId,
}) => {
  const { toast } = useToast();

  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(48);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFolder, setSelectedFolder] = useState<string>(folderId || '');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    if (folderId !== undefined) {
      setSelectedFolder(folderId);
      setPage(1);
    }
  }, [folderId]);

  // Reset to page 1 and clear selection on search or filter change
  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
    setAnchorId(null);
  }, [searchTerm, selectedFolder, sortBy, mediaTypeFilter]);

  const fetchMedia = useCallback(
    async (isBackground = false) => {
      if (!isBackground) {
        setLoading(true);
      }
      try {
        const res = await api.listFiles({
          type: mediaTypeFilter,
          folder_id: selectedFolder || undefined,
          search: searchTerm || undefined,
          sort: sortBy,
          limit: pageSize,
          offset: (page - 1) * pageSize,
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
    },
    [mediaTypeFilter, selectedFolder, searchTerm, sortBy, page, pageSize, toast]
  );

  useEffect(() => {
    // Preserve existing items during refresh triggers to avoid UI flickering
    fetchMedia(mediaList.length > 0);
  }, [fetchMedia, refreshTrigger]);

  // Subscribe to real-time data bus events across tabs and other pages
  useOnDataRefresh(() => {
    fetchMedia(true);
  });

  const handleCardClick = (media: MediaItem) => {
    setActiveMedia(media);
  };

  const handleSelectCard = useCallback(
    (
      media: MediaItem,
      e?: React.MouseEvent | { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
    ) => {
      const isShift = !!e?.shiftKey;
      const isCtrl = !!e?.ctrlKey || !!e?.metaKey;

      setSelectedIds((prev) => {
        // Shift-click: Range select from anchorId to clicked media
        if (isShift) {
          const anchorIndex = anchorId
            ? mediaList.findIndex((m) => m.id === anchorId)
            : 0;
          const targetIndex = mediaList.findIndex((m) => m.id === media.id);

          if (anchorIndex !== -1 && targetIndex !== -1) {
            const start = Math.min(anchorIndex, targetIndex);
            const end = Math.max(anchorIndex, targetIndex);
            const rangeIds = mediaList.slice(start, end + 1).map((m) => m.id);

            if (isCtrl) {
              const next = new Set(prev);
              for (const id of rangeIds) {
                next.add(id);
              }
              return Array.from(next);
            } else {
              return rangeIds;
            }
          }
        }

        // Non-shift click: update anchor to this item
        setAnchorId(media.id);
        if (isCtrl || prev.includes(media.id)) {
          if (prev.includes(media.id)) {
            return prev.filter((id) => id !== media.id);
          } else {
            return [...prev, media.id];
          }
        } else {
          return [...prev, media.id];
        }
      });
    },
    [mediaList, anchorId]
  );

  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.length === mediaList.length) {
      setSelectedIds([]);
      setAnchorId(null);
    } else {
      setSelectedIds(mediaList.map((m) => m.id));
      if (mediaList.length > 0) {
        setAnchorId(mediaList[0].id);
      }
    }
  }, [mediaList, selectedIds.length]);

  // Global Keyboard Shortcuts: Ctrl+A / Cmd+A to select all, Esc to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedIds(mediaList.map((m) => m.id));
        if (mediaList.length > 0) {
          setAnchorId(mediaList[0].id);
        }
      } else if (e.key === 'Escape') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          setSelectedIds([]);
          setAnchorId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mediaList, selectedIds.length]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const idsToDelete = new Set(selectedIds);
    const count = selectedIds.length;

    // Optimistically remove from view immediately
    setMediaList((prev) => prev.filter((m) => !idsToDelete.has(m.id)));
    setTotal((prev) => Math.max(0, prev - count));
    setSelectedIds([]);
    setAnchorId(null);
    toast(`Moved ${count} item${count > 1 ? 's' : ''} to trash`);

    // Notify other components and tabs in real-time
    onDataChanged();

    try {
      await api.bulkOperation({
        ids: Array.from(idsToDelete),
        action: 'delete',
      });
      fetchMedia(true);
    } catch (err: any) {
      toast(err.message || 'Bulk delete failed', 'error');
      fetchMedia(false);
    }
  };

  const handleBulkMove = async (targetFolderId: string) => {
    if (selectedIds.length === 0) return;
    const idsToMove = new Set(selectedIds);
    const count = selectedIds.length;

    // Optimistically update folder assignments in view
    if (selectedFolder && selectedFolder !== targetFolderId) {
      setMediaList((prev) => prev.filter((m) => !idsToMove.has(m.id)));
      setTotal((prev) => Math.max(0, prev - count));
    } else {
      setMediaList((prev) =>
        prev.map((m) =>
          idsToMove.has(m.id)
            ? {
                ...m,
                folder_id: targetFolderId === 'root' ? undefined : targetFolderId,
                folder_name: folders.find((f) => f.id === targetFolderId)?.name || undefined,
              }
            : m
        )
      );
    }
    setSelectedIds([]);
    setAnchorId(null);
    toast(`Moved ${count} item${count > 1 ? 's' : ''}`);

    onDataChanged();

    try {
      await api.bulkOperation({
        ids: Array.from(idsToMove),
        action: 'move',
        target_folder_id: targetFolderId === 'root' ? undefined : targetFolderId,
      });
      fetchMedia(true);
    } catch (err: any) {
      toast(err.message || 'Bulk move failed', 'error');
      fetchMedia(false);
    }
  };

  const handleDeleteSingle = async (item: MediaItem) => {
    const deletedId = item.id;

    // Optimistically remove from view and close drawer immediately
    setMediaList((prev) => prev.filter((m) => m.id !== deletedId));
    setTotal((prev) => Math.max(0, prev - 1));
    setSelectedIds((prev) => prev.filter((id) => id !== deletedId));
    setActiveMedia(null);
    toast('Moved to trash');

    onDataChanged();

    try {
      await api.deleteFile(deletedId);
      fetchMedia(true);
    } catch (err: any) {
      toast(err.message || 'Failed to move to trash', 'error');
      fetchMedia(false);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              {selectedIds.length} selected
            </span>
            <button
              onClick={handleToggleSelectAll}
              className="btn btn-ghost press-scale"
              style={{ fontSize: '12px', padding: '5px 8px' }}
              title="Toggle Select All on this page (Ctrl+A)"
            >
              {selectedIds.length === mediaList.length ? 'Deselect All' : `Select All (${mediaList.length})`}
            </button>
            {selectedIds.length === 1 && (
              <button
                onClick={() => {
                  const item = mediaList.find((m) => m.id === selectedIds[0]);
                  if (item) setActiveMedia(item);
                }}
                className="btn btn-secondary press-scale"
                style={{ padding: '5px 10px', fontSize: '12px' }}
              >
                View Details
              </button>
            )}
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
              onClick={() => {
                setSelectedIds([]);
                setAnchorId(null);
              }}
              className="btn btn-ghost press-scale"
              style={{ fontSize: '12px', padding: '5px 8px' }}
              title="Clear selection (Esc)"
            >
              Clear
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
              {total} {total === 1 ? 'file' : 'files'}
            </span>
            {mediaList.length > 0 && (
              <button
                onClick={handleToggleSelectAll}
                className="btn btn-ghost press-scale"
                style={{ fontSize: '12px', padding: '4px 8px', color: 'var(--text-tertiary)' }}
                title="Select all on this page (Ctrl+A)"
              >
                Select All
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading && mediaList.length === 0 ? (
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
        <div className={`media-grid ${selectedIds.length > 0 ? 'has-selection' : ''}`}>
          {mediaList.map((item) => (
            <MediaCard
              key={item.id}
              media={item}
              isSelected={selectedIds.includes(item.id)}
              isSelectionMode={selectedIds.length > 0}
              onSelect={handleSelectCard}
              onClick={handleCardClick}
            />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="table-card">
          <div className="table-responsive-wrapper">
            <table className="data-table" style={{ minWidth: '640px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '12px 16px', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={mediaList.length > 0 && selectedIds.length === mediaList.length}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = selectedIds.length > 0 && selectedIds.length < mediaList.length;
                      }
                    }}
                    onChange={handleToggleSelectAll}
                    style={{ cursor: 'pointer' }}
                    title={selectedIds.length === mediaList.length ? 'Deselect All' : 'Select All'}
                  />
                </th>
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
                    onClick={(e) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey || selectedIds.length > 0) {
                        e.preventDefault();
                        handleSelectCard(item, e);
                      } else {
                        handleCardClick(item);
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      handleCardClick(item);
                    }}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(41, 151, 255, 0.08)' : 'transparent',
                      userSelect: 'none',
                    }}
                  >
                    <td style={{ padding: '10px 16px' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(e) => {
                          handleSelectCard(item, e);
                        }}
                        onChange={() => {}}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '10px 16px', fontWeight: 500 }}>{item.filename}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>
                      {item.extension.toUpperCase()}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)' }}>
                      {formatBytes(item.file_size)}
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
        </div>
      )}

      {/* Pagination Controls */}
      {total > 0 && (
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={pageSize}
          pageSizeOptions={[24, 48, 96, 192]}
          onPageChange={(newPage) => setPage(newPage)}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          itemName="files"
        />
      )}

      {/* Media Detail Drawer */}
      <MediaDetailDrawer
        media={activeMedia}
        onClose={() => setActiveMedia(null)}
        onUpdate={(updatedMedia) => {
          // Instant local state sync if the mutation returned fresh data
          if (updatedMedia) {
            setActiveMedia(updatedMedia);
            setMediaList((prev) =>
              prev.map((item) => (item.id === updatedMedia.id ? updatedMedia : item))
            );
          }
          // Also trigger background refetch for full consistency (folder counts, etc.)
          fetchMedia();
          onDataChanged();
        }}
        onDelete={handleDeleteSingle}
      />
    </div>
  );
};
