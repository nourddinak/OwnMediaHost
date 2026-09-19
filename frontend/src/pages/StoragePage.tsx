import React, { useState, useEffect } from 'react';
import { api, StorageStats } from '../api/client';
import { useToast } from '../context/ToastContext';
import { formatGB, formatMB } from '../utils/formatters';

export const StoragePage: React.FC = () => {
  const { toast } = useToast();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await api.getStorageStats();
      setStats(data);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const diskUsedPercent =
    stats && stats.total_disk_bytes > 0
      ? Math.round((stats.used_disk_bytes / stats.total_disk_bytes) * 100)
      : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '850px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Storage & System</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            Real-time physical host disk usage and media cache telemetry.
          </p>
        </div>

        <button onClick={fetchStats} className="btn btn-secondary press-scale">
          ↻ Refresh Stats
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Reading host filesystem statistics...
        </div>
      ) : stats ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Disk Gauge Card */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 600 }}>Host Filesystem Volume</span>
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
                      : 'var(--accent-blue)',
                  transition: 'width 300ms ease',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Total Disk</span>
                <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '2px' }}>
                  {formatGB(stats.total_disk_bytes)} GB
                </div>
              </div>

              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Used by Host</span>
                <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '2px' }}>
                  {formatGB(stats.used_disk_bytes)} GB
                </div>
              </div>

              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Available Free</span>
                <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '2px', color: 'var(--accent-green)' }}>
                  {formatGB(stats.available_disk_bytes)} GB
                </div>
              </div>
            </div>
          </div>

          {/* Media Breakdown Card */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <span style={{ fontSize: '14px', fontWeight: 600 }}>Media Platform Breakdown</span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Images</span>
                <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px' }}>
                  {formatMB(stats.images_usage_bytes)} MB
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {stats.total_images_count} assets
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Videos</span>
                <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px' }}>
                  {formatMB(stats.videos_usage_bytes)} MB
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {stats.total_videos_count} assets
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Thumbnails</span>
                <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px' }}>
                  {formatMB(stats.thumbnails_usage_bytes)} MB
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  generated
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: '12px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '13px',
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
