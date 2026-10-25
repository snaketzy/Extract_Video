export type TrackKind = 'video' | 'audio' | 'subtitle';

export interface BaseTrack {
  kind: TrackKind;
  indexInType: number;
  streamIndex: number;
  codec: string;
  codecLongName: string | null;
  profile: string | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  name: string;
  durationSec: number | null;
}

export interface VideoTrack extends BaseTrack {
  kind: 'video';
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrate: number | null;
  pixelFormat: string | null;
  level: number | null;
  bitDepth: number | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  fieldOrder: string | null;
  displayAspectRatio: string | null;
  frameCount: number | null;
  rotation: number | null;
}

export interface AudioTrack extends BaseTrack {
  kind: 'audio';
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitrate: number | null;
  bitDepth: number | null;
}

export interface SubtitleTrack extends BaseTrack {
  kind: 'subtitle';
  isTextBased: boolean;
  convertibleToSrt: boolean;
  note: string | null;
}

export type AnyTrack = VideoTrack | AudioTrack | SubtitleTrack;

export interface MediaInfo {
  id: string;
  createdAt: string;
  file: {
    name: string;
    extension: string;
    sizeBytes: number | null;
  };
  format: {
    name: string | null;
    longName: string | null;
    durationSec: number | null;
    bitrate: number | null;
    sizeBytes: number | null;
    streamCount: number;
  };
  counts: Record<TrackKind, number>;
  tracks: {
    video: VideoTrack[];
    audio: AudioTrack[];
    subtitle: SubtitleTrack[];
  };
}

export type ExportFileStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ExportFileState {
  kind: TrackKind;
  streamIndex: number;
  trackName: string;
  codec: string;
  fileName: string;
  status: ExportFileStatus;
  percent: number;
  speed: string | null;
  mode: 'copy' | 'transcode' | null;
  notice: string | null;
  error: string | null;
  sizeBytes: number | null;
}

export interface SkippedTrack {
  kind: TrackKind;
  streamIndex: number;
  trackName: string;
  reason: string;
}

export type ExportStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExportJob {
  id: string;
  mediaId: string;
  outputDir: string;
  status: ExportStatus;
  error: string | null;
  skipped: SkippedTrack[];
  files: ExportFileState[];
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
}

export interface BinaryInfo {
  available: boolean;
  path: string | null;
  source: 'system' | 'bundled' | null;
  version: string | null;
  message?: string;
}

export interface HealthPayload {
  ok: boolean;
  binaries: Record<'ffmpeg' | 'ffprobe', BinaryInfo>;
}

export interface AppConfig {
  folderPickerSupported: boolean;
  folderPickerDisabled: boolean;
  platform: string;
  defaultOutputDir: string;
  maxUploadBytes: number;
}
