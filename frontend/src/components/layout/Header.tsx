import React from 'react';

interface HeaderProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onOpenUpload: () => void;
  onToggleMobileSidebar: () => void;
  isSidebarCollapsed: boolean;
  onToggleSidebarCollapse: () => void;
  title: string;
}

export const Header: React.FC<HeaderProps> = ({
  searchTerm,
  onSearchChange,
  onOpenUpload,
  onToggleMobileSidebar,
  isSidebarCollapsed,
  onToggleSidebarCollapse,
  title,
}) => {
  return (
    <header className="header-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '1 1 auto' }}>
        <button
          onClick={onToggleMobileSidebar}
          style={{
            display: 'none',
            padding: '6px',
            borderRadius: '6px',
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}
          className="mobile-menu-btn"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" x2="20" y1="12" y2="12"/>
            <line x1="4" x2="20" y1="6" y2="6"/>
            <line x1="4" x2="20" y1="18" y2="18"/>
          </svg>
        </button>

        {/* Desktop Sidebar Toggle Button */}
        <button
          onClick={onToggleSidebarCollapse}
          className="sidebar-toggle-btn press-scale"
          title={isSidebarCollapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
          style={{
            padding: '5px',
            borderRadius: '6px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <line x1="9" x2="9" y1="3" y2="21" />
            {isSidebarCollapsed ? <path d="m14 9 3 3-3 3" /> : <path d="m16 9-3 3 3 3" />}
          </svg>
        </button>

        <h1
          className="header-title"
          style={{
            fontSize: '16px',
            fontWeight: 600,
            margin: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* Search Bar */}
        <div
          className="header-search-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 10px',
            width: '240px',
            transition: 'all var(--transition-fast)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            id="global-search-input"
            type="text"
            placeholder="Search media... (/)"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '13px',
              width: '100%',
              minWidth: 0,
            }}
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              style={{ color: 'var(--text-tertiary)', fontSize: '11px', flexShrink: 0 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Upload Button */}
        <button
          onClick={onOpenUpload}
          className="btn btn-primary press-scale header-upload-btn"
          title="Upload media (Hotkey: U)"
          style={{ flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" x2="12" y1="3" y2="15"/>
          </svg>
          <span className="header-upload-label">Upload</span>
          <span
            className="header-upload-key"
            style={{
              fontSize: '10px',
              opacity: 0.6,
              background: 'rgba(0,0,0,0.15)',
              padding: '1px 5px',
              borderRadius: '4px',
              marginLeft: '2px',
            }}
          >
            U
          </span>
        </button>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .mobile-menu-btn { display: flex !important; }
          .sidebar-toggle-btn { display: none !important; }
          .header-bar { padding: 0 12px !important; }
        }
        @media (max-width: 640px) {
          .header-title { font-size: 15px !important; }
          .header-search-bar { width: 130px !important; padding: 5px 8px !important; }
          .header-search-bar input::placeholder { font-size: 12px; }
          .header-upload-label, .header-upload-key { display: none !important; }
          .header-upload-btn { padding: 8px !important; min-width: 36px; min-height: 36px; }
        }
        @media (max-width: 480px) {
          .header-search-bar { display: none !important; }
          .header-title { font-size: 15px !important; max-width: 220px; }
        }
      `}</style>
    </header>
  );
};
