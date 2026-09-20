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
  const [copiedSha, setCopiedSha] = useState(false);

  // Overlays
  const [showTerminalOverlay, setShowTerminalOverlay] = useState(false);
  const [showCommitOverlay, setShowCommitOverlay] = useState(false);
  const [showSshOverlay, setShowSshOverlay] = useState(false);

  const pollTimerRef = useRef<any>(null);
  const reconnectTimerRef = useRef<any>(null);
  const logTerminalRef = useRef<HTMLPreElement>(null);

  const fetchUpdateCheck = async (force = false) => {
    if (force) setChecking(true);
    try {
      const data = await api.checkUpdate(force);
      setUpdateInfo(data);
      if (force) {
        if (data.has_update && data.release_ready) {
          toast('New update verified and ready for installation!', 'success');
        } else if (data.is_building || !data.release_ready) {
          toast('GitHub Actions is compiling release assets. Please wait.', 'info');
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
          }, 2000);
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
    // Strict client-side gate: Never trigger update while release is still building in CI
    if (!updateInfo?.release_ready || !updateInfo?.has_update) {
      toast('Cannot update while release is still building. Please wait for GitHub Actions to complete.', 'error');
      return;
    }

    setUpdatePhase('running');
    setShowTerminalOverlay(true);
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

  const copySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
    toast('Commit SHA copied!');
  };

  const copyTerminalLogs = () => {
    if (updateLogs) {
      navigator.clipboard.writeText(updateLogs);
      toast('Update logs copied to clipboard!');
    }
  };

  // Strictly gate update action: ONLY true when GitHub Actions release assets match main AND differ from installed
  const isActionableUpdate = Boolean(updateInfo?.has_update && updateInfo?.release_ready);
  const isCiBuilding = Boolean(updateInfo?.is_building || (!updateInfo?.release_ready && updateInfo?.latest_commit !== updateInfo?.current_commit));

  return (
    <div className="page-container">
      {/* Header Row */}
      <div className="page-header-row">
        <div className="page-title-group">
          <h1 className="page-main-title">
            Updates & System Notifications
          </h1>
          <p className="page-subtitle">
            Track remote releases from GitHub and manage automated 1-click server updates.
          </p>
        </div>

        <button
          onClick={() => fetchUpdateCheck(true)}
          disabled={checking}
          className="press-scale updates-check-btn"
          aria-label="Check for updates"
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
              flexShrink: 0,
            }}
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
          <span style={{ whiteSpace: 'nowrap' }}>{checking ? 'Checking GitHub...' : 'Check for Updates'}</span>
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Checking GitHub release status...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Main Status Hero Card - Clean Muted Slate (Zero Neon) */}
          <div className="hero-card">
            <div className="hero-content-wrapper">
              <div className="hero-icon-box">
                {isActionableUpdate ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ) : isCiBuilding ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 3s linear infinite' }}>
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                    {isActionableUpdate
                      ? 'New Version Ready to Install'
                      : isCiBuilding
                      ? 'Release Build in Progress'
                      : 'Your Server is Up to Date'}
                  </h2>
                  <span
                    className={`badge-pill ${
                      isActionableUpdate
                        ? 'badge-ready'
                        : isCiBuilding
                        ? 'badge-building'
                        : 'badge-uptodate'
                    }`}
                  >
                    {isActionableUpdate
                      ? 'UPDATE READY'
                      : isCiBuilding
                      ? 'BUILDING IN CI/CD'
                      : 'LATEST'}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {isActionableUpdate
                    ? `Release ${updateInfo?.release_short_commit || updateInfo?.latest_short_commit} has finished compiling and is verified.`
                    : isCiBuilding
                    ? `Commit ${updateInfo?.latest_short_commit} was pushed to main. GitHub Actions is compiling release binaries (~2 min). The update button will unlock once published.`
                    : `Running commit ${updateInfo?.current_short_commit || 'latest'} • All services are synchronized.`}
                </p>
              </div>
            </div>

            {/* ONLY show update button when release is 100% finished and verified */}
            {isActionableUpdate ? (
              <button
                onClick={handleTriggerUpdate}
                disabled={updatePhase === 'running' || updatePhase === 'reconnecting'}
                className="press-scale btn-update-action"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {updatePhase === 'running' || updatePhase === 'reconnecting' ? 'Updating Server...' : 'Update Server Now (~5s)'}
              </button>
            ) : isCiBuilding ? (
              <div className="tag-building-status">
                <div className="spinner" style={{ width: '12px', height: '12px' }} />
                <span>Compiling Release... (~2m)</span>
              </div>
            ) : null}
          </div>

          {/* Details Grid */}
          <div className="details-grid">
            {/* Installed Version Box */}
            <div className="details-card">
              <h3 className="details-card-title">
                Current Installation
              </h3>
              <div className="status-rows-container">
                <div className="status-row">
                  <span className="status-label">Installed Commit</span>
                  <span className="status-value status-mono">
                    {updateInfo?.current_short_commit}
                  </span>
                </div>
                <div className="status-row">
                  <span className="status-label">Binary Engine</span>
                  <span className="status-value">Rust SIMD (x86_64)</span>
                </div>
                <div className="status-row">
                  <span className="status-label">Service Engine</span>
                  <span className="status-value">systemd (ownmediahost)</span>
                </div>
              </div>
            </div>

            {/* Remote Release Box */}
            <div className="details-card">
              <h3 className="details-card-title">
                GitHub Repository Status
              </h3>
              <div className="status-rows-container">
                <div className="status-row">
                  <span className="status-label">Branch 'main'</span>
                  <a
                    href={`https://github.com/nourddinak/OwnMediaHost/commit/${updateInfo?.latest_commit}`}
                    target="_blank"
                    rel="noreferrer"
                    className="status-link status-mono"
                  >
                    {updateInfo?.latest_short_commit} ↗
                  </a>
                </div>
                <div className="status-row">
                  <span className="status-label">Published Release</span>
                  <span className="status-value status-mono">
                    {updateInfo?.release_short_commit || 'latest'}
                  </span>
                </div>
                <div className="status-row">
                  <span className="status-label">Release Build Status</span>
                  <span
                    style={{
                      color: updateInfo?.release_ready
                        ? 'var(--accent-green)'
                        : isCiBuilding
                        ? 'var(--text-secondary)'
                        : 'var(--text-tertiary)',
                      fontWeight: 500,
                      fontSize: '12px',
                    }}
                  >
                    {updateInfo?.release_ready
                      ? '✓ Binaries Ready'
                      : isCiBuilding
                      ? '⏳ Compiling in CI/CD...'
                      : 'Pending Build'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Latest Changelog / Commit Card (Clickable to open overlay) */}
          <div
            className="details-card changelog-trigger press-scale"
            onClick={() => setShowCommitOverlay(true)}
            role="button"
            tabIndex={0}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <h3 className="details-card-title" style={{ margin: 0 }}>
                Latest Changes in Repository
              </h3>
              <span className="view-details-link">
                View Details ›
              </span>
            </div>

            <div className="commit-box">
              <div className="commit-avatar">
                {updateInfo?.author ? updateInfo.author[0].toUpperCase() : 'G'}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="commit-message-preview">
                  {updateInfo?.commit_message || 'Latest release build'}
                </p>
                <div className="commit-meta-row">
                  <span>Author: {updateInfo?.author || 'nourddinak'}</span>
                  <span>•</span>
                  <span className="status-mono">Commit: {updateInfo?.latest_short_commit}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Manual SSH Instructions Card (Clickable to open overlay) */}
          <div className="ssh-card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Prefer CLI update via SSH?
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Run the fast automated updater directly in your server terminal anytime.
              </p>
            </div>

            <div className="ssh-actions-row">
              <button
                onClick={() => setShowSshOverlay(true)}
                className="press-scale btn-ssh-guide"
              >
                Guide
              </button>
              <button
                onClick={copyUpdateCommand}
                className="press-scale btn-ssh-copy"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                {copiedCmd ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Active Update Pill (When minimized during active update - Zero Neon) */}
      {updatePhase !== 'idle' && !showTerminalOverlay && (
        <div
          className="floating-update-pill press-scale"
          onClick={() => setShowTerminalOverlay(true)}
        >
          <div className="pill-pulse-dot" />
          <span style={{ fontWeight: 500, fontSize: '12px' }}>
            {updatePhase === 'completed'
              ? 'Update Completed'
              : updatePhase === 'error'
              ? 'Update Error'
              : 'Server Update Running...'}
          </span>
          <span className="pill-view-action">View Logs ↗</span>
        </div>
      )}

      {/* OVERLAY 1: Live Terminal / Update Runner Modal Bottom Sheet */}
      {showTerminalOverlay && (
        <div className="overlay-backdrop" onClick={() => {
          if (updatePhase !== 'running') setShowTerminalOverlay(false);
        }}>
          <div
            className="overlay-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle for Mobile */}
            <div className="sheet-handle" />

            {/* Overlay Header */}
            <div className="overlay-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  className={`overlay-status-dot ${
                    updatePhase === 'completed'
                      ? 'dot-green'
                      : updatePhase === 'error'
                      ? 'dot-red'
                      : 'dot-neutral'
                  }`}
                />
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Server Update Execution
                  </h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    systemd background worker
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  className={`badge-pill ${
                    updatePhase === 'completed'
                      ? 'badge-uptodate'
                      : updatePhase === 'error'
                      ? 'badge-error'
                      : 'badge-ready'
                  }`}
                >
                  {updatePhase.toUpperCase()}
                </span>
                <button
                  onClick={() => setShowTerminalOverlay(false)}
                  className="press-scale overlay-close-btn"
                  title="Minimize overlay"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Stepper Progress Indicator */}
            <div className="overlay-stepper">
              <div className={`step-item ${updatePhase !== 'idle' ? 'step-active' : ''}`}>
                <div className="step-num">1</div>
                <span>Signal Sent</span>
              </div>
              <div className="step-line" />
              <div className={`step-item ${updatePhase === 'running' || updatePhase === 'reconnecting' || updatePhase === 'completed' ? 'step-active' : ''}`}>
                <div className="step-num">2</div>
                <span>Installing</span>
              </div>
              <div className="step-line" />
              <div className={`step-item ${updatePhase === 'reconnecting' || updatePhase === 'completed' ? 'step-active' : ''}`}>
                <div className="step-num">3</div>
                <span>Restarting</span>
              </div>
              <div className="step-line" />
              <div className={`step-item ${updatePhase === 'completed' ? 'step-active' : ''}`}>
                <div className="step-num">4</div>
                <span>Ready</span>
              </div>
            </div>

            {/* Terminal Window */}
            <div className="overlay-terminal-box">
              <div className="terminal-topbar">
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#3a3a3c' }} />
                  <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#3a3a3c' }} />
                  <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#3a3a3c' }} />
                </div>
                <span style={{ fontSize: '11px', color: '#8e8e93', fontFamily: 'monospace' }}>
                  /var/log/ownmediahost/update.log
                </span>
                <button
                  onClick={copyTerminalLogs}
                  className="terminal-copy-btn"
                >
                  Copy Logs
                </button>
              </div>

              <pre
                ref={logTerminalRef}
                className="terminal-pre"
              >
                {updateLogs || 'Waiting for systemd runner output...'}
              </pre>
            </div>

            {/* Error Message */}
            {updateError && (
              <div className="overlay-error-box">
                {updateError}
              </div>
            )}

            {/* Overlay Footer Actions */}
            <div className="overlay-footer">
              <button
                onClick={() => setShowTerminalOverlay(false)}
                className="btn btn-secondary press-scale"
                style={{ flex: 1, padding: '10px' }}
              >
                Minimize to Background
              </button>
              {updatePhase === 'completed' && (
                <button
                  onClick={() => window.location.reload()}
                  className="btn btn-primary press-scale"
                  style={{ flex: 1, padding: '10px' }}
                >
                  Reload Dashboard Now
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 2: Commit Details Modal Bottom Sheet */}
      {showCommitOverlay && (
        <div className="overlay-backdrop" onClick={() => setShowCommitOverlay(false)}>
          <div className="overlay-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            <div className="overlay-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Commit Details
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  GitHub Main Branch
                </span>
              </div>
              <button
                onClick={() => setShowCommitOverlay(false)}
                className="press-scale overlay-close-btn"
              >
                ✕
              </button>
            </div>

            <div className="overlay-body">
              {/* Commit Message Box */}
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: '10px', padding: '14px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '6px' }}>
                  Commit Message
                </div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {updateInfo?.commit_message || 'Latest release build'}
                </div>
              </div>

              {/* Author & Timestamp */}
              <div className="status-rows-container" style={{ marginTop: '16px' }}>
                <div className="status-row">
                  <span className="status-label">Author</span>
                  <span className="status-value">{updateInfo?.author || 'nourddinak'}</span>
                </div>
                <div className="status-row">
                  <span className="status-label">Published At</span>
                  <span className="status-value">
                    {updateInfo?.published_at ? new Date(updateInfo.published_at).toLocaleString() : 'Recent'}
                  </span>
                </div>
                <div className="status-row">
                  <span className="status-label">Commit SHA</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="status-value status-mono" style={{ fontSize: '11px' }}>
                      {updateInfo?.latest_commit ? updateInfo.latest_commit.substring(0, 12) : ''}
                    </span>
                    <button
                      onClick={() => copySha(updateInfo?.latest_commit || '')}
                      className="press-scale"
                      style={{ fontSize: '10px', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      {copiedSha ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="status-row">
                  <span className="status-label">Release Tag</span>
                  <span className="status-value">{updateInfo?.release_tag || 'latest'}</span>
                </div>
              </div>

              {/* GitHub Link Button */}
              <div style={{ marginTop: '20px' }}>
                <a
                  href={`https://github.com/nourddinak/OwnMediaHost/commit/${updateInfo?.latest_commit}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary press-scale"
                  style={{ width: '100%', padding: '11px', display: 'flex', justifyContent: 'center', gap: '6px', fontSize: '13px' }}
                >
                  View Commit on GitHub ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 3: SSH CLI Instructions Sheet */}
      {showSshOverlay && (
        <div className="overlay-backdrop" onClick={() => setShowSshOverlay(false)}>
          <div className="overlay-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            <div className="overlay-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  SSH CLI Update Instructions
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Manual update via terminal
                </span>
              </div>
              <button
                onClick={() => setShowSshOverlay(false)}
                className="press-scale overlay-close-btn"
              >
                ✕
              </button>
            </div>

            <div className="overlay-body">
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
                Connect to your VPS via SSH and execute the automated updater. The script detects your configuration, downloads verified binaries, and restarts systemd in ~5 seconds.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Step 1 */}
                <div className="cli-step-box">
                  <div className="cli-step-header">
                    <span className="cli-step-num">Step 1</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Run 1-line fast updater</span>
                  </div>
                  <pre className="cli-code-block">
                    sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/nourddinak/OwnMediaHost/main/scripts/update.sh)"
                  </pre>
                  <button
                    onClick={copyUpdateCommand}
                    className="btn btn-secondary press-scale"
                    style={{ width: '100%', padding: '8px', fontSize: '12px', marginTop: '8px' }}
                  >
                    {copiedCmd ? '✓ Command Copied!' : 'Copy Update Command'}
                  </button>
                </div>

                {/* Step 2 */}
                <div className="cli-step-box">
                  <div className="cli-step-header">
                    <span className="cli-step-num">Step 2</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Verify systemd service health</span>
                  </div>
                  <pre className="cli-code-block">
                    sudo systemctl status ownmediahost
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clean Apple Obsidian Styles - Zero Neon */}
      <style>{`

        .updates-check-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 8px 14px;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          flex-shrink: 0;
        }

        .updates-check-btn:hover {
          background: var(--bg-hover);
        }

        /* Hero Status Card - Muted Slate */
        .hero-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 20px 22px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
        }

        .hero-content-wrapper {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 1;
          min-width: 0;
        }

        .hero-icon-box {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        /* Clean Badges (Zero Neon) */
        .badge-pill {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.03em;
          padding: 2px 7px;
          border-radius: 6px;
        }

        .badge-uptodate {
          background: rgba(48, 209, 88, 0.12);
          color: #30d158;
          border: 1px solid rgba(48, 209, 88, 0.2);
        }

        .badge-ready {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .badge-building {
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-secondary);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .badge-error {
          background: rgba(255, 69, 58, 0.12);
          color: #ff453a;
          border: 1px solid rgba(255, 69, 58, 0.2);
        }

        /* Clean White Action Button (Zero Neon Glow) */
        .btn-update-action {
          background: #ffffff;
          color: #000000;
          border: none;
          border-radius: 8px;
          padding: 10px 18px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: opacity 0.15s ease;
          flex-shrink: 0;
        }

        .btn-update-action:hover {
          opacity: 0.9;
        }

        .tag-building-status {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .details-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }

        .details-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 18px;
        }

        .details-card-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          margin: 0 0 12px;
        }

        .status-rows-container {
          display: flex;
          flex-direction: column;
        }

        .status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .status-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .status-label {
          color: var(--text-secondary);
          font-size: 13px;
          flex-shrink: 0;
        }

        .status-value {
          color: var(--text-primary);
          font-size: 13px;
          text-align: right;
          word-break: break-all;
        }

        .status-mono {
          font-family: var(--font-mono);
          font-weight: 600;
        }

        .status-link {
          color: var(--text-primary);
          text-decoration: underline;
          text-underline-offset: 2px;
          font-size: 13px;
        }

        .changelog-trigger {
          cursor: pointer;
          transition: border-color 0.15s ease;
        }

        .changelog-trigger:hover {
          border-color: var(--border-medium);
        }

        .view-details-link {
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        .commit-box {
          background: var(--bg-tertiary);
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .commit-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          flex-shrink: 0;
          font-size: 12px;
          font-weight: 600;
        }

        .commit-message-preview {
          margin: 0;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .commit-meta-row {
          display: flex;
          gap: 10px;
          margin-top: 6px;
          font-size: 11px;
          color: var(--text-tertiary);
          flex-wrap: wrap;
        }

        .ssh-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }

        .ssh-actions-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-ssh-guide {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 6px 12px;
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-ssh-copy {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 6px 12px;
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }

        /* Floating Active Pill - Neutral Obsidian */
        .floating-update-pill {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          background: #1c1c1e;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
          border-radius: 9999px;
          padding: 8px 18px;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 80;
          cursor: pointer;
          animation: floatBounce 0.3s ease;
        }

        .pill-pulse-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ffffff;
        }

        .pill-view-action {
          font-size: 11px;
          color: var(--text-secondary);
          font-weight: 500;
        }

        /* Modals & Overlays */
        .overlay-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          animation: fadeIn 0.15s ease;
        }

        .overlay-sheet {
          background: #141416;
          border: 1px solid var(--border-medium);
          border-radius: 14px;
          width: 100%;
          max-width: 620px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
          display: flex;
          flex-direction: column;
          position: relative;
          animation: scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .sheet-handle {
          display: none;
          width: 36px;
          height: 4px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
          margin: 8px auto 0;
        }

        .overlay-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .overlay-close-btn {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          cursor: pointer;
        }

        .overlay-body {
          padding: 20px;
        }

        .overlay-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .dot-green {
          background: #30d158;
        }

        .dot-neutral {
          background: #ffffff;
        }

        .dot-red {
          background: #ff453a;
        }

        .overlay-stepper {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          background: rgba(255, 255, 255, 0.02);
          border-bottom: 1px solid var(--border-subtle);
        }

        .step-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-tertiary);
          font-weight: 500;
        }

        .step-item.step-active {
          color: var(--text-primary);
        }

        .step-num {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
        }

        .step-item.step-active .step-num {
          background: #ffffff;
          color: #000000;
        }

        .step-line {
          flex: 1;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          margin: 0 8px;
        }

        .overlay-terminal-box {
          margin: 16px 20px;
          background: #090a0c;
          border: 1px solid #23252b;
          border-radius: 8px;
          overflow: hidden;
        }

        .terminal-topbar {
          padding: 8px 12px;
          background: #111216;
          border-bottom: 1px solid #23252b;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .terminal-copy-btn {
          background: transparent;
          color: var(--text-tertiary);
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
        }

        .terminal-copy-btn:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.06);
        }

        .terminal-pre {
          margin: 0;
          padding: 14px;
          max-height: 280px;
          overflow-y: auto;
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.5;
          color: #c9d1d9;
          background: transparent;
        }

        .overlay-error-box {
          margin: 0 20px 14px 20px;
          padding: 12px;
          background: rgba(255, 69, 58, 0.1);
          border: 1px solid rgba(255, 69, 58, 0.2);
          border-radius: 8px;
          color: #ff453a;
          font-size: 13px;
        }

        .overlay-footer {
          padding: 14px 20px;
          border-top: 1px solid var(--border-subtle);
          display: flex;
          gap: 10px;
        }

        .cli-step-box {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 12px;
        }

        .cli-step-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .cli-step-num {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
        }

        .cli-code-block {
          background: #090a0d;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          padding: 10px;
          margin: 0;
          font-family: var(--font-mono);
          font-size: 12px;
          color: #e6edf3;
          white-space: pre-wrap;
          word-break: break-all;
        }

        /* Mobile Adjustments (max-width: 640px) */
        @media (max-width: 640px) {

          .updates-check-btn {
            width: 100%;
            justify-content: center;
            padding: 10px 14px;
          }

          .hero-card {
            padding: 16px;
            flex-direction: column;
            align-items: stretch;
          }

          .hero-content-wrapper {
            align-items: flex-start;
          }

          .btn-update-action, .tag-building-status {
            width: 100%;
            justify-content: center;
          }

          .details-card {
            padding: 14px;
          }

          .status-row {
            padding: 6px 0;
          }

          .status-label, .status-value {
            font-size: 12px;
          }

          .overlay-backdrop {
            padding: 0;
            align-items: flex-end;
          }

          .overlay-sheet {
            border-radius: 18px 18px 0 0;
            max-height: 85vh;
            animation: slideUpBottom 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          }

          .sheet-handle {
            display: block;
          }

          .overlay-stepper {
            padding: 10px 14px;
          }

          .overlay-terminal-box {
            margin: 12px 14px;
          }

          .overlay-footer {
            padding: 12px 14px;
            flex-direction: column;
          }

          .ssh-card {
            flex-direction: column;
            align-items: stretch;
            padding: 14px;
          }

          .ssh-actions-row {
            width: 100%;
          }

          .btn-ssh-guide, .btn-ssh-copy {
            flex: 1;
            justify-content: center;
            padding: 8px 12px;
          }
        }

        @keyframes scaleUp {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        @keyframes slideUpBottom {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        @keyframes floatBounce {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
