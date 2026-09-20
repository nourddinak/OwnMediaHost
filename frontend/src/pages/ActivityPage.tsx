import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiLogItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useOnDataRefresh } from '../context/DataRefreshContext';
import { Pagination } from '../components/common/Pagination';

export const ActivityPage: React.FC = () => {
  const { toast } = useToast();
  const [logs, setLogs] = useState<ApiLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(
    async (targetPage = page, targetPageSize = pageSize, isBackground = false) => {
      if (!isBackground) {
        setLoading(true);
      }
      try {
        const res = await api.getActivityLogs({
          limit: targetPageSize,
          offset: (targetPage - 1) * targetPageSize,
        });
        setLogs(res.items);
        setTotal(res.total);
      } catch (err: any) {
        toast(err.message || 'Failed to fetch activity logs', 'error');
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, toast]
  );

  useEffect(() => {
    fetchLogs(page, pageSize, false);
  }, [page, pageSize, fetchLogs]);

  // Subscribe to real-time events across tabs/pages
  useOnDataRefresh(() => {
    fetchLogs(page, pageSize, true);
  });

  // Gentle live activity polling while active
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchLogs(page, pageSize, true);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchLogs, page, pageSize]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  return (
    <div className="page-container" style={{ maxWidth: '1000px' }}>
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">API Activity Log</h1>
          <p className="page-subtitle">
            Structured access logs with method, path, HTTP status code, and latency in milliseconds.
          </p>
        </div>

        <button onClick={() => fetchLogs(page, pageSize, false)} className="btn btn-secondary press-scale">
          ↻ Refresh
        </button>
      </div>

      <div className="table-card">
        {loading && logs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            Loading activity records...
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No recent activity recorded yet.
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Latency</th>
                  <th>Request ID</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isSuccess = log.status_code >= 200 && log.status_code < 400;
                  return (
                    <tr key={log.id}>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: isSuccess ? 'rgba(48,209,88,0.1)' : 'rgba(255,69,58,0.15)',
                            color: isSuccess ? 'var(--accent-green)' : 'var(--accent-red)',
                          }}
                        >
                          {log.status_code}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, fontSize: '12px' }}>
                        {log.method}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {log.path}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                        {log.latency_ms.toFixed(1)}ms
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                        {log.request_id}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                        {new Date(log.created_at).toLocaleTimeString()}
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
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          itemName="logs"
        />
      )}
    </div>
  );
};


