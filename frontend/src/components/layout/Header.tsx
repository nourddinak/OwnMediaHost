import React from 'react';

interface HeaderProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onOpenUpload: () => void;
  onToggleMobileSidebar: () => void;
  title: string;
}

export const Header: React.FC<HeaderProps> = ({
  searchTerm,
  onSearchChange,
  onOpenUpload,
  onToggleMobileSidebar,
  title,
}) => {
  return (
    <header className="header-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          onClick={onToggleMobileSidebar}
          style={{
            display: 'none',
            padding: '6px',
            borderRadius: '6px',
            color: 'var(--text-secondary)',
          }}
          className="mobile-menu-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" x2="20" y1="12" y2="12"/>
            <line x1="4" x2="20" y1="6" y2="6"/>
            <line x1="4" x2="20" y1="18" y2="18"/>
          </svg>
        </button>

        <h1 style={{ fontSize: '17px', fontWeight: 600 }}>{title}</h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Search Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 10px',
            width: '240px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            }}
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Upload Button */}
        <button
          onClick={onOpenUpload}
          className="btn btn-primary press-scale"
          title="Upload media (Hotkey: U)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" x2="12" y1="3" y2="15"/>
          </svg>
          Upload
          <span
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
        }
      `}</style>
    </header>
  );
};
