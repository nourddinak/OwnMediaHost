import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

export const SettingsPage: React.FC = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedProbe, setCopiedProbe] = useState(false);
  const [copiedFrontendProbe, setCopiedFrontendProbe] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; status: string; latency?: number } | null>(null);

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
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };

      // Helpful auto-sync for base URLs
      if (key === 'domain' && (!prev['public_base_url'] || prev['public_base_url'].includes(prev['domain'] || 'localhost'))) {
        if (value.trim()) {
          updated['public_base_url'] = value.startsWith('http') ? value : `https://${value}`;
        }
      } else if (key === 'backend_domain' && (!prev['public_base_url'] || prev['public_base_url'].includes(prev['backend_domain'] || 'localhost'))) {
        if (value.trim()) {
          updated['public_base_url'] = value.startsWith('http') ? value : `https://${value}`;
        }
      }

      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      toast('Platform settings updated successfully!');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Determine active topology and probe targets
  const deployMode = settings['deploy_mode'] || 'unified';
  const unifiedDomain = settings['domain'] || (typeof window !== 'undefined' ? window.location.host : 'media.yourdomain.com');
  const frontendDomain = settings['frontend_domain'] || (typeof window !== 'undefined' ? window.location.host : 'media.yourdomain.com');
  const backendDomain = settings['backend_domain'] || (typeof window !== 'undefined' ? `api.${window.location.host}` : 'api.yourdomain.com');

  const computedProbeUrl = deployMode === 'unified'
    ? (unifiedDomain.startsWith('http') ? `${unifiedDomain}/health` : `https://${unifiedDomain}/health`)
    : (backendDomain.startsWith('http') ? `${backendDomain}/health` : `https://${backendDomain}/health`);

  const computedFrontendUrl = frontendDomain.startsWith('http') ? frontendDomain : `https://${frontendDomain}`;

  const handleCopyProbe = async () => {
    try {
      await navigator.clipboard.writeText(computedProbeUrl);
      setCopiedProbe(true);
      setTimeout(() => setCopiedProbe(false), 2000);
      toast('Health check monitor URL copied to clipboard!');
    } catch {
      toast('Failed to copy to clipboard', 'error');
    }
  };

  const handleCopyFrontendProbe = async () => {
    try {
      await navigator.clipboard.writeText(computedFrontendUrl);
      setCopiedFrontendProbe(true);
      setTimeout(() => setCopiedFrontendProbe(false), 2000);
      toast('Frontend UI monitor URL copied to clipboard!');
    } catch {
      toast('Failed to copy to clipboard', 'error');
    }
  };

  const handleTestProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    const start = performance.now();
    try {
      const res = await fetch('/health', { cache: 'no-store' });
      const duration = Math.round(performance.now() - start);
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        setProbeResult({
          ok: true,
          status: `HTTP ${res.status} OK — Operational (${json.status || 'healthy'})`,
          latency: duration,
        });
      } else {
        setProbeResult({
          ok: false,
          status: `HTTP ${res.status} ${res.statusText}`,
          latency: duration,
        });
      }
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      setProbeResult({
        ok: false,
        status: `Connection failed: ${err.message || 'Offline'}`,
        latency: duration,
      });
    } finally {
      setProbing(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px', color: 'var(--text-tertiary)' }}>Loading platform settings...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '760px' }}>
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Platform Settings</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Configure domain routing topologies, Better Stack 24/7 out-of-band monitoring, media upload policies, and retention schedules.
        </p>
      </div>

      {/* Main Settings Card */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Section: Domain & Routing Architecture */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Domain & Routing Topology
            </label>
            <span
              style={{
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '12px',
                background: deployMode === 'unified' ? 'rgba(41, 151, 255, 0.15)' : 'rgba(175, 82, 222, 0.15)',
                color: deployMode === 'unified' ? '#2997ff' : '#af52de',
                fontWeight: 500,
                border: `1px solid ${deployMode === 'unified' ? 'rgba(41, 151, 255, 0.3)' : 'rgba(175, 82, 222, 0.3)'}`,
              }}
            >
              {deployMode === 'unified' ? 'Single Domain Mode' : 'Split 2-Domain Mode'}
            </span>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'block', marginBottom: '14px' }}>
            Choose whether your server operates with a single unified domain or separates the React frontend dashboard and Axum API across two distinct domains.
          </span>

          {/* Topology Choice Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            {/* Card 1: Single Unified Domain */}
            <div
              onClick={() => handleChange('deploy_mode', 'unified')}
              style={{
                padding: '14px',
                borderRadius: '8px',
                background: deployMode === 'unified' ? 'rgba(41, 151, 255, 0.08)' : 'var(--bg-tertiary)',
                border: `1.5px solid ${deployMode === 'unified' ? '#2997ff' : 'var(--border-subtle)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input
                  type="radio"
                  name="deploy_mode"
                  checked={deployMode === 'unified'}
                  onChange={() => handleChange('deploy_mode', 'unified')}
                  style={{ accentColor: '#2997ff' }}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Single Unified Domain
                </span>
                <span style={{ fontSize: '10px', background: 'rgba(48, 209, 88, 0.15)', color: '#30d158', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
                  Recommended
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '24px', lineHeight: 1.4 }}>
                Caddy routes both React dashboard UI and Axum media streaming APIs on one domain (e.g. <code>media.yourdomain.com</code>). Zero CORS friction.
              </p>
            </div>

            {/* Card 2: Split 2-Domain Setup */}
            <div
              onClick={() => handleChange('deploy_mode', 'split')}
              style={{
                padding: '14px',
                borderRadius: '8px',
                background: deployMode === 'split' ? 'rgba(175, 82, 222, 0.08)' : 'var(--bg-tertiary)',
                border: `1.5px solid ${deployMode === 'split' ? '#af52de' : 'var(--border-subtle)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <input
                  type="radio"
                  name="deploy_mode"
                  checked={deployMode === 'split'}
                  onChange={() => handleChange('deploy_mode', 'split')}
                  style={{ accentColor: '#af52de' }}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Split 2-Domain Setup
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '24px', lineHeight: 1.4 }}>
                Separate frontend dashboard (e.g. <code>media.yourdomain.com</code>) and dedicated backend streaming API (e.g. <code>api.yourdomain.com</code>).
              </p>
            </div>
          </div>

          {/* Conditional Domain Inputs based on Mode */}
          {deployMode === 'unified' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
                  Unified Media Domain
                </label>
                <input
                  type="text"
                  value={settings['domain'] || ''}
                  onChange={(e) => handleChange('domain', e.target.value)}
                  placeholder="media.yourdomain.com"
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#fff',
                    fontSize: '13px',
                    marginTop: '4px',
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', display: 'block' }}>
                  Primary domain pointing to your server VPS.
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
                  Frontend Dashboard Domain
                </label>
                <input
                  type="text"
                  value={settings['frontend_domain'] || ''}
                  onChange={(e) => handleChange('frontend_domain', e.target.value)}
                  placeholder="media.yourdomain.com"
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#fff',
                    fontSize: '13px',
                    marginTop: '4px',
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', display: 'block' }}>
                  Serves the React dashboard SPA.
                </span>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
                  Backend API Domain
                </label>
                <input
                  type="text"
                  value={settings['backend_domain'] || ''}
                  onChange={(e) => handleChange('backend_domain', e.target.value)}
                  placeholder="api.yourdomain.com"
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: '#fff',
                    fontSize: '13px',
                    marginTop: '4px',
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', display: 'block' }}>
                  Axum API and media streaming.
                </span>
              </div>
            </div>
          )}

          {/* Public Media Base URL */}
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', display: 'block' }}>
              Public Media Base URL
            </label>
            <input
              type="text"
              value={settings['public_base_url'] || ''}
              onChange={(e) => handleChange('public_base_url', e.target.value)}
              placeholder="https://media.yourdomain.com or https://api.yourdomain.com"
              style={{
                width: '100%',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#fff',
                fontSize: '13px',
                marginTop: '4px',
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', display: 'block' }}>
              Prefix used for generated permanent asset links (<code>/f/...</code>, <code>/a/...</code>, <code>/thumbnails/...</code>).
            </span>
          </div>
        </div>

        {/* Section: Better Stack Monitor Target (Auto-Computed) */}
        <div
          style={{
            border: '1px solid rgba(41, 151, 255, 0.25)',
            background: 'rgba(41, 151, 255, 0.04)',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#2997ff' }} />
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Better Stack Monitor Target URL
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={handleCopyProbe}
                className="btn btn-secondary"
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '5px',
                  background: copiedProbe ? 'rgba(48, 209, 88, 0.2)' : 'var(--bg-tertiary)',
                  color: copiedProbe ? '#30d158' : 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {copiedProbe ? '✓ Copied' : 'Copy URL'}
              </button>
              <button
                type="button"
                onClick={handleTestProbe}
                disabled={probing}
                className="btn btn-secondary"
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '5px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {probing ? 'Testing...' : 'Test Probe'}
              </button>
            </div>
          </div>

          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px', lineHeight: 1.4 }}>
            Enter this URL into your Better Stack monitor (<strong>Uptime → Create Monitor</strong>) to record 24/7 downtime down to the second:
          </span>

          <div
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              padding: '8px 12px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              color: '#58a6ff',
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {computedProbeUrl}
          </div>

          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(255, 159, 10, 0.08)',
              border: '1px solid rgba(255, 159, 10, 0.25)',
              fontSize: '11px',
              color: '#ff9f0a',
              lineHeight: 1.45,
            }}
          >
            ⚠️ <strong>Critical:</strong> You must monitor <code>/health</code> (not the bare root domain <code>https://{unifiedDomain}</code>). In single domain mode, Caddy serves static frontend files with HTTP 200 even when the backend is stopped! Targeting <code>/health</code> ensures Caddy returns <code>HTTP 502 Bad Gateway</code> when the backend goes down to trigger downtime tracking.
          </div>

          {deployMode === 'split' && (
            <div style={{ marginTop: '12px', borderTop: '1px dashed rgba(255, 255, 255, 0.1)', paddingTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Optional Frontend UI Monitor (Checks static dashboard web availability):
                </span>
                <button
                  type="button"
                  onClick={handleCopyFrontendProbe}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    background: copiedFrontendProbe ? 'rgba(48, 209, 88, 0.2)' : 'var(--bg-tertiary)',
                    color: copiedFrontendProbe ? '#30d158' : 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {copiedFrontendProbe ? '✓ Copied' : 'Copy UI URL'}
                </button>
              </div>
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '11px',
                  color: '#a5d6ff',
                  wordBreak: 'break-all',
                }}
              >
                {computedFrontendUrl}
              </div>
            </div>
          )}

          {probeResult && (
            <div
              style={{
                marginTop: '10px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: probeResult.ok ? 'rgba(48, 209, 88, 0.1)' : 'rgba(255, 69, 58, 0.1)',
                border: `1px solid ${probeResult.ok ? 'rgba(48, 209, 88, 0.3)' : 'rgba(255, 69, 58, 0.3)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
              }}
            >
              <span style={{ color: probeResult.ok ? '#30d158' : '#ff453a', fontWeight: 500 }}>
                {probeResult.status}
              </span>
              {probeResult.latency !== undefined && (
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Latency: {probeResult.latency}ms
                </span>
              )}
            </div>
          )}
        </div>

        {/* Section: Public Out-of-Band Status Page */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Public Out-of-Band Status Page (Better Stack / Custom Domain)
              </label>
              {settings['status_page_url'] ? (
                <span style={{ fontSize: '10px', background: 'rgba(48, 209, 88, 0.15)', color: '#30d158', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>
                  Connected
                </span>
              ) : (
                <span style={{ fontSize: '10px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>
                  Unlinked
                </span>
              )}
            </div>
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
            Configure your custom status page URL (e.g. <code>https://status.yourdomain.com</code> via DNS CNAME to <code>statuspage.betteruptime.com</code>, or your hosted Better Stack URL). Survives total VPS downtime and records outages to the second.
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
              marginTop: '8px',
            }}
          />
        </div>

        {/* Section: Duplicate File Detection Mode */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '18px' }}>
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

        {/* Section: Trash Retention Days */}
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

        {/* Section: Allowed Image Formats */}
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

        {/* Section: Allowed Video Formats */}
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

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary press-scale"
          style={{ alignSelf: 'flex-start', padding: '10px 22px', marginTop: '10px', fontSize: '13px', fontWeight: 600 }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};
