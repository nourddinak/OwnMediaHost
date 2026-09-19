import React, { useState, useEffect } from 'react';
import { api, ApiLogItem } from '../api/client';
import { useToast } from '../context/ToastContext';

export const ActivityPage: React.FC = () => {
  const { toast } = useToast();
  const [logs, setLogs] = useState<ApiLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.getActivityLogs({ limit: 100 });
      setLogs(res.items);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>API Activity Log</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            Structured access logs with method, path, HTTP status code, and latency in milliseconds.
          </p>
        </div>

        <button onClick={fetchLogs} className="btn btn-secondary press-scale">
          ↻ Refresh
        </button>
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
            Loading activity records...
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No recent activity recorded yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Method</th>
                <th style={{ padding: '12px 16px' }}>Path</th>
                <th style={{ padding: '12px 16px' }}>Latency</th>
                <th style={{ padding: '12px 16px' }}>Request ID</th>
                <th style={{ padding: '12px 16px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const isSuccess = log.status_code >= 200 && log.status_code < 400;
                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 16px' }}>
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
                    <td style={{ padding: '10px 16px', fontWeight: 600, fontSize: '12px' }}>
                      {log.method}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {log.path}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                      {log.latency_ms.toFixed(1)}ms
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {log.request_id}
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
