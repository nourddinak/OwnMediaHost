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
    if (!confirm(`Permanently erase all ${items.length} items from trash? This cannot be undone.`)) {
      return;
    }
    try {
      await api.bulkOperation({
        ids: items.map((i) => i.id),
        action: 'permanent_delete',
      });
      toast('Trash emptied');
      setPage(1);
      fetchTrash(1, pageSize);
      onDataChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Trash / Recycle Bin</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            Soft-deleted items remain recoverable for 30 days before automatic cleanup.
          </p>
        </div>

        {items.length > 0 && (
          <button
            onClick={handleEmptyTrash}
            className="btn btn-danger press-scale"
          >
            Empty Trash
          </button>
        )}
      </div>

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
            Loading trash...
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Trash is empty. Deleted files will appear here.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '12px 18px' }}>Filename</th>
                <th style={{ padding: '12px 18px' }}>Size</th>
                <th style={{ padding: '12px 18px' }}>Deleted Date</th>
                <th style={{ padding: '12px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 18px', fontWeight: 500 }}>{item.filename}</td>
                  <td style={{ padding: '12px 18px', color: 'var(--text-tertiary)' }}>
                    {formatBytes(item.file_size)}
                  </td>
                  <td style={{ padding: '12px 18px', color: 'var(--text-tertiary)' }}>
                    {item.deleted_at ? new Date(item.deleted_at).toLocaleDateString() : 'Recently'}
                  </td>
                  <td style={{ padding: '12px 18px', textAlign: 'right' }}>
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
              ))}
            </tbody>
          </table>
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
