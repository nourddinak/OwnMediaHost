import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

export const SettingsPage: React.FC = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await api.getSettings();
        setSettings(data);
      } catch (err: any) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [toast]);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      toast('Settings updated successfully!');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px', color: 'var(--text-tertiary)' }}>Loading settings...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '700px' }}>
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Platform Settings</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
          Configure global media upload policies, duplicate detection, and retention schedules.
        </p>
      </div>

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
        {/* Duplicate Handling */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
            Duplicate File Detection Mode
          </label>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Action taken when an upload matches the SHA-256 hash of an existing file.
          </span>
          <select
            value={settings['duplicate_handling'] || 'allow'}
            onChange={(e) => handleChange('duplicate_handling', e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#fff',
              fontSize: '13px',
              marginTop: '6px',
            }}
          >
            <option value="allow">Allow duplicates (Store multiple copies)</option>
            <option value="reuse">Reuse existing (Return existing media object)</option>
            <option value="reject">Reject duplicates (Return 409 Conflict)</option>
          </select>
        </div>

        {/* Trash Retention Days */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
            Trash Retention Period (Days)
          </label>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Number of days deleted media stays in the recycle bin before permanent pruning.
          </span>
          <input
            type="number"
            min="1"
            max="365"
            value={settings['trash_retention_days'] || '30'}
            onChange={(e) => handleChange('trash_retention_days', e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#fff',
              fontSize: '13px',
              marginTop: '6px',
            }}
          />
        </div>

        {/* Allowed Image Formats */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
            Allowed Image Formats
          </label>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Comma-separated list of permitted image extensions (e.g. jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic).
          </span>
          <input
            type="text"
            value={settings['allowed_image_formats'] || 'jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic'}
            onChange={(e) => handleChange('allowed_image_formats', e.target.value)}
            placeholder="jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic"
            style={{
              width: '100%',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#fff',
              fontSize: '13px',
              marginTop: '6px',
            }}
          />
        </div>

        {/* Allowed Video Formats */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
            Allowed Video Formats
          </label>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Comma-separated list of permitted video extensions (e.g. mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp).
          </span>
          <input
            type="text"
            value={settings['allowed_video_formats'] || 'mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp'}
            onChange={(e) => handleChange('allowed_video_formats', e.target.value)}
            placeholder="mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp"
            style={{
              width: '100%',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#fff',
              fontSize: '13px',
              marginTop: '6px',
            }}
          />
        </div>

        {/* Public Status Page (Better Stack / Out-of-Band) */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
              Public Out-of-Band Status Page (Better Stack / Custom Domain)
            </label>
            <a
              href={settings['status_page_url'] || '/status/'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '12px',
                color: 'var(--color-primary, #6366f1)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              Open Status Page ↗
            </a>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', lineHeight: 1.5 }}>
            Configure your custom status page URL (e.g. <code>https://status.yourdomain.com</code> via DNS CNAME to Better Stack, or your hosted Better Stack URL). Provides 100% automated 24/7 downtime recording down to the second.
          </span>
          <input
            type="text"
            value={settings['status_page_url'] || ''}
            onChange={(e) => handleChange('status_page_url', e.target.value)}
            placeholder="https://status.yourdomain.com or https://yourname.betteruptime.com"
            style={{
              width: '100%',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#fff',
              fontSize: '13px',
              marginTop: '6px',
            }}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary press-scale"
          style={{ alignSelf: 'flex-start', padding: '8px 18px', marginTop: '8px' }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};
