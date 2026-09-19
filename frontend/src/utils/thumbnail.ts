// Client-side HTML5 Canvas & Video Thumbnail Generator
// Generates lightweight JPEG thumbnails and extracts media dimensions & duration
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
 * Check if the captured frame is essentially solid black (e.g. video fade-in).
 * Samples a grid of pixels and checks average luminance.
 */
function isFrameBlack(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const sampleSize = 8;
  let totalLuminance = 0;
  let samples = 0;

  for (let sx = 0; sx < sampleSize; sx++) {
    for (let sy = 0; sy < sampleSize; sy++) {
      const px = Math.floor((sx + 0.5) * w / sampleSize);
      const py = Math.floor((sy + 0.5) * h / sampleSize);
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      // Perceived luminance: 0.299R + 0.587G + 0.114B
      totalLuminance += 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2];
      samples++;
    }
  }

  const avgLuminance = totalLuminance / samples;
  // If average luminance is below 8 (out of 255), consider it black
  return avgLuminance < 8;
}

/**
 * Wait until the video has decoded enough frame data to draw (readyState >= 2).
 * Uses requestVideoFrameCallback where available, falls back to polling readyState.
 */
function waitForFrameReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    // Already have enough data to draw
    if (video.readyState >= 2) {
      return resolve();
    }

    // Use requestVideoFrameCallback if the browser supports it (Chrome 83+, Edge, Safari 15.4+)
    const vid = video as any;
    if (typeof vid.requestVideoFrameCallback === 'function') {
      vid.requestVideoFrameCallback(() => resolve());
      return;
    }

    // Fallback: event listeners + polling
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      video.removeEventListener('canplay', check);
      video.removeEventListener('loadeddata', check);
      resolve();
    };
    const check = () => {
      if (video.readyState >= 2) finish();
    };
    video.addEventListener('canplay', check);
    video.addEventListener('loadeddata', check);
    const poll = setInterval(check, 50);
    // Absolute safety cap
    setTimeout(finish, 3000);
  });
}

/**
 * Capture the current video frame to a canvas and return the blob (or null if black).
 */
function captureFrame(
  video: HTMLVideoElement,
  maxDim: number
): { blob: Promise<Blob | null>; isBlack: boolean; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  if (!width || !height) return null;

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
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, targetW, targetH);
  const black = isFrameBlack(ctx, targetW, targetH);

  return {
    isBlack: black,
    canvas,
    ctx,
    blob: new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
    }),
  };
}

/**
 * Generate a thumbnail frame from a video file using HTML5 Video + Canvas.
 *
 * Key differences from naive implementations:
 * - Uses preload='auto' so frame pixel data is actually decoded
 * - Waits for readyState >= 2 (HAVE_CURRENT_DATA) before drawImage
 * - Samples pixel luminance to detect and skip solid-black intro frames
 * - Retries at a later timestamp if the first capture is black
 */
export async function generateVideoThumbnail(
  file: File,
  maxDim = 400
): Promise<GeneratedMediaMeta> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    // CRITICAL: 'auto' instead of 'metadata' — forces the browser to decode frame pixels
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    // Prevent video from being visible
    video.style.position = 'fixed';
    video.style.top = '-9999px';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';

    const url = URL.createObjectURL(file);
    let resolved = false;
    let seekAttempt = 0;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
        if (video.parentElement) {
          video.parentElement.removeChild(video);
        }
      }
    };

    // Safety timeout: 8 seconds total for the entire thumbnail process
    const timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        resolve({});
      }
    }, 8000);

    // Pick seek targets: try 1s/15% first, then 2.5s/25%, then 5s/40%
    const getSeekTime = (dur: number, attempt: number): number => {
      if (dur <= 0.5) return 0.1;
      const targets = [
        dur > 3 ? Math.min(1.0, dur * 0.15) : 0.3,
        dur > 5 ? Math.min(2.5, dur * 0.25) : Math.min(1.0, dur * 0.5),
        dur > 8 ? Math.min(5.0, dur * 0.4) : Math.min(dur * 0.7, dur - 0.1),
      ];
      return targets[Math.min(attempt, targets.length - 1)];
    };

    const attemptCapture = async () => {
      // Wait for the frame pixels to be decoded
      await waitForFrameReady(video);

      // Extra frame for compositor to flush
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      const duration = video.duration || 0;

      if (!width || !height) {
        clearTimeout(timer);
        cleanup();
        return resolve({ duration: duration > 0 ? duration : undefined });
      }

      const result = captureFrame(video, maxDim);
      if (!result) {
        clearTimeout(timer);
        cleanup();
        return resolve({ width, height, duration });
      }

      // If the frame is black and we haven't exhausted retries, seek further
      if (result.isBlack && seekAttempt < 2 && duration > 1) {
        seekAttempt++;
        const nextTime = getSeekTime(duration, seekAttempt);
        video.currentTime = nextTime;
        // onseeked will re-trigger attemptCapture
        return;
      }

      const blob = await result.blob;
      clearTimeout(timer);
      cleanup();
      resolve({
        thumbnailBlob: blob || undefined,
        width,
        height,
        duration,
      });
    };

    video.onloadedmetadata = () => {
      const dur = video.duration || 0;
      const targetTime = getSeekTime(dur, 0);
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      attemptCapture();
    };

    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve({});
    };

    // Append to DOM so the browser actually decodes frames
    document.body.appendChild(video);
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
