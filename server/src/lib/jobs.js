import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JOB_TTL_MS, UPLOAD_ROOT } from '../config.js';

/** mediaId -> 媒体任务（含上传文件路径、探测结果） */
const mediaJobs = new Map();
/** exportId -> 导出任务 */
const exportJobs = new Map();

export function createMediaJob({ originalName, storedPath, mediaInfo, sizeBytes }) {
  const id = randomUUID();
  const job = {
    id,
    originalName,
    storedPath,
    sizeBytes,
    mediaInfo,
    uploadDir: path.dirname(storedPath),
    createdAt: Date.now(),
  };
  mediaJobs.set(id, job);
  return job;
}

export function getMediaJob(id) {
  return mediaJobs.get(id) || null;
}

export function createExportJob(media, { outputDir, items, skipped }) {
  const id = randomUUID();
  const job = {
    id,
    mediaId: media.id,
    outputDir,
    items,
    skipped,
    status: 'queued',
    error: null,
    currentChild: null,
    createdAt: Date.now(),
    files: items.map((item) => ({
      kind: item.kind,
      streamIndex: item.streamIndex,
      trackName: item.trackName,
      codec: item.codec,
      fileName: item.fileName,
      outputPath: item.outputPath,
      audioTrackName: item.audio?.trackName ?? null,
      status: 'pending',
      percent: 0,
      speed: null,
      mode: null,
      notice: null,
      error: null,
      sizeBytes: null,
    })),
  };
  exportJobs.set(id, job);
  return job;
}

export function getExportJob(id) {
  return exportJobs.get(id) || null;
}

export function serializeMedia(job) {
  return {
    ...job.mediaInfo,
    id: job.id,
    file: {
      ...job.mediaInfo.file,
      name: job.originalName,
      sizeBytes: job.sizeBytes ?? job.mediaInfo.file.sizeBytes,
    },
    createdAt: new Date(job.createdAt).toISOString(),
  };
}

export function serializeExport(job) {
  const files = job.files.map((file) => ({
    kind: file.kind,
    streamIndex: file.streamIndex,
    trackName: file.trackName,
    codec: file.codec,
    fileName: file.fileName,
    audioTrackName: file.audioTrackName ?? null,
    status: file.status,
    percent: file.percent,
    speed: file.speed,
    mode: file.mode,
    notice: file.notice,
    error: file.error,
    sizeBytes: file.sizeBytes,
  }));
  return {
    id: job.id,
    mediaId: job.mediaId,
    outputDir: job.outputDir,
    status: job.status,
    error: job.error,
    skipped: job.skipped,
    files,
    total: files.length,
    completed: files.filter((f) => f.status === 'done' || f.status === 'failed').length,
    failed: files.filter((f) => f.status === 'failed').length,
    createdAt: new Date(job.createdAt).toISOString(),
  };
}

async function removeDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响主流程
  }
}

/** 删除单个媒体任务及其上传文件 */
export async function dropMediaJob(id) {
  const job = mediaJobs.get(id);
  if (!job) return false;
  mediaJobs.delete(id);
  for (const [exportId, exportJob] of exportJobs) {
    if (exportJob.mediaId === id) exportJobs.delete(exportId);
  }
  await removeDir(job.uploadDir);
  return true;
}

/** 清理没有对应任务记录的上传目录（例如服务重启后遗留的目录） */
export async function sweepOrphanUploadDirs() {
  const entries = await fs.readdir(UPLOAD_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || mediaJobs.has(entry.name)) continue;
    await removeDir(path.join(UPLOAD_ROOT, entry.name));
  }
}

/** 定期清理过期任务与上传文件 */
export async function sweepExpired() {
  const deadline = Date.now() - JOB_TTL_MS;
  for (const [id, job] of mediaJobs) {
    if (job.createdAt < deadline) {
      await dropMediaJob(id);
    }
  }
  for (const [id, job] of exportJobs) {
    if (job.createdAt < deadline) exportJobs.delete(id);
  }
  await sweepOrphanUploadDirs();
}

export async function ensureUploadRoot() {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
}
