import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ffmpegPath } from './binaries.js';
import { baseNameOf, uniqueFileName } from './trackName.js';
import { AUDIO_BITRATE } from '../config.js';

/** libmp3lame 支持的采样率，其他采样率需要重采样 */
const MP3_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

/** MP4 容器可直接复制的音频编码，其余（TrueHD / DTS / PCM 等）需转码为 AAC */
const MP4_AUDIO_COPY_CODECS = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac']);

/** 字幕导出格式 -> 文件扩展名 */
const SUBTITLE_EXTENSIONS = { srt: 'srt', webvtt: 'vtt' };
/** 字幕导出格式 -> 展示名（用于跳过原因） */
const SUBTITLE_LABELS = { srt: 'SRT', webvtt: 'WebVTT' };

/** 把请求中的字幕格式收敛为受支持的值，默认 webvtt */
export function normalizeSubtitleFormat(value) {
  if (value === 'srt' || value === 'sup') return value;
  return 'webvtt';
}

const COPY_FALLBACK_ERROR = 'MP4 容器不支持直接复制该视频编码，已自动转码';
const STAGED_EXPORT_NOTICE = '当前目录受 macOS 权限限制，已自动先导出到临时目录再搬运到目标文件夹';

/**
 * 执行一次 FFmpeg，并通过 -progress 上报进度
 */
function runFfmpeg(args, { durationSec = 0, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stderr = '';
    let buffered = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
    });

    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const separator = line.indexOf('=');
        if (separator < 0) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1).trim();
        if (key === 'out_time_us' || key === 'out_time_ms') {
          const seconds = Number(value) / 1e6;
          if (durationSec > 0 && Number.isFinite(seconds)) {
            onProgress({ percent: Math.min(99.5, (seconds / durationSec) * 100) });
          }
        } else if (key === 'speed') {
          onProgress({ speed: value === 'N/A' ? null : value });
        }
      }
    });

    child.on('error', (error) => reject(new Error(`无法启动 FFmpeg：${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stderr, child });
        return;
      }
      const detail = stderr.trim().split('\n').slice(-4).join(' ').trim();
      const error = new Error(detail || `FFmpeg 退出码 ${code}`);
      error.exitCode = code;
      error.child = child;
      reject(error);
    });

    onProgress({ child });
  });
}

/**
 * 视频轨：可选把「默认音轨」一起封装进 MP4
 * 音频能直接放进 MP4 时无损复制，否则转码为 AAC
 */
function videoArgs({ inputPath, streamIndex, outputPath, codec, copy, audio }) {
  const args = ['-y', '-i', inputPath, '-map', `0:${streamIndex}`];

  if (audio) {
    args.push('-map', `0:${audio.streamIndex}`);
    args.push(
      ...(MP4_AUDIO_COPY_CODECS.has(audio.codec)
        ? ['-c:a', 'copy']
        : ['-c:a', 'aac', '-b:a', AUDIO_BITRATE])
    );
  } else {
    args.push('-an');
  }

  args.push('-sn', '-dn');

  if (copy) {
    args.push('-c:v', 'copy', ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []));
  } else {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  }

  args.push('-movflags', '+faststart', outputPath);
  return args;
}

function audioArgs({ inputPath, streamIndex, outputPath, sampleRate }) {
  const args = [
    '-y', '-i', inputPath,
    '-map', `0:${streamIndex}`,
    '-vn', '-sn', '-dn',
    '-c:a', 'libmp3lame',
    '-b:a', AUDIO_BITRATE,
  ];
  if (!sampleRate || !MP3_SAMPLE_RATES.has(sampleRate)) {
    args.push('-ar', '48000');
  }
  args.push('-id3v2_version', '3', outputPath);
  return args;
}

function subtitleArgs({ inputPath, streamIndex, outputPath, format }) {
  const codec = normalizeSubtitleFormat(format);
  return [
    '-y', '-i', inputPath,
    '-map', `0:${streamIndex}`,
    '-vn', '-an', '-dn',
    // PGS 抽取为 .sup 是原样复制，不做任何转换
    '-c:s', codec === 'sup' ? 'copy' : codec,
    '-f', codec,
    outputPath,
  ];
}

/**
 * 生成导出计划：按需求命名
 *  - 视频：<原文件名>.mp4（多视频轨时追加 .v2 / .v3），并封装选定的默认音轨
 *  - 音频：<原文件名>.<音频轨道名>.mp3（默认音轨已并入视频，不再单独导出）
 *  - 字幕：<原文件名>.<字幕轨道名>.srt / .vtt（格式由 selection.subtitleFormat 决定）
 */
export function buildPlan(media, outputDir, selection) {
  const base = baseNameOf(media.file.name);
  const used = new Set();
  const items = [];
  const skipped = [];

  const videoTotal = media.tracks.video.length;

  const selectedVideo = media.tracks.video.filter((track) => selection.video.includes(track.streamIndex));
  const hasAudioTracks = media.tracks.audio.length > 0;

  // 只有确实要导出视频时，默认音轨才生效（用于并入 MP4）
  const defaultAudioStream =
    selectedVideo.length > 0 && hasAudioTracks && Number.isInteger(selection.defaultAudio)
      ? media.tracks.audio.find((track) => track.streamIndex === selection.defaultAudio) || null
      : null;

  for (const track of selectedVideo) {
    const suffix = videoTotal > 1 ? `.v${track.indexInType + 1}` : '';
    const fileName = uniqueFileName(`${base}${suffix}.mp4`, used);
    items.push({
      kind: 'video',
      streamIndex: track.streamIndex,
      trackName: track.name,
      codec: track.codec,
      fileName,
      outputPath: path.join(outputDir, fileName),
      durationSec: track.durationSec || media.format.durationSec || 0,
      audio: defaultAudioStream
        ? {
            streamIndex: defaultAudioStream.streamIndex,
            trackName: defaultAudioStream.name,
            codec: defaultAudioStream.codec,
          }
        : null,
    });
  }

  for (const track of media.tracks.audio) {
    if (!selection.audio.includes(track.streamIndex)) continue;
    if (defaultAudioStream && track.streamIndex === defaultAudioStream.streamIndex) continue;
    const fileName = uniqueFileName(`${base}.${track.name}.mp3`, used);
    items.push({
      kind: 'audio',
      streamIndex: track.streamIndex,
      trackName: track.name,
      codec: track.codec,
      sampleRate: track.sampleRate,
      fileName,
      outputPath: path.join(outputDir, fileName),
      durationSec: track.durationSec || media.format.durationSec || 0,
    });
  }

  const subtitleFormat = normalizeSubtitleFormat(selection.subtitleFormat);

  for (const track of media.tracks.subtitle) {
    if (!selection.subtitle.includes(track.streamIndex)) continue;

    // PGS 图形字幕不受 SRT / WebVTT 单选影响，一律原样抽取为 .sup
    if (track.convertibleToSup) {
      const fileName = uniqueFileName(`${base}.${track.name}.sup`, used);
      items.push({
        kind: 'subtitle',
        streamIndex: track.streamIndex,
        trackName: track.name,
        codec: track.codec,
        format: 'sup',
        fileName,
        outputPath: path.join(outputDir, fileName),
        durationSec: track.durationSec || media.format.durationSec || 0,
      });
      continue;
    }

    const convertible =
      subtitleFormat === 'webvtt' ? track.convertibleToWebVtt : track.convertibleToSrt;
    if (!convertible) {
      skipped.push({
        kind: 'subtitle',
        streamIndex: track.streamIndex,
        trackName: track.name,
        reason: track.note || `字幕编码 ${track.codec} 无法转换为 ${SUBTITLE_LABELS[subtitleFormat]}`,
      });
      continue;
    }
    const fileName = uniqueFileName(`${base}.${track.name}.${SUBTITLE_EXTENSIONS[subtitleFormat]}`, used);
    items.push({
      kind: 'subtitle',
      streamIndex: track.streamIndex,
      trackName: track.name,
      codec: track.codec,
      format: subtitleFormat,
      fileName,
      outputPath: path.join(outputDir, fileName),
      durationSec: track.durationSec || media.format.durationSec || 0,
    });
  }

  return { items, skipped };
}

async function hasContent(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function removeQuietly(filePath) {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // 忽略删除失败
  }
}

async function removeDirQuietly(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // 忽略删除失败
  }
}

function appendNotice(current, message) {
  if (!message) return current ?? null;
  if (!current) return message;
  if (current.includes(message)) return current;
  return `${current}；${message}`;
}

async function probeDirectWrite(outputDir) {
  const probePath = path.join(outputDir, `.extract-video-write-test-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(probePath, 'ok');
    await fs.rm(probePath, { force: true });
    return { ok: true };
  } catch (error) {
    await removeQuietly(probePath);
    return { ok: false, error };
  }
}

/** Finder 找不到目标文件夹时会一直挂住不返回，必须设上限 */
const APPLESCRIPT_TIMEOUT_MS = 60000;

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: APPLESCRIPT_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || '').trim();
        if (detail) {
          reject(new Error(`AppleScript 执行失败：${detail}`));
          return;
        }
        if (error.killed || error.signal) {
          reject(new Error(`Finder 无响应（超过 ${APPLESCRIPT_TIMEOUT_MS / 1000} 秒未返回）`));
          return;
        }
        reject(new Error(`AppleScript 执行失败：${error.message}`));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

/**
 * 用 Finder 逐级补齐缺失的目录。
 * Node 进程在 ~/Movies 等受保护目录下可能没有写权限，但 Finder 有，所以交给 Finder 创建。
 */
async function ensureFinderFolder(dirPath) {
  const segments = dirPath.split(path.sep).filter(Boolean);
  if (segments.length === 0) return;

  const lines = ['tell application "Finder"'];
  let current = '';
  for (const segment of segments) {
    const parent = current || path.sep;
    current = `${current}${path.sep}${segment}`;
    lines.push(
      '  try',
      `    set _item to (POSIX file ${JSON.stringify(current)}) as alias`,
      '  on error',
      `    make new folder at (POSIX file ${JSON.stringify(parent)}) with properties {name:${JSON.stringify(segment)}}`,
      '  end try'
    );
  }
  lines.push('end tell');
  await runAppleScript(lines.join('\n'));
}

/** 把 staging 产物搬运到目标目录；目标文件夹不存在时先补建 */
async function moveWithAppleScript(sourcePath, targetPath) {
  const targetDir = path.dirname(targetPath);
  const script = [
    `set srcFile to POSIX file ${JSON.stringify(sourcePath)}`,
    `set dstFolder to POSIX file ${JSON.stringify(targetDir)}`,
    'tell application "Finder" to duplicate srcFile to dstFolder with replacing',
  ].join('\n');
  try {
    await ensureFinderFolder(targetDir);
    await runAppleScript(script);
  } catch (error) {
    throw new Error(`搬运到 ${targetDir} 失败：${error.message}`);
  }
}

async function resolveOutputStrategy(exportJob, media) {
  const direct = await probeDirectWrite(exportJob.outputDir);
  if (direct.ok) {
    return { mode: 'direct', stagingDir: null };
  }

  if (process.platform !== 'darwin') {
    throw new Error(`输出目录不可写：${exportJob.outputDir}（${direct.error.message}）`);
  }

  const baseDir = media.uploadDir || path.dirname(media.storedPath);
  const stagingDir = path.join(baseDir, '__export_staging__', exportJob.id);
  await fs.mkdir(stagingDir, { recursive: true });
  return {
    mode: 'staged',
    stagingDir,
    reason: direct.error.message,
  };
}

async function runItem(item, media, outputPath, hooks) {
  const inputPath = media.storedPath;
  const context = { ...item, inputPath, outputPath };

  const buildArgs = (copy) => {
    if (item.kind === 'video') return videoArgs({ ...context, copy });
    if (item.kind === 'audio') return audioArgs(context);
    return subtitleArgs(context);
  };

  const attempt = async (copy) => {
    try {
      await runFfmpeg(buildArgs(copy), {
        durationSec: item.durationSec,
        onProgress: hooks.onProgress,
      });
      if (!(await hasContent(outputPath))) {
        throw new Error('输出文件为空');
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const first = await attempt(true);
  if (first.ok) {
    hooks.onProgress({ percent: 100, speed: null });
    // 只有视频轨道存在「直接复制 / 转码」的区分
    return { mode: item.kind === 'video' ? 'copy' : null };
  }

  // 视频轨道复制失败时，回退到转码；其他类型直接报错
  if (item.kind !== 'video') throw first.error;

  hooks.onNotice?.(COPY_FALLBACK_ERROR);
  await removeQuietly(outputPath);
  hooks.onProgress({ percent: 0, speed: null });

  const second = await attempt(false);
  if (second.ok) {
    hooks.onProgress({ percent: 100, speed: null });
    return { mode: 'transcode' };
  }
  throw second.error;
}

/**
 * 顺序执行导出计划，实时更新 exportJob 状态
 */
export async function runExportJob(exportJob, media) {
  const { items } = exportJob;

  exportJob.status = 'running';
  exportJob.startedAt = new Date().toISOString();

  let strategy;
  try {
    strategy = await resolveOutputStrategy(exportJob, media);
  } catch (error) {
    exportJob.status = 'failed';
    exportJob.error = error.message;
    exportJob.finishedAt = new Date().toISOString();
    return exportJob;
  }

  try {
    for (let index = 0; index < exportJob.files.length; index += 1) {
      if (exportJob.status === 'cancelled') break;

      const file = exportJob.files[index];
      const item = items[index];
      const workPath = strategy.mode === 'staged' ? path.join(strategy.stagingDir, item.fileName) : item.outputPath;
      file.status = 'running';
      file.percent = 0;
      file.notice = strategy.mode === 'staged' ? appendNotice(file.notice, STAGED_EXPORT_NOTICE) : file.notice;

      try {
        const result = await runItem(item, media, workPath, {
          onProgress: ({ percent, speed, child }) => {
            if (child) exportJob.currentChild = child;
            if (typeof percent === 'number') file.percent = Math.round(percent * 10) / 10;
            if (speed !== undefined) file.speed = speed;
          },
          onNotice: (message) => {
            file.notice = appendNotice(file.notice, message);
          },
        });

        const workStat = await fs.stat(workPath);
        if (strategy.mode === 'staged') {
          await moveWithAppleScript(workPath, item.outputPath);
        }

        file.mode = result.mode;
        file.status = 'done';
        file.percent = 100;
        file.sizeBytes = workStat.size;
      } catch (error) {
        file.status = 'failed';
        file.percent = 0;
        file.error = error.message;
        await removeQuietly(workPath);
      } finally {
        exportJob.currentChild = null;
      }
    }
  } finally {
    if (strategy?.stagingDir) {
      await removeDirQuietly(strategy.stagingDir);
    }
  }

  if (exportJob.status === 'cancelled') {
    exportJob.finishedAt = new Date().toISOString();
    return exportJob;
  }

  exportJob.status = 'completed';
  exportJob.finishedAt = new Date().toISOString();
  return exportJob;
}

/** 中止导出：杀掉当前 FFmpeg 进程并标记任务已取消 */
export function cancelExportJob(exportJob) {
  exportJob.status = 'cancelled';
  exportJob.error = '用户已取消导出';
  if (exportJob.currentChild) {
    try {
      exportJob.currentChild.kill('SIGKILL');
    } catch {
      // 进程可能已退出
    }
  }
  return exportJob;
}
