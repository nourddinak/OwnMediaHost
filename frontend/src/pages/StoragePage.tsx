import React, { useState, useEffect, useCallback } from 'react';
import { api, StorageStats } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useOnDataRefresh } from '../context/DataRefreshContext';
import { formatGB, formatMB } from '../utils/formatters';

export const StoragePage: React.FC = () => {
  const { toast } = useToast();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }
    try {
      const data = await api.getStorageStats();
      setStats(data);
    } catch (err: any) {
      toast(err.message || 'Failed to fetch storage stats', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStats(false);
  }, [fetchStats]);

  // Subscribe to real-time data events (upload, trash, restore, delete across all pages/tabs)
  useOnDataRefresh(() => {
    fetchStats(true);
  });

  const diskUsedPercent =
    stats && stats.total_disk_bytes > 0
      ? Math.round((stats.used_disk_bytes / stats.total_disk_bytes) * 100)
      : 0;

  return (
    <div className="page-container" style={{ maxWidth: '920px' }}>
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">Storage & System</h1>
          <p className="page-subtitle">
            Real-time physical host disk usage and media cache telemetry.
          </p>
        </div>

        <button onClick={() => fetchStats(false)} className="btn btn-secondary press-scale">
          ↻ Refresh Stats
        </button>
      </div>

      {loading && !stats ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Reading host filesystem statistics...
        </div>
      ) : stats ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Disk Gauge Card */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-md)',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>Host Filesystem Volume</span>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {diskUsedPercent}% Used
              </span>
            </div>

            {/* Gauge bar */}
            <div
              style={{
                width: '100%',
                height: '10px',
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${diskUsedPercent}%`,
                  height: '100%',
                  background:
                    diskUsedPercent > 90
                      ? 'var(--accent-red)'
                      : diskUsedPercent > 75
                      ? 'var(--accent-orange)'
                      : '#ffffff',
                  transition: 'width 300ms ease',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginTop: '4px' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Total Disk</span>
                <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {formatGB(stats.total_disk_bytes)} GB
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Used by Host</span>
                <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {formatGB(stats.used_disk_bytes)} GB
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Available Free</span>
                <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px', color: 'var(--accent-green)' }}>
                  {formatGB(stats.available_disk_bytes)} GB
                </div>
              </div>
            </div>
          </div>

          {/* Media Breakdown Card */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-md)',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>Media Platform Breakdown</span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Images</span>
                <div style={{ fontSize: '17px', fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {formatMB(stats.images_usage_bytes)} MB
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {stats.total_images_count} assets
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Videos</span>
                <div style={{ fontSize: '17px', fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {formatMB(stats.videos_usage_bytes)} MB
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {stats.total_videos_count} assets
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '14px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Thumbnails</span>
                <div style={{ fontSize: '17px', fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {formatMB(stats.thumbnails_usage_bytes)} MB
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  generated
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: '14px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '13px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>Total Platform Storage Footprint:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {formatMB(stats.media_storage_bytes)} MB ({stats.total_files_count} active files, {stats.total_trash_count} in trash)
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
