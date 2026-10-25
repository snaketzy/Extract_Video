import { execFile } from 'node:child_process';
import { ffprobePath } from './binaries.js';
import { resolveTrackName } from './trackName.js';

/** 可无损/正常转换为 SRT 的文本字幕编码 */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'utf8',
  'subviewer', 'subviewer1', 'microdvd', 'jacosub', 'sami', 'realtext',
  'stl', 'vplayer', 'eia_608', 'hdmv_text_subtitle', 'ttml',
]);

/** 图形字幕，无法转换为文本字幕（SRT / WebVTT） */
const GRAPHIC_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'dvb_teletext',
]);

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseRate(value) {
  if (!value || typeof value !== 'string') return null;
  const [numStr, denStr] = value.split('/');
  const num = Number(numStr);
  const den = denStr === undefined ? 1 : Number(denStr);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const rate = num / den;
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1000) / 1000 : null;
}

function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath(),
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { maxBuffer: 32 * 1024 * 1024, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ffprobe 解析失败：${String(stderr || error.message).trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(new Error(`ffprobe 输出无法解析：${parseError.message}`));
        }
      }
    );
  });
}

function baseTrack(stream, kind, indexInType) {
  return {
    kind,
    indexInType,
    streamIndex: stream.index,
    codec: stream.codec_name || 'unknown',
    codecLongName: stream.codec_long_name || null,
    profile: stream.profile || null,
    language: stream.tags?.language || null,
    title: stream.tags?.title || null,
    isDefault: stream.disposition?.default === 1,
    isForced: stream.disposition?.forced === 1,
    tags: stream.tags || {},
  };
}

function mapVideo(stream, indexInType) {
  return {
    ...baseTrack(stream, 'video', indexInType),
    width: toNumber(stream.width),
    height: toNumber(stream.height),
    fps: parseRate(stream.avg_frame_rate) ?? parseRate(stream.r_frame_rate),
    bitrate: toNumber(stream.bit_rate),
    pixelFormat: stream.pix_fmt || null,
    level: toNumber(stream.level),
    bitDepth: toNumber(stream.bits_per_raw_sample) ?? toNumber(stream.bits_per_sample),
    colorSpace: stream.color_space && stream.color_space !== 'unknown' ? stream.color_space : null,
    colorTransfer: stream.color_transfer && stream.color_transfer !== 'unknown' ? stream.color_transfer : null,
    colorPrimaries: stream.color_primaries && stream.color_primaries !== 'unknown' ? stream.color_primaries : null,
    fieldOrder: stream.field_order && stream.field_order !== 'unknown' ? stream.field_order : null,
    sampleAspectRatio: stream.sample_aspect_ratio || null,
    displayAspectRatio: stream.display_aspect_ratio || null,
    frameCount: toNumber(stream.nb_frames),
    durationSec: toNumber(stream.duration),
    rotation: stream.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? null,
  };
}

function mapAudio(stream, indexInType) {
  return {
    ...baseTrack(stream, 'audio', indexInType),
    sampleRate: toNumber(stream.sample_rate),
    channels: toNumber(stream.channels),
    channelLayout: stream.channel_layout || null,
    bitrate: toNumber(stream.bit_rate),
    bitDepth: toNumber(stream.bits_per_raw_sample) ?? toNumber(stream.bits_per_sample),
    durationSec: toNumber(stream.duration),
  };
}

function mapSubtitle(stream, indexInType) {
  const codec = stream.codec_name || 'unknown';
  const isTextBased = TEXT_SUBTITLE_CODECS.has(codec);
  const isGraphic = GRAPHIC_SUBTITLE_CODECS.has(codec);
  return {
    ...baseTrack(stream, 'subtitle', indexInType),
    isTextBased,
    convertibleToSrt: isTextBased,
    convertibleToWebVtt: isTextBased,
    note: isGraphic ? '图形字幕（PGS/VobSub），无法转换为 SRT / WebVTT' : null,
  };
}

const MAPPERS = { video: mapVideo, audio: mapAudio, subtitle: mapSubtitle };

/**
 * 解析媒体文件，返回归一化后的轨道信息
 */
export async function probeMedia(filePath, fileName) {
  const raw = await runFfprobe(filePath);
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const tracks = { video: [], audio: [], subtitle: [] };
  const counters = { video: 0, audio: 0, subtitle: 0 };

  for (const stream of streams) {
    const kind = stream.codec_type;
    const mapper = MAPPERS[kind];
    if (!mapper) continue;
    const indexInType = counters[kind];
    counters[kind] += 1;
    const track = mapper(stream, indexInType);
    track.name = resolveTrackName(track, kind, indexInType);
    tracks[kind].push(track);
  }

  const format = raw.format || {};
  const durationSec = toNumber(format.duration)
    ?? (Math.max(0, ...streams.map((s) => toNumber(s.duration) || 0)) || null);

  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';

  return {
    file: {
      name: fileName,
      extension,
      sizeBytes: toNumber(format.size),
    },
    format: {
      name: format.format_name || null,
      longName: format.format_long_name || null,
      durationSec,
      bitrate: toNumber(format.bit_rate),
      sizeBytes: toNumber(format.size),
      streamCount: streams.length,
      tags: format.tags || {},
    },
    counts: {
      video: tracks.video.length,
      audio: tracks.audio.length,
      subtitle: tracks.subtitle.length,
    },
    tracks,
  };
}
