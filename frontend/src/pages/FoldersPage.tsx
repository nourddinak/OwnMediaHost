import React, { useState } from 'react';
import { api, FolderItem } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Pagination } from '../components/common/Pagination';

interface FoldersPageProps {
  folders: FolderItem[];
  onRefresh: () => void;
  onSelectFolder: (folderId: string) => void;
}

export const FoldersPage: React.FC<FoldersPageProps> = ({
  folders,
  onRefresh,
  onSelectFolder,
}) => {
  const { toast } = useToast();
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder({ name: newFolderName.trim() });
      toast(`Folder '${newFolderName}' created`);
      setNewFolderName('');
      setCreating(false);
      onRefresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await api.updateFolder(id, { name: editName.trim() });
      toast('Folder updated');
      setEditingId(null);
      onRefresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete folder '${name}'? Media items will be moved to root.`)) {
      return;
    }
    try {
      await api.deleteFolder(id);
      toast('Folder deleted');
      onRefresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const totalPages = Math.ceil(folders.length / pageSize) || 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paginatedFolders = folders.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Folders</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            Organize media assets into logical directories and categories.
          </p>
        </div>

        <button
          onClick={() => setCreating(true)}
          className="btn btn-primary press-scale"
        >
          + New Folder
        </button>
      </div>

      {creating && (
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            placeholder="Folder name (e.g. Portfolio, Marketing)"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
            style={{
              flex: 1,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '6px 10px',
              color: '#fff',
              fontSize: '13px',
            }}
          />
          <button onClick={handleCreate} className="btn btn-primary press-scale">
            Create
          </button>
          <button onClick={() => setCreating(false)} className="btn btn-secondary press-scale">
            Cancel
          </button>
        </div>
      )}

      {/* Folders List */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {folders.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No folders created yet. Click "+ New Folder" to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {paginatedFolders.map((f) => {
              const isEditing = editingId === f.id;
              return (
                <div
                  key={f.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 18px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}
                    onClick={() => onSelectFolder(f.id)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    </svg>

                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(f.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-medium)',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          color: '#fff',
                          fontSize: '13px',
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {f.name}
                      </span>
                    )}

                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                      ({f.media_count} {f.media_count === 1 ? 'file' : 'files'})
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleUpdate(f.id)}
                          className="btn btn-primary press-scale"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="btn btn-secondary press-scale"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(f.id);
                            setEditName(f.name);
                          }}
                          className="btn btn-ghost press-scale"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleDelete(f.id, f.name)}
                          className="btn btn-ghost press-scale"
                          style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--accent-red)' }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {folders.length > 0 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)' }}>
            <Pagination
              currentPage={safePage}
              totalItems={folders.length}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageChange={(p) => setPage(p)}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
