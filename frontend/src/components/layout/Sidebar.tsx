import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export type PageView =
  | 'media'
  | 'images'
  | 'videos'
  | 'folders'
  | 'aliases'
  | 'keys'
  | 'storage'
  | 'activity'
  | 'updates'
  | 'docs'
  | 'trash'
  | 'settings';

interface SidebarProps {
  currentView: PageView;
  onSelectView: (view: PageView) => void;
  isOpen: boolean;
  onCloseMobile: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  isOpen,
  onCloseMobile,
  isCollapsed,
  onToggleCollapse,
}) => {
  const { user, logout } = useAuth();
  const [statusUrl, setStatusUrl] = useState<string>('');
  const [healthStatus, setHealthStatus] = useState<'operational' | 'degraded' | 'offline'>('operational');
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    let mounted = true;
    const checkHealthAndSettings = async () => {
      try {
        const health = await api.getHealth();
        if (mounted) {
          if (health.status === 'operational') {
            setHealthStatus('operational');
          } else if (health.status === 'degraded') {
            setHealthStatus('degraded');
          } else {
            setHealthStatus('offline');
          }
        }
      } catch {
        if (mounted) setHealthStatus('offline');
      }

      try {
        const settings = await api.getSettings();
        if (mounted && settings && settings.status_page_url) {
          setStatusUrl(settings.status_page_url.trim());
        } else if (mounted) {
          setStatusUrl('');
        }
      } catch {
        // unconfigured
      }

      try {
        const update = await api.checkUpdate();
        if (mounted && update) {
          setHasUpdate(update.has_update);
        }
      } catch {
        // offline or unconfigured
      }
    };

    checkHealthAndSettings();
    const interval = setInterval(checkHealthAndSettings, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const navItems: { id: PageView; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'media',
      label: 'All Media',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
      ),
    },
    {
      id: 'images',
      label: 'Images',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="m14.31 8 5.74 9.94"/>
          <path d="M9.69 8h11.48"/>
          <path d="m7.38 12 5.74-9.94"/>
          <path d="M9.69 16 3.95 6.06"/>
          <path d="M14.31 16H2.83"/>
          <path d="m16.62 12-5.74 9.94"/>
        </svg>
      ),
    },
    {
      id: 'videos',
      label: 'Videos',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect width="14" height="14" x="1" y="5" rx="2" ry="2"/>
        </svg>
      ),
    },
    {
      id: 'folders',
      label: 'Folders',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
        </svg>
      ),
    },
    {
      id: 'aliases',
      label: 'Aliases',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      ),
    },
    {
      id: 'keys',
      label: 'API Keys',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
          <path d="m21 2-9.6 9.6"/>
          <circle cx="7.5" cy="15.5" r="5.5"/>
        </svg>
      ),
    },
    {
      id: 'storage',
      label: 'Storage',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M3 5v14a9 3 0 0 0 18 0V5"/>
          <path d="M3 12a9 3 0 0 0 18 0"/>
        </svg>
      ),
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      ),
    },
    {
      id: 'docs',
      label: 'API Docs',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
        </svg>
      ),
    },
    {
      id: 'trash',
      label: 'Trash',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18"/>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
        </svg>
      ),
    },
    {
      id: 'updates',
      label: 'Updates',
      badge: hasUpdate ? 'NEW' : undefined,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="16 12 12 8 8 12"/>
          <line x1="12" y1="16" x2="12" y2="8"/>
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      ),
    },
  ];

  return (
    <>
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 95,
          }}
          onClick={onCloseMobile}
        />
      )}

      <aside className={`sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
        {/* Brand Header */}
        <div
          style={{
            height: '54px',
            padding: isCollapsed ? '0 12px' : '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'space-between',
            gap: '8px',
            borderBottom: '1px solid var(--border-subtle)',
            position: 'relative',
          }}
        >
          <div
            onClick={isCollapsed ? onToggleCollapse : undefined}
            title={isCollapsed ? "Expand sidebar ([)" : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: isCollapsed ? 'pointer' : 'default',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                minWidth: '28px',
                borderRadius: '6px',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000000',
                transition: 'transform 0.15s ease',
              }}
              className={isCollapsed ? "press-scale" : undefined}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
              </svg>
            </div>
            {!isCollapsed && (
              <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                OwnMediaHost
              </span>
            )}
          </div>

          {!isCollapsed && (
            <button
              onClick={onToggleCollapse}
              title="Collapse sidebar ([)"
              className="sidebar-toggle-btn press-scale"
              style={{
                padding: '5px',
                borderRadius: '6px',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                <line x1="9" x2="9" y1="3" y2="21"/>
                <path d="m16 9-3 3 3 3"/>
              </svg>
            </button>
          )}
        </div>

        {/* Navigation List */}
        <div style={{ flex: 1, padding: isCollapsed ? '12px 6px' : '12px 10px', overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {navItems.map((item) => {
              const active = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectView(item.id);
                    onCloseMobile();
                  }}
                  title={item.label}
                  className="press-scale"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    gap: isCollapsed ? 0 : '10px',
                    width: '100%',
                    padding: isCollapsed ? '9px 0' : '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    fontWeight: active ? 600 : 400,
                    color: active ? '#ffffff' : 'var(--text-secondary)',
                    background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    textAlign: 'left',
                    transition: 'all 120ms ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {item.icon}
                    {isCollapsed && item.badge && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '-2px',
                          right: '-2px',
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: '#ff9f0a',
                          boxShadow: '0 0 6px #ff9f0a',
                        }}
                      />
                    )}
                  </span>
                  {!isCollapsed && <span style={{ flex: 1 }}>{item.label}</span>}
                  {!isCollapsed && item.badge && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: '8px',
                        background: 'rgba(255, 159, 10, 0.2)',
                        color: '#ff9f0a',
                        border: '1px solid rgba(255, 159, 10, 0.4)',
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Out-of-Band System Status Link */}
          <div style={{ padding: isCollapsed ? '12px 0 6px' : '6px 12px 10px', display: 'flex', justifyContent: 'center' }}>
            {statusUrl ? (
              <a
                href={statusUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="press-scale"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  gap: isCollapsed ? 0 : '8px',
                  width: isCollapsed ? '38px' : '100%',
                  height: isCollapsed ? '38px' : 'auto',
                  padding: isCollapsed ? 0 : '6px 10px',
                  borderRadius: isCollapsed ? '8px' : 'var(--radius-sm)',
                  fontSize: '12px',
                  color: 'var(--text-tertiary)',
                  textDecoration: 'none',
                  border: '1px dashed var(--border-subtle)',
                  transition: 'all 120ms ease',
                }}
                title={
                  healthStatus === 'operational'
                    ? 'Status: Operational — click to view 24/7 public status'
                    : 'Status: Degraded / Offline — click to view 24/7 public status'
                }
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    minWidth: '6px',
                    borderRadius: '50%',
                    background:
                      healthStatus === 'operational'
                        ? '#2ea043'
                        : healthStatus === 'degraded'
                        ? '#d29922'
                        : '#f85149',
                    boxShadow:
                      healthStatus === 'operational'
                        ? '0 0 6px rgba(46, 160, 67, 0.4)'
                        : healthStatus === 'degraded'
                        ? '0 0 6px rgba(210, 153, 34, 0.4)'
                        : '0 0 6px rgba(248, 81, 73, 0.4)',
                  }}
                />
                {!isCollapsed && (
                  <>
                    <span style={{ color: healthStatus === 'operational' ? 'var(--text-secondary)' : '#f85149', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {healthStatus === 'operational' ? 'Status: Operational' : healthStatus === 'degraded' ? 'Status: Degraded' : 'Status: Offline'}
                    </span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', opacity: 0.6 }}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </>
                )}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => onSelectView('settings')}
                className="press-scale"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  gap: isCollapsed ? 0 : '8px',
                  width: isCollapsed ? '38px' : '100%',
                  height: isCollapsed ? '38px' : 'auto',
                  padding: isCollapsed ? 0 : '6px 10px',
                  borderRadius: isCollapsed ? '8px' : 'var(--radius-sm)',
                  fontSize: '12px',
                  color: 'var(--text-tertiary)',
                  background: 'transparent',
                  border: '1px dashed var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}
                title="Status: Operational — Click to configure status page in Settings"
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    minWidth: '6px',
                    borderRadius: '50%',
                    background:
                      healthStatus === 'operational'
                        ? '#2ea043'
                        : healthStatus === 'degraded'
                        ? '#d29922'
                        : '#f85149',
                    boxShadow:
                      healthStatus === 'operational'
                        ? '0 0 6px rgba(46, 160, 67, 0.4)'
                        : healthStatus === 'degraded'
                        ? '0 0 6px rgba(210, 153, 34, 0.4)'
                        : '0 0 6px rgba(248, 81, 73, 0.4)',
                  }}
                />
                {!isCollapsed && (
                  <span style={{ color: healthStatus === 'operational' ? 'var(--text-secondary)' : '#f85149', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {healthStatus === 'operational' ? 'Status: Operational' : healthStatus === 'degraded' ? 'Status: Degraded' : 'Status: Offline'}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* User Footer */}
        <div
          style={{
            padding: isCollapsed ? '12px 6px' : '14px 16px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'space-between',
            flexDirection: isCollapsed ? 'column' : 'row',
            gap: isCollapsed ? '8px' : '0',
          }}
        >
          {isCollapsed ? (
            <>
              <div
                title={user?.email || 'Administrator (Self-Hosted)'}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {(user?.email?.[0] || 'A').toUpperCase()}
              </div>
              <button
                onClick={logout}
                title="Sign out"
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="btn-ghost"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" x2="9" y1="12" y2="12"/>
                </svg>
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '140px',
                  }}
                >
                  {user?.email || 'Administrator'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Self-Hosted</span>
              </div>

              <button
                onClick={logout}
                title="Sign out"
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="btn-ghost"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" x2="9" y1="12" y2="12"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
