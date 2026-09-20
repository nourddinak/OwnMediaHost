import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
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
import { UpdatesPage } from './pages/UpdatesPage';
import { ApiDocsPage } from './pages/ApiDocsPage';
import { LoginPage } from './pages/LoginPage';
import { api, FolderItem } from './api/client';

export const App: React.FC = () => {
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const [currentView, setCurrentView] = useState<PageView>('media');
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [initialUploadFiles, setInitialUploadFiles] = useState<File[]>([]);
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ownmediahost_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');

  const handleToggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ownmediahost_sidebar_collapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

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

  const normalizePastedFile = (file: File): File => {
    const ext = file.type.split('/')[1] || 'png';
    const isGeneric =
      !file.name || file.name === 'image.png' || file.name === 'blob' || file.name.startsWith('image.');
    if (isGeneric) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const newName = `pasted-${timestamp}.${ext}`;
      return new File([file], newName, { type: file.type });
    }
    return file;
  };

  // Global Clipboard Paste Handler (Ctrl+V / Cmd+V)
  useEffect(() => {
    if (!user) return;

    const handleWindowPaste = (e: ClipboardEvent) => {
      // Avoid triggering when user is actively typing in inputs or contenteditable elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems || clipboardItems.length === 0) return;

      const pastedFiles: File[] = [];
      for (let i = 0; i < clipboardItems.length; i++) {
        const item = clipboardItems[i];
        if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
          const file = item.getAsFile();
          if (file) {
            pastedFiles.push(normalizePastedFile(file));
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        setInitialUploadFiles(pastedFiles);
        setUploadDrawerOpen(true);
        toast(`Pasted ${pastedFiles.length} file(s) ready to upload`);
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [user, toast]);

  // Full-Window Drag & Drop Upload Handlers
  useEffect(() => {
    if (!user) return;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsWindowDragging(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsWindowDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsWindowDragging(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const droppedFiles = Array.from(files);
        setInitialUploadFiles(droppedFiles);
        setUploadDrawerOpen(true);
        toast(`Dropped ${droppedFiles.length} file(s) ready to upload`);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [user, toast]);

  // Global Keyboard Shortcuts (U -> Upload, / -> Search, [ -> Toggle Sidebar, Esc -> Close)
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

      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleToggleSidebarCollapse();
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        setUploadDrawerOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('global-search-input');
        searchInput?.focus();
      } else if (e.key === 'Escape') {
        setUploadDrawerOpen(false);
        setInitialUploadFiles([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebarCollapse]);

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
      case 'docs': return 'API Documentation';
      case 'trash': return 'Trash';
      case 'updates': return 'Updates & System';
      case 'settings': return 'Platform Settings';
    }
  };

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleSelectView = (view: PageView) => {
    if (view !== 'media') {
      setSelectedFolderId('');
    }
    setCurrentView(view);
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onSelectView={handleSelectView}
        isOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebarCollapse}
      />

      {/* Main Workspace */}
      <div className="main-content">
        <Header
          title={getPageTitle()}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onOpenUpload={() => setUploadDrawerOpen(true)}
          onToggleMobileSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          isSidebarCollapsed={sidebarCollapsed}
          onToggleSidebarCollapse={handleToggleSidebarCollapse}
        />

        <main className="content-scrollable">
          {currentView === 'media' && (
            <MediaPage
              searchTerm={searchTerm}
              folders={folders}
              refreshTrigger={refreshTrigger}
              onDataChanged={triggerRefresh}
              folderId={selectedFolderId}
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
              onSelectFolder={(folderId) => {
                setSelectedFolderId(folderId);
                setCurrentView('media');
              }}
            />
          )}
          {currentView === 'aliases' && <AliasesPage />}
          {currentView === 'keys' && <ApiKeysPage />}
          {currentView === 'storage' && <StoragePage />}
          {currentView === 'activity' && <ActivityPage />}
          {currentView === 'docs' && <ApiDocsPage />}
          {currentView === 'trash' && <TrashPage onDataChanged={triggerRefresh} />}
          {currentView === 'updates' && <UpdatesPage />}
          {currentView === 'settings' && <SettingsPage />}
        </main>
      </div>

      {/* Full-Window Drag & Drop Overlay */}
      {isWindowDragging && (
        <div className="window-drag-overlay">
          <div className="window-drag-box">
            <div className="window-drag-icon">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <span className="window-drag-title">Drop files anywhere to upload</span>
            <span className="window-drag-subtitle">Release to queue images and videos for upload</span>
          </div>
        </div>
      )}

      {/* Upload Drawer */}
      <UploadDrawer
        isOpen={uploadDrawerOpen}
        initialFiles={initialUploadFiles}
        onClose={() => {
          setUploadDrawerOpen(false);
          setInitialUploadFiles([]);
        }}
        onUploaded={() => {
          triggerRefresh();
        }}
        folders={folders}
      />
    </div>
  );
};
