import React, { useState, useEffect, useCallback } from 'react';
import { api, MediaItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Pagination } from '../components/common/Pagination';
import { formatBytes } from '../utils/formatters';

export const TrashPage: React.FC<{ onDataChanged: () => void }> = ({ onDataChanged }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchTrash = useCallback(async (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true);
    try {
      const res = await api.listFiles({
        trash: true,
        limit: targetPageSize,
        offset: (targetPage - 1) * targetPageSize,
      });
      setItems(res.items);
      setTotal(res.total);
      setSelected(new Set());
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, toast]);

  useEffect(() => {
    fetchTrash(page, pageSize);
  }, [page, pageSize, fetchTrash]);

  const handleRestore = async (id: string, name: string) => {
    try {
      await api.restoreFile(id);
      toast(`Restored '${name}'`);
      fetchTrash(page, pageSize);
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handlePermanentDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete '${name}'? This physically erases the file from disk and cannot be undone.`)) {
      return;
    }
    try {
      await api.permanentDeleteFile(id);
      toast(`Permanently deleted '${name}'`);
      fetchTrash(page, pageSize);
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleEmptyTrash = async () => {
    if (items.length === 0) return;
    if (!confirm(`Permanently erase all ${total} items from trash? This cannot be undone.`)) {
      return;
    }
    try {
      setBulkLoading(true);
      // Need to delete ALL trash items, not just current page
      let allIds: string[] = [];
      if (total <= pageSize) {
        allIds = items.map((i) => i.id);
      } else {
        // Fetch all IDs across pages
        const allRes = await api.listFiles({ trash: true, limit: total, offset: 0 });
        allIds = allRes.items.map((i) => i.id);
      }
      await api.bulkOperation({ ids: allIds, action: 'permanent_delete' });
      toast('Trash emptied');
      setPage(1);
      setSelected(new Set());
      fetchTrash(1, pageSize);
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const handleBulkRestore = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    try {
      setBulkLoading(true);
      await api.bulkOperation({ ids: Array.from(selected), action: 'restore' });
      toast(`Restored ${count} item${count > 1 ? 's' : ''}`);
      setSelected(new Set());
      fetchTrash(page, pageSize);
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (count === 0) return;
    if (
      !confirm(
        `Permanently delete ${count} selected item${count > 1 ? 's' : ''}? This physically erases the files from disk and cannot be undone.`
      )
    ) {
      return;
    }
    try {
      setBulkLoading(true);
      await api.bulkOperation({ ids: Array.from(selected), action: 'permanent_delete' });
      toast(`Permanently deleted ${count} item${count > 1 ? 's' : ''}`);
      setSelected(new Set());
      fetchTrash(page, pageSize);
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  const allOnPageSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0;

  return (
    <div className="page-container" style={{ maxWidth: '920px' }}>
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">Trash / Recycle Bin</h1>
          <p className="page-subtitle">
            Soft-deleted items remain recoverable for 30 days before automatic cleanup.
          </p>
        </div>

        {items.length > 0 && (
          <button
            onClick={handleEmptyTrash}
            disabled={bulkLoading}
            className="btn btn-danger press-scale"
          >
            Empty Trash ({total})
          </button>
        )}
      </div>

      {/* Selection Action Bar */}
      {someSelected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '10px 16px',
            background: 'rgba(41, 151, 255, 0.08)',
            border: '1px solid rgba(41, 151, 255, 0.25)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '12px',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
            {selected.size} item{selected.size > 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleBulkRestore}
              disabled={bulkLoading}
              className="btn btn-primary press-scale"
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              {bulkLoading ? 'Working...' : `Restore Selected`}
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="btn press-scale"
              style={{
                fontSize: '12px',
                padding: '6px 14px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.35)',
              }}
            >
              {bulkLoading ? 'Working...' : `Delete Selected`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="btn btn-ghost press-scale"
              style={{ fontSize: '12px', padding: '6px 10px' }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="table-card">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading trash...
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Trash is empty. Deleted files will appear here.
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '36px', paddingRight: 0 }}>
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      style={{
                        accentColor: 'var(--accent-blue)',
                        cursor: 'pointer',
                        width: '15px',
                        height: '15px',
                      }}
                      title={allOnPageSelected ? 'Deselect all on this page' : 'Select all on this page'}
                    />
                  </th>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Deleted Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isSelected = selected.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      style={{
                        background: isSelected ? 'rgba(41, 151, 255, 0.06)' : undefined,
                      }}
                    >
                      <td style={{ paddingRight: 0 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item.id)}
                          style={{
                            accentColor: 'var(--accent-blue)',
                            cursor: 'pointer',
                            width: '15px',
                            height: '15px',
                          }}
                        />
                      </td>
                      <td style={{ fontWeight: 500 }}>{item.filename}</td>
                      <td style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '11px' }}>
                        {item.extension}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)' }}>
                        {formatBytes(item.file_size)}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)' }}>
                        {item.deleted_at ? new Date(item.deleted_at).toLocaleDateString() : 'Recently'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleRestore(item.id, item.filename)}
                            className="btn btn-secondary press-scale"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handlePermanentDelete(item.id, item.filename)}
                            className="btn btn-ghost press-scale"
                            style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--accent-red)' }}
                          >
                            Delete Permanently
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
      </div>

      {/* Pagination Controls */}
      {total > 0 && (
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50, 100]}
          onPageChange={(newPage) => setPage(newPage)}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          itemName="deleted files"
        />
      )}
    </div>
  );
};
