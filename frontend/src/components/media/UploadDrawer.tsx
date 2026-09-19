import React, { useState, useRef } from 'react';
import { api, FolderItem } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { generateClientMediaMeta } from '../../utils/thumbnail';

interface UploadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
  folders: FolderItem[];
}

interface UploadFileState {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
}

export const UploadDrawer: React.FC<UploadDrawerProps> = ({
  isOpen,
  onClose,
  onUploaded,
  folders,
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<UploadFileState[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [duplicateMode, setDuplicateMode] = useState<string>('allow');
  const [alias, setAlias] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleFiles = (incomingFiles: FileList | null) => {
    if (!incomingFiles || incomingFiles.length === 0) return;
    const newItems: UploadFileState[] = Array.from(incomingFiles).map((file) => ({
      id: Math.random().toString(36).substring(2, 9),
      file,
      progress: 0,
      status: 'pending',
    }));
    setFiles((prev) => [...prev, ...newItems]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const startUpload = async () => {
    if (files.length === 0) return;
    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.status === 'completed') continue;

      setFiles((prev) =>
        prev.map((f) => (f.id === item.id ? { ...f, status: 'uploading', progress: 0 } : f))
      );

      try {
        // Fast-path: For images, upload directly to let backend generate SIMD thumbnails in 1ms.
        // For videos, run lightweight inspection for dimension & poster capture.
        let meta: { thumbnailBlob?: Blob; width?: number; height?: number; duration?: number } = {};
        if (item.file.type.startsWith('video/')) {
          meta = await generateClientMediaMeta(item.file);
        }

        await api.uploadFile(item.file, {
          folder_id: selectedFolder || undefined,
          visibility,
          duplicate_mode: duplicateMode,
          alias: files.length === 1 && alias ? alias : undefined,
          thumbnail: meta.thumbnailBlob,
          width: meta.width,
          height: meta.height,
          duration: meta.duration,
          onProgress: (percent) => {
            setFiles((prev) =>
              prev.map((f) => (f.id === item.id ? { ...f, progress: percent } : f))
            );
          },
        });

        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, status: 'completed', progress: 100 } : f))
        );
      } catch (err: any) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: 'failed', error: err.message || 'Upload failed' }
              : f
          )
        );
      }
    }

    setIsUploading(false);
    toast('Upload process completed!');
    onUploaded();
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: '15px', fontWeight: 600 }}>Upload Media</span>
          <button onClick={onClose} className="btn-ghost press-scale" style={{ padding: '6px', borderRadius: '6px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? 'var(--accent-blue)' : 'var(--border-medium)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '36px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragging ? 'rgba(41, 151, 255, 0.05)' : 'rgba(255, 255, 255, 0.01)',
              transition: 'all var(--transition-fast)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" x2="12" y1="3" y2="15"/>
              </svg>
            </div>
            <div>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                Click to browse
              </span>{' '}
              <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>or drag and drop</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              Supports Images (JPEG, PNG, WebP, GIF, AVIF) & Videos (MP4, WebM, MOV) up to 5GB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Options Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px',
            }}
          >
            {/* Folder Selection */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
                Destination Folder
              </label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: '#fff',
                  fontSize: '12px',
                  marginTop: '4px',
                }}
              >
                <option value="">Root (No folder)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Visibility */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
                Access Visibility
              </label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as any)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: '#fff',
                  fontSize: '12px',
                  marginTop: '4px',
                }}
              >
                <option value="public">Public (Direct URL access)</option>
                <option value="private">Private (Signed URLs only)</option>
              </select>
            </div>

            {/* Duplicate Handling */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
                Duplicate SHA-256 Handling
              </label>
              <select
                value={duplicateMode}
                onChange={(e) => setDuplicateMode(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: '#fff',
                  fontSize: '12px',
                  marginTop: '4px',
                }}
              >
                <option value="allow">Allow Duplicate</option>
                <option value="reuse">Reuse Existing Media</option>
                <option value="reject">Reject Duplicate (409 Conflict)</option>
              </select>
            </div>

            {/* Optional Vanity Alias */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block' }}>
                Optional Alias (e.g. avatar)
              </label>
              <input
                type="text"
                placeholder="profile/avatar"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                disabled={files.length > 1}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: '#fff',
                  fontSize: '12px',
                  marginTop: '4px',
                }}
              />
            </div>
          </div>

          {/* Queue List */}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span>Queue ({files.length} items)</span>
                <button
                  onClick={() => setFiles([])}
                  style={{ color: 'var(--accent-red)', fontSize: '11px' }}
                >
                  Clear Queue
                </button>
              </div>

              {files.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: '#0e0e10',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.file.name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      {item.status === 'completed' && (
                        <span style={{ color: 'var(--accent-green)', fontSize: '12px' }}>✓</span>
                      )}
                      {item.status === 'failed' && (
                        <span style={{ color: 'var(--accent-red)', fontSize: '12px' }} title={item.error}>
                          ✕ Failed
                        </span>
                      )}
                      {item.status === 'pending' && (
                        <button
                          onClick={() => removeFile(item.id)}
                          style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {item.status === 'uploading' && (
                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${item.progress}%`,
                          height: '100%',
                          background: 'var(--accent-blue)',
                          transition: 'width 100ms ease',
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <button onClick={onClose} className="btn btn-secondary press-scale">
            Cancel
          </button>
          <button
            onClick={startUpload}
            disabled={isUploading || files.length === 0}
            className="btn btn-primary press-scale"
          >
            {isUploading ? 'Uploading...' : `Upload ${files.length} Files`}
          </button>
        </div>
      </div>
    </>
  );
};
