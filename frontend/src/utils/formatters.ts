/**
 * Shared formatting utilities for byte sizes and durations across the frontend.
 */

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(dm))} ${sizes[idx]}`;
}

export function formatGB(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0.00';
  return (bytes / 1024 / 1024 / 1024).toFixed(decimals);
}

export function formatMB(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0.0';
  return (bytes / 1024 / 1024).toFixed(decimals);
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds <= 0) {
    return '';
  }
  const s = Math.round(seconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
