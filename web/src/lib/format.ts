export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

export function formatBitrate(bitsPerSecond: number | null | undefined): string {
  if (!bitsPerSecond || !Number.isFinite(bitsPerSecond)) return '—';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

export function formatFps(fps: number | null | undefined): string {
  if (!fps || !Number.isFinite(fps)) return '—';
  return `${Number.isInteger(fps) ? fps : fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} fps`;
}

export function formatSampleRate(rate: number | null | undefined): string {
  if (!rate || !Number.isFinite(rate)) return '—';
  return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`;
}

export function formatChannels(channels: number | null | undefined): string {
  if (!channels) return '—';
  const names: Record<number, string> = { 1: '单声道', 2: '立体声', 6: '5.1', 8: '7.1' };
  return `${channels} 声道${names[channels] ? `（${names[channels]}）` : ''}`;
}

export function formatResolution(width: number | null, height: number | null): string {
  if (!width || !height) return '—';
  return `${width} × ${height}`;
}

export function formatText(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

export const TRACK_KIND_LABELS = {
  video: '视频轨道',
  audio: '音频轨道',
  subtitle: '字幕轨道',
} as const;
