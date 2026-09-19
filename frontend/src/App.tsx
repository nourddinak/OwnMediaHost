import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './context/AuthContext';
import { Sidebar, PageView } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { UploadDrawer } from './components/media/UploadDrawer';
import { MediaPage } from './pages/MediaPage';
import { FoldersPage } from './pages/FoldersPage';
import { AliasesPage } from './pages/AliasesPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { StoragePage } from './pages/StoragePage';
import { ActivityPage } from './pages/ActivityPage';
import { TrashPage } from './pages/TrashPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { api, FolderItem } from './api/client';

export const App: React.FC = () => {
  const { user, loading } = useAuth();

  const [currentView, setCurrentView] = useState<PageView>('media');
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchFolders = useCallback(async () => {
    try {
      const items = await api.listFolders();
      setFolders(items);
    } catch {
      // Ignore initial failure if unauthenticated
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchFolders();
    }
  }, [user, fetchFolders, refreshTrigger]);

  // Global Keyboard Shortcuts (U -> Upload, / -> Search, Esc -> Close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when user is typing in input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        setUploadDrawerOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('global-search-input');
        searchInput?.focus();
      } else if (e.key === 'Escape') {
        setUploadDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          height: '100vh',
          width: '100vw',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-tertiary)',
          fontSize: '13px',
        }}
      >
        Initializing OwnMediaHost platform...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const getPageTitle = () => {
    switch (currentView) {
      case 'media': return 'Media Library';
      case 'images': return 'Images';
      case 'videos': return 'Videos';
      case 'folders': return 'Folders';
      case 'aliases': return 'Vanity Aliases';
      case 'keys': return 'API Keys';
      case 'storage': return 'Storage & Usage';
      case 'activity': return 'API Activity';
      case 'trash': return 'Trash';
      case 'settings': return 'Platform Settings';
    }
  };

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onSelectView={setCurrentView}
        isOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Main Workspace */}
      <div className="main-content">
        <Header
          title={getPageTitle()}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onOpenUpload={() => setUploadDrawerOpen(true)}
          onToggleMobileSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        />

        <main className="content-scrollable">
          {currentView === 'media' && (
            <MediaPage
              searchTerm={searchTerm}
              folders={folders}
              refreshTrigger={refreshTrigger}
              onDataChanged={triggerRefresh}
            />
          )}
          {currentView === 'images' && (
            <MediaPage
              mediaTypeFilter="image"
              searchTerm={searchTerm}
              folders={folders}
              refreshTrigger={refreshTrigger}
              onDataChanged={triggerRefresh}
            />
          )}
          {currentView === 'videos' && (
            <MediaPage
              mediaTypeFilter="video"
              searchTerm={searchTerm}
              folders={folders}
              refreshTrigger={refreshTrigger}
              onDataChanged={triggerRefresh}
            />
          )}
          {currentView === 'folders' && (
            <FoldersPage
              folders={folders}
              onRefresh={triggerRefresh}
              onSelectFolder={(_folderId) => {
                setCurrentView('media');
              }}
            />
          )}
          {currentView === 'aliases' && <AliasesPage />}
          {currentView === 'keys' && <ApiKeysPage />}
          {currentView === 'storage' && <StoragePage />}
          {currentView === 'activity' && <ActivityPage />}
          {currentView === 'trash' && <TrashPage onDataChanged={triggerRefresh} />}
          {currentView === 'settings' && <SettingsPage />}
        </main>
      </div>

      {/* Upload Drawer */}
      <UploadDrawer
        isOpen={uploadDrawerOpen}
        onClose={() => setUploadDrawerOpen(false)}
        onUploaded={() => {
          triggerRefresh();
        }}
        folders={folders}
      />
    </div>
  );
};
