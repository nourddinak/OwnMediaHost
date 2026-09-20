import React, { useState, useEffect, useRef } from 'react';
import { api, UpdateCheckResponse } from '../api/client';
import { useToast } from '../context/ToastContext';

export const UpdatesPage: React.FC = () => {
  const { toast } = useToast();
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'running' | 'reconnecting' | 'completed' | 'error'>('idle');
  const [updateLogs, setUpdateLogs] = useState<string>('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const pollTimerRef = useRef<any>(null);
  const reconnectTimerRef = useRef<any>(null);
  const logTerminalRef = useRef<HTMLPreElement>(null);

  const fetchUpdateCheck = async (force = false) => {
    if (force) setChecking(true);
    try {
      const data = await api.checkUpdate(force);
      setUpdateInfo(data);
      if (force) {
        if (data.has_update) {
          toast('New update found on GitHub!', 'success');
        } else {
          toast('Your server is up to date!', 'info');
        }
      }
    } catch (err: any) {
      console.error('Failed to check for updates:', err);
      if (force) toast(err.message || 'Failed to check GitHub for updates.', 'error');
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    fetchUpdateCheck(false);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (reconnectTimerRef.current) clearInterval(reconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [updateLogs]);

  const startReconnectionCheck = () => {
    setUpdatePhase('reconnecting');
    let attempts = 0;
    const maxAttempts = 30;

    if (reconnectTimerRef.current) clearInterval(reconnectTimerRef.current);
    reconnectTimerRef.current = setInterval(async () => {
      attempts++;
      try {
        const health = await api.getHealth();
        if (health.status === 'ok' || health.status === 'degraded') {
          clearInterval(reconnectTimerRef.current);
          setUpdatePhase('completed');
          toast('Server update completed! Reloading dashboard...', 'success');
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(reconnectTimerRef.current);
          setUpdatePhase('error');
          setUpdateError('Backend took longer than expected to reconnect. Please refresh the page manually.');
        }
      }
    }, 1500);
  };

  const handleTriggerUpdate = async () => {
    setUpdatePhase('running');
    setUpdateLogs('⚡ Signaling systemd to execute fast server update...\n');
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

  const copyUpdateCommand = () => {
    const cmd = 'sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)"';
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    toast('Terminal update command copied to clipboard!');
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            Updates & System Notifications
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '4px 0 0' }}>
            Track remote releases from GitHub and manage automated 1-click server updates.
          </p>
        </div>

        <button
          onClick={() => fetchUpdateCheck(true)}
          disabled={checking}
          className="press-scale"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '8px 14px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: checking ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
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
              animation: checking ? 'spin 1s linear infinite' : 'none',
            }}
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
          {checking ? 'Checking GitHub...' : 'Check for Updates'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Checking GitHub release status...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Status Hero Card */}
          <div
            style={{
              background: updateInfo?.has_update
                ? 'linear-gradient(135deg, rgba(255, 159, 10, 0.12), rgba(255, 100, 0, 0.04))'
                : updateInfo?.is_building
                ? 'linear-gradient(135deg, rgba(10, 132, 255, 0.12), rgba(255, 159, 10, 0.06))'
                : 'linear-gradient(135deg, rgba(48, 209, 88, 0.1), rgba(0, 122, 255, 0.03))',
              border: `1px solid ${
                updateInfo?.has_update
                  ? 'rgba(255, 159, 10, 0.3)'
                  : updateInfo?.is_building
                  ? 'rgba(10, 132, 255, 0.3)'
                  : 'rgba(48, 209, 88, 0.25)'
              }`,
              borderRadius: '12px',
              padding: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  background: updateInfo?.has_update
                    ? 'rgba(255, 159, 10, 0.2)'
                    : updateInfo?.is_building
                    ? 'rgba(10, 132, 255, 0.2)'
                    : 'rgba(48, 209, 88, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: updateInfo?.has_update
                    ? '#ff9f0a'
                    : updateInfo?.is_building
                    ? '#0a84ff'
                    : '#30d158',
                }}
              >
                {updateInfo?.has_update ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : updateInfo?.is_building ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 3s linear infinite' }}>
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                    {updateInfo?.has_update
                      ? 'New Update Available!'
                      : updateInfo?.is_building
                      ? 'Release Build in Progress'
                      : 'Your Server is Up to Date'}
                  </h2>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: updateInfo?.has_update
                        ? 'rgba(255, 159, 10, 0.2)'
                        : updateInfo?.is_building
                        ? 'rgba(10, 132, 255, 0.2)'
                        : 'rgba(48, 209, 88, 0.2)',
                      color: updateInfo?.has_update
                        ? '#ff9f0a'
                        : updateInfo?.is_building
                        ? '#0a84ff'
                        : '#30d158',
                    }}
                  >
                    {updateInfo?.has_update
                      ? 'READY TO INSTALL'
                      : updateInfo?.is_building
                      ? 'BUILDING IN CI/CD'
                      : 'LATEST'}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {updateInfo?.has_update
                    ? `Release ${updateInfo.release_short_commit || updateInfo.latest_short_commit} has finished compiling and is ready for 1-click install.`
                    : updateInfo?.is_building
                    ? `Commit ${updateInfo.latest_short_commit} was pushed to main. GitHub Actions is compiling release binaries (~2 min).`
                    : `Running commit ${updateInfo?.current_short_commit || 'latest'} • All services are synchronized.`}
                </p>
              </div>
            </div>

            {updateInfo?.has_update ? (
              <button
                onClick={handleTriggerUpdate}
                disabled={updatePhase === 'running' || updatePhase === 'reconnecting'}
                className="press-scale"
                style={{
                  background: '#ff9f0a',
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(255, 159, 10, 0.25)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {updatePhase === 'running' || updatePhase === 'reconnecting' ? 'Updating...' : 'Update Server Now (~5s)'}
              </button>
            ) : updateInfo?.is_building ? (
              <button
                disabled
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '10px 18px',
                  fontWeight: 500,
                  fontSize: '13px',
                  cursor: 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <div className="spinner" style={{ width: '14px', height: '14px' }} />
                Building Release... (~2m)
              </button>
            ) : null}
          </div>

          {/* Details Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
            {/* Installed Version Box */}
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '18px',
              }}
            >
              <h3 style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                Current Installation
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Installed Commit</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {updateInfo?.current_short_commit}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Binary Engine</span>
                  <span style={{ color: 'var(--text-primary)' }}>Rust SIMD (Linux x86_64)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Service Management</span>
                  <span style={{ color: 'var(--text-primary)' }}>systemd (ownmediahost.service)</span>
                </div>
              </div>
            </div>

            {/* Remote Release Box */}
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '18px',
              }}
            >
              <h3 style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                GitHub Repository Status
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Branch 'main'</span>
                  <a
                    href={`https://github.com/nourddinak/OwnMediaHost/commit/${updateInfo?.latest_commit}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontFamily: 'monospace', color: '#0a84ff', textDecoration: 'none' }}
                  >
                    {updateInfo?.latest_short_commit} ↗
                  </a>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Published Release</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                    {updateInfo?.release_short_commit || 'latest'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Release Build Status</span>
                  <span
                    style={{
                      color: updateInfo?.release_ready
                        ? '#30d158'
                        : updateInfo?.is_building
                        ? '#0a84ff'
                        : '#ff9f0a',
                      fontWeight: 500,
                    }}
                  >
                    {updateInfo?.release_ready
                      ? '✓ Binaries Ready'
                      : updateInfo?.is_building
                      ? '⏳ Compiling in CI/CD...'
                      : 'Pending Build'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Latest Changelog / Commit Card */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                Latest Changes in Repository
              </h3>
              {updateInfo?.published_at && (
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  Published {new Date(updateInfo.published_at).toLocaleString()}
                </span>
              )}
            </div>

            <div
              style={{
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  flexShrink: 0,
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {updateInfo?.author ? updateInfo.author[0].toUpperCase() : 'G'}
              </div>

              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {updateInfo?.commit_message || 'Latest release build'}
                </p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  <span>Author: {updateInfo?.author || 'nourddinak'}</span>
                  <span>•</span>
                  <span>Commit: {updateInfo?.latest_short_commit}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Live Update Runner Terminal (if triggered) */}
          {(updatePhase !== 'idle' || updateLogs) && (
            <div
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '10px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '10px 16px',
                  background: '#161b22',
                  borderBottom: '1px solid #30363d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f56' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#27c93f' }} />
                  <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px', fontFamily: 'monospace' }}>
                    Server Update Execution (systemd)
                  </span>
                </div>

                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background:
                      updatePhase === 'completed'
                        ? 'rgba(48, 209, 88, 0.2)'
                        : updatePhase === 'error'
                        ? 'rgba(255, 69, 58, 0.2)'
                        : 'rgba(255, 159, 10, 0.2)',
                    color:
                      updatePhase === 'completed'
                        ? '#30d158'
                        : updatePhase === 'error'
                        ? '#ff453a'
                        : '#ff9f0a',
                  }}
                >
                  {updatePhase.toUpperCase()}
                </span>
              </div>

              <pre
                ref={logTerminalRef}
                style={{
                  margin: 0,
                  padding: '16px',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: '#c9d1d9',
                  background: 'transparent',
                }}
              >
                {updateLogs || 'Waiting for systemd runner logs...'}
              </pre>

              {updateError && (
                <div style={{ padding: '12px 16px', background: 'rgba(255, 69, 58, 0.15)', color: '#ff453a', fontSize: '13px' }}>
                  {updateError}
                </div>
              )}
            </div>
          )}

          {/* Manual SSH Instructions Card */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Prefer CLI update via SSH?
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                You can also run the fast updater directly in your server terminal anytime.
              </p>
            </div>

            <button
              onClick={copyUpdateCommand}
              className="press-scale"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '6px 12px',
                color: 'var(--text-primary)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              {copiedCmd ? 'Copied Command!' : 'Copy CLI Command'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
