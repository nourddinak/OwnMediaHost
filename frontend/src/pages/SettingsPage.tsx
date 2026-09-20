import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

const cleanHost = (val: string) => {
  return val.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:[0-9]+$/, '');
};

const computeDefaultBackendDomain = (host: string): string => {
  const clean = cleanHost(host);
  if (!clean) return '';
  const parts = clean.split('.');
  if (parts.length > 2) {
    return ['api', ...parts.slice(1)].join('.');
  }
  return `api.${clean}`;
};

export const SettingsPage: React.FC = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedProbe, setCopiedProbe] = useState(false);
  const [copiedFrontendProbe, setCopiedFrontendProbe] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; status: string; latency?: number } | null>(null);
  const [initialSettings, setInitialSettings] = useState<Record<string, string>>({});
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [copiedUpdateCmd, setCopiedUpdateCmd] = useState(false);

  // Section expand/collapse state with persistent localStorage
  const [expandedSections, setExpandedSections] = useState<{
    domain: boolean;
    monitoring: boolean;
    policies: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem('ownmediahost_settings_sections');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return { domain: true, monitoring: true, policies: true };
  });

  const toggleSection = (key: 'domain' | 'monitoring' | 'policies') => {
    setExpandedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('ownmediahost_settings_sections', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const allExpanded = expandedSections.domain && expandedSections.monitoring && expandedSections.policies;

  const toggleAll = () => {
    const nextVal = !allExpanded;
    const next = { domain: nextVal, monitoring: nextVal, policies: nextVal };
    setExpandedSections(next);
    try {
      localStorage.setItem('ownmediahost_settings_sections', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  // 1-Click Server Update states
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'running' | 'reconnecting' | 'completed' | 'error'>('idle');
  const [updateLogs, setUpdateLogs] = useState<string>('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const logTerminalRef = useRef<HTMLPreElement>(null);
  const pollTimerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [updateLogs]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await api.getSettings();
        setSettings(data);
        setInitialSettings(data);
      } catch (err: any) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [toast]);

  const defaultHost = typeof window !== 'undefined' ? window.location.host : 'media.yourdomain.com';

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };

      if (key === 'deploy_mode') {
        if (value === 'unified') {
          const dom = cleanHost(prev['domain'] || prev['frontend_domain'] || defaultHost);
          updated['domain'] = dom;
          updated['frontend_domain'] = '';
          updated['backend_domain'] = '';
          updated['public_base_url'] = `https://${dom}`;
        } else {
          const dom = cleanHost(prev['domain'] || prev['frontend_domain'] || defaultHost);
          updated['frontend_domain'] = prev['frontend_domain'] || dom;
          updated['backend_domain'] = prev['backend_domain'] || computeDefaultBackendDomain(dom);
          updated['public_base_url'] = `https://${updated['backend_domain']}`;
        }
      } else if (key === 'domain') {
        const clean = cleanHost(value);
        updated['public_base_url'] = clean ? `https://${clean}` : '';
      } else if (key === 'backend_domain') {
        const clean = cleanHost(value);
        updated['public_base_url'] = clean ? `https://${clean}` : '';
      }

      return updated;
    });
  };

  const handleSave = async () => {
    const currentMode = settings['deploy_mode'] || 'unified';
    const cleanDom = cleanHost(settings['domain'] || settings['frontend_domain'] || defaultHost);
    const cleanFrontend = cleanHost(settings['frontend_domain'] || '');
    const cleanBackend = cleanHost(settings['backend_domain'] || '');

    const finalSettings = { ...settings };
    finalSettings['deploy_mode'] = currentMode;

    if (currentMode === 'unified') {
      finalSettings['domain'] = cleanDom;
      finalSettings['public_base_url'] = `https://${cleanDom}`;
      finalSettings['frontend_domain'] = '';
      finalSettings['backend_domain'] = '';
    } else {
      finalSettings['frontend_domain'] = cleanFrontend || cleanDom;
      finalSettings['backend_domain'] = cleanBackend || computeDefaultBackendDomain(cleanDom);
      finalSettings['domain'] = cleanFrontend || cleanDom;
      finalSettings['public_base_url'] = `https://${finalSettings['backend_domain']}`;
    }

    const domainChanged =
      (finalSettings['deploy_mode'] || 'unified') !== (initialSettings['deploy_mode'] || 'unified') ||
      (finalSettings['domain'] || '') !== (initialSettings['domain'] || '') ||
      (finalSettings['frontend_domain'] || '') !== (initialSettings['frontend_domain'] || '') ||
      (finalSettings['backend_domain'] || '') !== (initialSettings['backend_domain'] || '');

    setSaving(true);
    try {
      await api.updateSettings(finalSettings);
      setSettings(finalSettings);
      setInitialSettings(finalSettings);
      toast('Platform settings updated successfully!');
      if (domainChanged) {
        setUpdatePhase('idle');
        setUpdateLogs('');
        setUpdateError(null);
        setShowUpdateModal(true);
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerUpdate = async () => {
    setUpdatePhase('running');
    setUpdateLogs('⚡ Signaling systemd to execute server update and Caddy routing sync...\n');
    setUpdateError(null);

    try {
      await api.triggerUpdate();
      setUpdateLogs((prev) => prev + '✓ Update signal registered by systemd path watcher.\nStarting background process...\n\n');

      let errorCount = 0;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await api.getUpdateStatus();
          errorCount = 0;
          if (res.log) {
            setUpdateLogs(res.log);
          }
          if (res.success) {
            clearInterval(pollTimerRef.current);
            startReconnectionCheck();
          }
        } catch {
          // Network errors occur naturally during backend service restart
          errorCount++;
          if (errorCount >= 2) {
            clearInterval(pollTimerRef.current);
            setUpdateLogs((prev) => prev + '\n[INFO] Backend service restarting... Waiting for server reconnection...\n');
            startReconnectionCheck();
          }
        }
      }, 1500);
    } catch (err: any) {
      setUpdatePhase('error');
      setUpdateError(err.message || 'Failed to trigger background update.');
    }
  };

  const startReconnectionCheck = () => {
    setUpdatePhase('reconnecting');
    const startTime = Date.now();

    const checkInterval = setInterval(async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          clearInterval(checkInterval);
          setUpdatePhase('completed');
          toast('Server update and domain routing applied successfully!');
          setTimeout(() => {
            window.location.reload();
          }, 1800);
        }
      } catch {
        if (Date.now() - startTime > 90000) {
          clearInterval(checkInterval);
          setUpdatePhase('error');
          setUpdateError('Reconnection timed out. Please check your VPS terminal.');
        }
      }
    }, 2000);
  };

  const handleCopyUpdateCommand = async () => {
    try {
      await navigator.clipboard.writeText('sudo bash /opt/ownmediahost/scripts/update.sh');
      setCopiedUpdateCmd(true);
      setTimeout(() => setCopiedUpdateCmd(false), 2000);
      toast('Update command copied to clipboard!');
    } catch {
      toast('Failed to copy to clipboard', 'error');
    }
  };

  // Determine active topology and probe targets
  const deployMode = settings['deploy_mode'] || 'unified';

  const rawDomain = settings['domain'] || settings['frontend_domain'] || defaultHost;
  const cleanUnifiedDomain = cleanHost(rawDomain) || defaultHost;
  const cleanFrontendDomain = cleanHost(settings['frontend_domain'] || '') || cleanUnifiedDomain;
  const cleanBackendDomain = cleanHost(settings['backend_domain'] || '') || computeDefaultBackendDomain(cleanFrontendDomain);

  const autoBaseUrl = deployMode === 'unified'
    ? `https://${cleanUnifiedDomain}`
    : `https://${cleanBackendDomain}`;

  const computedProbeUrl = deployMode === 'unified'
    ? `https://${cleanUnifiedDomain}/health`
    : `https://${cleanBackendDomain}/health`;

  const computedFrontendUrl = `https://${cleanFrontendDomain}`;

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
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Loading platform settings...
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header Row */}
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">
            Platform Settings
          </h1>
          <p className="page-subtitle">
            Configure domain routing topologies, Better Stack 24/7 out-of-band monitoring, media upload policies, and retention schedules.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={toggleAll}
            className="btn btn-secondary press-scale"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            title={allExpanded ? "Collapse all sections" : "Expand all sections"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: allExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <polyline points="7 13 12 18 17 13" />
              <polyline points="7 6 12 11 17 6" />
            </svg>
            <span>{allExpanded ? 'Collapse All' : 'Expand All'}</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary press-scale settings-header-save-btn"
            aria-label="Save Settings"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Card 1: Domain & Routing Architecture */}
      <section className={`settings-card ${!expandedSections.domain ? 'collapsed' : ''}`}>
        <div
          className="settings-card-header"
          onClick={() => toggleSection('domain')}
          title={expandedSections.domain ? "Click to collapse section" : "Click to expand section"}
        >
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 className="settings-card-title">Domain & Routing Topology</h2>
              <span className="settings-badge">
                {deployMode === 'unified' ? 'Single Unified Domain' : 'Split 2-Domain Mode'}
              </span>
              {!expandedSections.domain && (
                <span className="settings-badge-subtle" style={{ fontFamily: 'var(--font-mono)' }}>
                  {deployMode === 'unified'
                    ? (settings['domain'] || cleanUnifiedDomain || 'Not configured')
                    : `${cleanFrontendDomain || 'UI'} + ${cleanBackendDomain || 'API'}`}
                </span>
              )}
            </div>
            <p className="settings-card-desc">
              Choose whether your server operates with a single unified domain or separates the React frontend dashboard and Axum API across two distinct domains.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
              {expandedSections.domain ? 'Collapse' : 'Expand'}
            </span>
            <span className={`accordion-chevron ${expandedSections.domain ? 'expanded' : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {expandedSections.domain && (
          <div className="settings-card-body">
            {/* Topology Choice Cards */}
        <div className="settings-topology-grid">
          {/* Card 1: Single Unified Domain */}
          <div
            onClick={() => handleChange('deploy_mode', 'unified')}
            className={`settings-choice-card ${deployMode === 'unified' ? 'active' : ''}`}
            role="radio"
            aria-checked={deployMode === 'unified'}
            tabIndex={0}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <input
                type="radio"
                name="deploy_mode"
                checked={deployMode === 'unified'}
                onChange={() => handleChange('deploy_mode', 'unified')}
                style={{ accentColor: '#ffffff' }}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Single Unified Domain
              </span>
              <span className="settings-recommended-pill">
                Recommended
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '26px', lineHeight: 1.45, margin: '0 0 0 26px' }}>
              Caddy reverse-proxy routes both the React dashboard and Axum media streaming APIs under one domain (e.g. <code>media.yourdomain.com</code>). Zero CORS friction.
            </p>
          </div>

          {/* Card 2: Split 2-Domain Setup */}
          <div
            onClick={() => handleChange('deploy_mode', 'split')}
            className={`settings-choice-card ${deployMode === 'split' ? 'active' : ''}`}
            role="radio"
            aria-checked={deployMode === 'split'}
            tabIndex={0}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <input
                type="radio"
                name="deploy_mode"
                checked={deployMode === 'split'}
                onChange={() => handleChange('deploy_mode', 'split')}
                style={{ accentColor: '#ffffff' }}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Split 2-Domain Setup
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '26px', lineHeight: 1.45, margin: '0 0 0 26px' }}>
              Separate frontend dashboard (e.g. <code>media.yourdomain.com</code>) and dedicated backend streaming API (e.g. <code>api.yourdomain.com</code>).
            </p>
          </div>
        </div>

        {/* Domain Inputs */}
        {deployMode === 'unified' ? (
          <div>
            <label className="settings-label">
              Unified Media Domain
            </label>
            <input
              type="text"
              value={settings['domain'] || ''}
              onChange={(e) => handleChange('domain', e.target.value)}
              placeholder="media.yourdomain.com"
              className="settings-input"
            />
            <span className="settings-hint">
              Primary domain pointing to your server VPS.
            </span>
          </div>
        ) : (
          <>
            <div className="settings-grid-2col">
              <div>
                <label className="settings-label">
                  Frontend Dashboard Domain
                </label>
                <input
                  type="text"
                  value={settings['frontend_domain'] || ''}
                  onChange={(e) => handleChange('frontend_domain', e.target.value)}
                  placeholder="media.yourdomain.com"
                  className="settings-input"
                />
                <span className="settings-hint">
                  Serves the React dashboard SPA.
                </span>
              </div>
              <div>
                <label className="settings-label">
                  Backend API Domain
                </label>
                <input
                  type="text"
                  value={settings['backend_domain'] || ''}
                  onChange={(e) => handleChange('backend_domain', e.target.value)}
                  placeholder="api.yourdomain.com"
                  className="settings-input"
                />
                <span className="settings-hint">
                  Axum API and media streaming.
                </span>
              </div>
            </div>

            {/* Split Mode Notice */}
            <div className="settings-notice-box">
              <strong style={{ color: 'var(--text-primary)' }}>VPS Requirement for Split Mode:</strong> Add a DNS <code>A</code> record for <code>{settings['backend_domain'] || 'api.yourdomain.com'}</code> pointing to your VPS IP, then run <code>sudo bash /opt/ownmediahost/scripts/update.sh</code> on your server so Caddy provisions the second SSL certificate and configures cross-domain routing.
            </div>
          </>
        )}

        {/* Public Media Base URL */}
        <div style={{ marginTop: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <label className="settings-label" style={{ margin: 0 }}>
              Public Media Base URL
            </label>
            <span className="settings-badge-subtle">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Auto-Managed
            </span>
          </div>
          <div className="settings-code-box">
            {autoBaseUrl}
          </div>
          <span className="settings-hint">
            Prefix used for generated permanent asset links (<code>/f/...</code>, <code>/a/...</code>, <code>/thumbnails/...</code>). Automatically synchronized with your domain and HTTPS.
          </span>
        </div>
          </div>
        )}
      </section>

      {/* Card 2: Better Stack 24/7 Monitoring */}
      <section className={`settings-card ${!expandedSections.monitoring ? 'collapsed' : ''}`}>
        <div
          className="settings-card-header"
          onClick={() => toggleSection('monitoring')}
          title={expandedSections.monitoring ? "Click to collapse section" : "Click to expand section"}
        >
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffffff', display: 'inline-block' }} />
              <h2 className="settings-card-title">Better Stack 24/7 Health Monitoring</h2>
              {settings['status_page_url'] ? (
                <span className="settings-status-badge connected">
                  Connected
                </span>
              ) : (
                <span className="settings-status-badge unlinked">
                  Unlinked
                </span>
              )}
              {!expandedSections.monitoring && (
                <span className="settings-badge-subtle" style={{ fontFamily: 'var(--font-mono)' }}>
                  {cleanUnifiedDomain}/health
                </span>
              )}
            </div>
            <p className="settings-card-desc">
              Configure independent out-of-band health probes and status pages that monitor your server uptime down to the second.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            {!expandedSections.monitoring && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyProbe();
                }}
                className="btn btn-secondary press-scale settings-btn-sm"
              >
                {copiedProbe ? '✓ Copied' : 'Copy Probe'}
              </button>
            )}
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
              {expandedSections.monitoring ? 'Collapse' : 'Expand'}
            </span>
            <span className={`accordion-chevron ${expandedSections.monitoring ? 'expanded' : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {expandedSections.monitoring && (
          <div className="settings-card-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Enter this URL into your Better Stack monitor (<strong>Uptime → Create Monitor</strong>):
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleCopyProbe}
                  className="btn btn-secondary press-scale settings-btn-sm"
                >
                  {copiedProbe ? '✓ Copied' : 'Copy Probe URL'}
                </button>
                <button
                  type="button"
                  onClick={handleTestProbe}
                  disabled={probing}
                  className="btn btn-secondary press-scale settings-btn-sm"
                >
                  {probing ? 'Testing...' : 'Test Probe'}
                </button>
              </div>
            </div>

        <div className="settings-code-box">
          {computedProbeUrl}
        </div>

        {/* Live Probe Result Feedback */}
        {probeResult && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: probeResult.ok ? 'rgba(48, 209, 88, 0.08)' : 'rgba(255, 69, 58, 0.08)',
              border: `1px solid ${probeResult.ok ? 'rgba(48, 209, 88, 0.25)' : 'rgba(255, 69, 58, 0.25)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
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

        {/* Better Stack Health Warning Notice */}
        <div className="settings-notice-box" style={{ marginTop: '12px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Important:</strong> Monitor <code>/health</code> (not the bare root domain <code>https://{cleanUnifiedDomain}</code>). In single domain mode, Caddy serves static frontend files with HTTP 200 even when the backend is stopped! Targeting <code>/health</code> ensures Caddy returns <code>HTTP 502 Bad Gateway</code> when the backend goes down to trigger downtime tracking.
        </div>

        {/* Optional Frontend UI Probe (if Split Mode) */}
        {deployMode === 'split' && (
          <div style={{ marginTop: '16px', borderTop: '1px dashed rgba(255, 255, 255, 0.1)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Optional Frontend UI Monitor (Checks static dashboard web availability):
              </span>
              <button
                type="button"
                onClick={handleCopyFrontendProbe}
                className="btn btn-secondary press-scale settings-btn-sm"
              >
                {copiedFrontendProbe ? '✓ Copied' : 'Copy UI URL'}
              </button>
            </div>
            <div className="settings-code-box">
              {computedFrontendUrl}
            </div>
          </div>
        )}

        {/* Public Out-of-Band Status Page */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '18px', marginTop: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label className="settings-label" style={{ margin: 0 }}>
                Public Out-of-Band Status Page
              </label>
              {settings['status_page_url'] ? (
                <span className="settings-status-badge connected">
                  Connected
                </span>
              ) : (
                <span className="settings-status-badge unlinked">
                  Unlinked
                </span>
              )}
            </div>
            {settings['status_page_url'] && (
              <a
                href={settings['status_page_url']}
                target="_blank"
                rel="noopener noreferrer"
                className="settings-link"
              >
                Open Status Page ↗
              </a>
            )}
          </div>
          <span className="settings-hint" style={{ marginBottom: '8px' }}>
            Configure your custom status page URL (e.g. <code>https://status.yourdomain.com</code> via DNS CNAME to <code>statuspage.betteruptime.com</code>, or your hosted Better Stack URL).
          </span>
          <input
            type="text"
            value={settings['status_page_url'] || ''}
            onChange={(e) => handleChange('status_page_url', e.target.value)}
            placeholder="https://status.yourdomain.com or https://yourname.betteruptime.com"
            className="settings-input"
          />
        </div>
          </div>
        )}
      </section>

      {/* Card 3: Media Upload Policies & Storage Retention */}
      <section className={`settings-card ${!expandedSections.policies ? 'collapsed' : ''}`}>
        <div
          className="settings-card-header"
          onClick={() => toggleSection('policies')}
          title={expandedSections.policies ? "Click to collapse section" : "Click to expand section"}
        >
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 className="settings-card-title">Media Upload & Retention Policies</h2>
              <span className="settings-badge">
                {settings['trash_retention_days'] || '30'} Days Retention
              </span>
              {!expandedSections.policies && (
                <span className="settings-badge-subtle">
                  Dedup: {settings['duplicate_handling'] || 'allow'}
                </span>
              )}
            </div>
            <p className="settings-card-desc">
              Manage duplicate SHA-256 deduplication, automatic recycle bin pruning, and file format whitelists.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
              {expandedSections.policies ? 'Collapse' : 'Expand'}
            </span>
            <span className={`accordion-chevron ${expandedSections.policies ? 'expanded' : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {expandedSections.policies && (
          <div className="settings-card-body">
            <div className="settings-grid-2col">
              {/* Duplicate Handling */}
              <div>
                <label className="settings-label">
                  Duplicate File Detection Mode
                </label>
                <span className="settings-hint" style={{ marginBottom: '6px' }}>
                  Action taken when an upload matches the SHA-256 hash of an existing file.
                </span>
                <select
                  value={settings['duplicate_handling'] || 'allow'}
                  onChange={(e) => handleChange('duplicate_handling', e.target.value)}
                  className="settings-select"
                >
                  <option value="allow">Allow duplicates (Store multiple copies)</option>
                  <option value="reuse">Reuse existing (Return existing media object)</option>
                  <option value="reject">Reject duplicates (Return 409 Conflict)</option>
                </select>
              </div>

              {/* Trash Retention */}
              <div>
                <label className="settings-label">
                  Trash Retention Period (Days)
                </label>
                <span className="settings-hint" style={{ marginBottom: '6px' }}>
                  Number of days deleted media stays in the recycle bin before permanent pruning.
                </span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={settings['trash_retention_days'] || '30'}
                  onChange={(e) => handleChange('trash_retention_days', e.target.value)}
                  className="settings-input"
                />
              </div>
            </div>

            {/* Allowed Image Formats */}
            <div>
              <label className="settings-label">
                Allowed Image Formats
              </label>
              <span className="settings-hint" style={{ marginBottom: '6px' }}>
                Comma-separated list of permitted image extensions (e.g. jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic).
              </span>
              <input
                type="text"
                value={settings['allowed_image_formats'] || 'jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic'}
                onChange={(e) => handleChange('allowed_image_formats', e.target.value)}
                placeholder="jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic"
                className="settings-input"
              />
            </div>

            {/* Allowed Video Formats */}
            <div>
              <label className="settings-label">
                Allowed Video Formats
              </label>
              <span className="settings-hint" style={{ marginBottom: '6px' }}>
                Comma-separated list of permitted video extensions (e.g. mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp).
              </span>
              <input
                type="text"
                value={settings['allowed_video_formats'] || 'mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp'}
                onChange={(e) => handleChange('allowed_video_formats', e.target.value)}
                placeholder="mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp"
                className="settings-input"
              />
            </div>

            {/* Bottom Save Button Row */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                Changes to domain topologies will prompt 1-click Caddy routing sync.
              </span>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary press-scale"
                style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 600, borderRadius: '8px' }}
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Interactive Post-Save Domain Routing Sync Modal */}
      {showUpdateModal && (
        <div
          className="settings-modal-backdrop"
          onClick={() => {
            if (updatePhase === 'idle' || updatePhase === 'completed' || updatePhase === 'error') {
              setShowUpdateModal(false);
            }
          }}
        >
          <div
            className="settings-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: updatePhase === 'error' ? 'rgba(255, 69, 58, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                  color: updatePhase === 'error' ? '#ff453a' : '#ffffff',
                  fontSize: '16px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                }}
              >
                {updatePhase === 'running' || updatePhase === 'reconnecting' ? '⚡' : (updatePhase === 'error' ? '!' : '✓')}
              </span>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {updatePhase === 'running' && 'Updating Server & Routing...'}
                  {updatePhase === 'reconnecting' && 'Restarting & Reconnecting...'}
                  {updatePhase === 'completed' && 'Update Applied Successfully!'}
                  {updatePhase === 'error' && 'Update Notice'}
                  {updatePhase === 'idle' && 'Domain Routing Saved'}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', display: 'block', marginTop: '2px' }}>
                  {updatePhase === 'running' && 'Isolated background execution via systemd'}
                  {updatePhase === 'reconnecting' && 'Pinging /health until backend is ready'}
                  {updatePhase === 'completed' && 'Dashboard reloading automatically...'}
                  {updatePhase === 'error' && (updateError || 'An error occurred during update')}
                  {updatePhase === 'idle' && 'Synchronized to SQLite and /etc/ownmediahost/ownmediahost.env'}
                </span>
              </div>
            </div>

            {/* Modal Content by Phase */}
            {updatePhase === 'idle' && (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
                  Your domain settings have been saved. To apply Caddy reverse-proxy routing, request SSL certificates, and update the frontend build, you can run the update directly now without opening a terminal:
                </p>

                {/* 1-Click Direct Update Button */}
                <button
                  type="button"
                  onClick={handleTriggerUpdate}
                  className="btn btn-primary press-scale"
                  style={{
                    width: '100%',
                    padding: '12px 18px',
                    fontSize: '14px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    cursor: 'pointer',
                  }}
                >
                  ⚡ Apply & Run Update Now (1-Click)
                </button>

                <div style={{ textAlign: 'center', margin: '14px 0', fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
                  — OR RUN MANUALLY IN VPS TERMINAL —
                </div>

                <div className="settings-terminal-box">
                  <code style={{ fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    sudo bash /opt/ownmediahost/scripts/update.sh
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyUpdateCommand}
                    className="btn btn-secondary press-scale settings-btn-sm"
                  >
                    {copiedUpdateCmd ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setShowUpdateModal(false)}
                    className="btn btn-secondary press-scale"
                    style={{ padding: '8px 18px', fontSize: '12px', borderRadius: '6px' }}
                  >
                    Dismiss
                  </button>
                </div>
              </>
            )}

            {updatePhase === 'running' && (
              <>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  Server update in progress. The updater is synchronizing Caddy virtual hosts and building dashboard assets:
                </p>
                <pre
                  ref={logTerminalRef}
                  style={{
                    background: '#09090b',
                    color: '#f1f5f9',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '12px',
                    borderRadius: '8px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    lineHeight: 1.4,
                    marginBottom: '12px',
                  }}
                >
                  {updateLogs || 'Waiting for first log line...'}
                </pre>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-tertiary)', fontSize: '11px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#30d158', animation: 'pulse 1.5s infinite' }} />
                  Please keep this tab open. Services will automatically restart when finished.
                </div>
              </>
            )}

            {updatePhase === 'reconnecting' && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    margin: '0 auto 14px',
                    borderRadius: '50%',
                    border: '3px solid rgba(255, 255, 255, 0.15)',
                    borderTopColor: '#ffffff',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Restarting services & reconnecting...
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  Pinging <code>/health</code> endpoint. Your browser will reload as soon as OwnMediaHost comes online.
                </p>
              </div>
            )}

            {updatePhase === 'completed' && (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    margin: '0 auto 14px',
                    borderRadius: '50%',
                    background: 'rgba(48, 209, 88, 0.15)',
                    color: '#30d158',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                  }}
                >
                  ✓
                </div>
                <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Server Update Applied!
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  New domain routing and SSL certificates are active. Reloading dashboard now...
                </p>
              </div>
            )}

            {updatePhase === 'error' && (
              <>
                <p style={{ fontSize: '13px', color: '#ff453a', marginBottom: '12px' }}>
                  {updateError || 'An error occurred while communicating with the update watcher.'}
                </p>
                {updateLogs && (
                  <pre
                    style={{
                      background: '#09090b',
                      color: '#f87171',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      padding: '10px',
                      borderRadius: '6px',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      marginBottom: '14px',
                    }}
                  >
                    {updateLogs}
                  </pre>
                )}
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                  You can always run the update manually in your VPS terminal:
                </p>
                <div className="settings-terminal-box">
                  <code style={{ fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    sudo bash /opt/ownmediahost/scripts/update.sh
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyUpdateCommand}
                    className="btn btn-secondary press-scale settings-btn-sm"
                  >
                    {copiedUpdateCmd ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setShowUpdateModal(false)}
                    className="btn btn-primary press-scale"
                    style={{ padding: '8px 18px', fontSize: '12px', borderRadius: '6px' }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Scoped Clean Apple Obsidian CSS */}
      <style>{`

        .settings-header-save-btn {
          padding: 8px 20px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 8px;
        }

        .settings-card {
          background: var(--bg-secondary);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .settings-card.collapsed {
          gap: 0;
          padding: 18px 24px;
        }

        .settings-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          cursor: pointer;
          user-select: none;
        }

        .settings-card-header:hover .settings-card-title {
          color: #ffffff;
        }

        .accordion-chevron {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.15s ease, color 0.15s ease;
        }

        .settings-card-header:hover .accordion-chevron {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .accordion-chevron.expanded {
          transform: rotate(180deg);
        }

        .settings-card-body {
          display: flex;
          flex-direction: column;
          gap: 20px;
          animation: accordionFade 0.2s ease-out;
        }

        @keyframes accordionFade {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .settings-card-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .settings-card-desc {
          font-size: 12px;
          color: var(--text-tertiary);
          margin: 4px 0 0;
          line-height: 1.45;
        }

        .settings-badge {
          font-size: 11px;
          padding: 3px 9px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.08);
          color: #f5f5f7;
          font-weight: 500;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .settings-badge-subtle {
          font-size: 10px;
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-tertiary);
          padding: 2px 7px;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .settings-topology-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 12px;
        }

        .settings-choice-card {
          padding: 16px;
          border-radius: 10px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .settings-choice-card.active {
          background: rgba(255, 255, 255, 0.05);
          border: 1.5px solid rgba(255, 255, 255, 0.28);
        }

        .settings-choice-card:hover:not(.active) {
          border-color: rgba(255, 255, 255, 0.15);
        }

        .settings-recommended-pill {
          font-size: 10px;
          background: rgba(255, 255, 255, 0.1);
          color: #f5f5f7;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 500;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        .settings-grid-2col {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
        }

        .settings-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-primary);
          display: block;
          margin-bottom: 6px;
        }

        .settings-hint {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 4px;
          display: block;
          line-height: 1.4;
        }

        .settings-input,
        .settings-select {
          width: 100%;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: 7px;
          padding: 9px 12px;
          color: #fff;
          font-size: 13px;
          transition: border-color 0.15s ease;
        }

        .settings-input:focus,
        .settings-select:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.35);
        }

        .settings-notice-box {
          padding: 10px 14px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 11.5px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .settings-notice-box code {
          background: rgba(0, 0, 0, 0.4);
          padding: 1px 5px;
          border-radius: 4px;
          font-family: monospace;
          color: #fff;
        }

        .settings-code-box {
          width: 100%;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 7px;
          padding: 9px 12px;
          color: var(--text-primary);
          font-family: var(--font-mono, monospace);
          font-size: 12.5px;
          user-select: all;
          word-break: break-all;
        }

        .settings-btn-sm {
          font-size: 11px;
          padding: 5px 11px;
          border-radius: 6px;
        }

        .settings-status-badge {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 4px;
          font-weight: 500;
        }

        .settings-status-badge.connected {
          background: rgba(48, 209, 88, 0.12);
          color: #30d158;
          border: 1px solid rgba(48, 209, 88, 0.25);
        }

        .settings-status-badge.unlinked {
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-tertiary);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .settings-link {
          font-size: 12px;
          color: var(--text-secondary);
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: color 0.15s ease;
        }

        .settings-link:hover {
          color: var(--text-primary);
          text-decoration: underline;
        }

        .settings-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background-color: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .settings-modal-card {
          background-color: var(--bg-secondary, #18181b);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          padding: 24px;
          max-width: 560px;
          width: 100%;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
        }

        .settings-terminal-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #09090b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 10px 14px;
          gap: 8px;
        }

        @media (max-width: 640px) {
          .settings-card {
            padding: 16px;
            gap: 16px;
          }

          .settings-card.collapsed {
            padding: 14px 16px;
            gap: 0;
          }

          .settings-card-header {
            gap: 10px;
          }

          .settings-header-save-btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};
