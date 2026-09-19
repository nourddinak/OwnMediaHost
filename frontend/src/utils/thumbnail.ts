// Client-side HTML5 Canvas & Video Thumbnail Generator
// Generates lightweight WebP/JPEG thumbnails and extracts media dimensions & duration
// directly in the browser, eliminating server-side external dependencies like FFmpeg.

export interface GeneratedMediaMeta {
  thumbnailBlob?: Blob;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * Generate a thumbnail from an image file using an offscreen Canvas
 */
export async function generateImageThumbnail(
  file: File,
  maxDim = 400
): Promise<GeneratedMediaMeta> {
  return new Promise((resolve) => {
    if (file.type === 'image/svg+xml' || !file.type.startsWith('image/')) {
      return resolve({});
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      let targetW = width;
      let targetH = height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          targetW = maxDim;
          targetH = Math.round((height * maxDim) / width);
        } else {
          targetH = maxDim;
          targetW = Math.round((width * maxDim) / height);
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, targetW);
      canvas.height = Math.max(1, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return resolve({ width, height });
      }

      ctx.drawImage(img, 0, 0, targetW, targetH);
      canvas.toBlob(
        (blob) => {
          resolve({
            thumbnailBlob: blob || undefined,
            width,
            height,
          });
        },
        'image/jpeg',
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };

    img.src = url;
  });
}

/**
 * Generate a thumbnail frame from a video file using HTML5 Video + Canvas
 */
export async function generateVideoThumbnail(
  file: File,
  maxDim = 400
): Promise<GeneratedMediaMeta> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
      }
    };

    // Safety timeout: if browser cannot decode video codec/container within 4 seconds, proceed without thumbnail
    const timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        resolve({});
      }
    }, 4000);

    video.onloadedmetadata = () => {
      const dur = video.duration || 0;
      // Seek to 0.5s or 10% of duration to get a representative frame (avoid black intro)
      const targetTime = dur > 1 ? Math.min(1.0, dur * 0.1) : 0.1;
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      clearTimeout(timer);
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      const duration = video.duration || 0;

      if (!width || !height) {
        cleanup();
        return resolve({ duration: duration > 0 ? duration : undefined });
      }

      let targetW = width;
      let targetH = height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          targetW = maxDim;
          targetH = Math.round((height * maxDim) / width);
        } else {
          targetH = maxDim;
          targetW = Math.round((width * maxDim) / height);
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, targetW);
      canvas.height = Math.max(1, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        return resolve({ width, height, duration });
      }

      ctx.drawImage(video, 0, 0, targetW, targetH);
      canvas.toBlob(
        (blob) => {
          cleanup();
          resolve({
            thumbnailBlob: blob || undefined,
            width,
            height,
            duration,
          });
        },
        'image/jpeg',
        0.85
      );
    };

    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve({});
    };

    video.src = url;
  });
}

/**
 * Automatically inspects a file and generates a client-side thumbnail & metadata
 */
export async function generateClientMediaMeta(file: File): Promise<GeneratedMediaMeta> {
  try {
    if (file.type.startsWith('video/')) {
      return await generateVideoThumbnail(file);
    } else if (file.type.startsWith('image/')) {
      return await generateImageThumbnail(file);
    }
  } catch (err) {
    console.warn('Client-side media inspection fallback triggered:', err);
  }
  return {};
}
