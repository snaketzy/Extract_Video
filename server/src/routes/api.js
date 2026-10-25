import { Router } from 'express';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { DEFAULT_OUTPUT_DIR, FOLDER_PICKER_ENABLED, MAX_UPLOAD_BYTES, UPLOAD_ROOT } from '../config.js';
import { describeBinaries } from '../lib/binaries.js';
import { probeMedia } from '../lib/probe.js';
import { buildPlan, cancelExportJob, runExportJob } from '../lib/export.js';
import {
  createExportJob,
  createMediaJob,
  dropMediaJob,
  getExportJob,
  getMediaJob,
  serializeExport,
  serializeMedia,
} from '../lib/jobs.js';
import { FolderPickerUnsupportedError, pickDirectory } from '../lib/folderPicker.js';

export const apiRouter = Router();

function toStreamIndexes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0);
}

apiRouter.get('/health', async (_req, res) => {
  const binaries = await describeBinaries();
  res.json({
    ok: Boolean(binaries.ffmpeg.available && binaries.ffprobe.available),
    binaries,
  });
});

apiRouter.get('/config', (_req, res) => {
  res.json({
    folderPickerSupported: FOLDER_PICKER_ENABLED && process.platform === 'darwin',
    folderPickerDisabled: !FOLDER_PICKER_ENABLED,
    platform: process.platform,
    defaultOutputDir: DEFAULT_OUTPUT_DIR,
    maxUploadBytes: MAX_UPLOAD_BYTES,
  });
});

/**
 * 上传源视频：请求体直接是文件二进制流，文件名通过 x-file-name 头传递
 */
apiRouter.post('/media', async (req, res, next) => {
  const rawName = req.get('x-file-name');
  if (!rawName) {
    res.status(400).json({ error: '缺少 x-file-name 请求头' });
    return;
  }

  let originalName = rawName;
  try {
    originalName = decodeURIComponent(rawName);
  } catch {
    // 保留原始值
  }
  originalName = path.basename(originalName).trim() || 'input';

  const declaredLength = Number(req.get('content-length') || 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: `文件体积超过上限（${(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024).toFixed(1)}GB）` });
    return;
  }

  const id = randomUUID();
  const uploadDir = path.join(UPLOAD_ROOT, id);
  const extension = path.extname(originalName).toLowerCase();
  const storedPath = path.join(uploadDir, `source${extension}`);

  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        callback(new Error(`文件体积超过上限（${(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024).toFixed(1)}GB）`));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await pipeline(req, counter, createWriteStream(storedPath));

    if (received === 0) throw new Error('未接收到文件内容');

    const mediaInfo = await probeMedia(storedPath, originalName);
    const job = createMediaJob({ originalName, storedPath, mediaInfo, sizeBytes: received });
    res.json(serializeMedia(job));
  } catch (error) {
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    next(error);
  }
});

apiRouter.get('/media/:id', (req, res) => {
  const job = getMediaJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: '媒体任务不存在或已过期，请重新选择文件' });
    return;
  }
  res.json(serializeMedia(job));
});

apiRouter.delete('/media/:id', async (req, res, next) => {
  try {
    const removed = await dropMediaJob(req.params.id);
    if (!removed) {
      res.status(404).json({ error: '媒体任务不存在' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** 服务端弹出原生目录选择框 */
apiRouter.post('/media/:id/pick-directory', async (req, res, next) => {
  try {
    const result = await pickDirectory({ prompt: req.body?.prompt || '请选择导出目录' });
    res.json(result);
  } catch (error) {
    if (error instanceof FolderPickerUnsupportedError) {
      res.status(501).json({ error: error.message, folderPickerSupported: false });
      return;
    }
    next(error);
  }
});

/** 创建导出任务 */
apiRouter.post('/media/:id/export', async (req, res, next) => {
  try {
    const job = getMediaJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: '媒体任务不存在或已过期，请重新选择文件' });
      return;
    }

    const outputDir = String(req.body?.outputDir || '').trim();
    if (!outputDir) {
      res.status(400).json({ error: '请先选择导出目录' });
      return;
    }
    if (!path.isAbsolute(outputDir)) {
      res.status(400).json({ error: '导出目录必须是绝对路径' });
      return;
    }

    const streams = req.body?.streams || {};
    const selection = {
      video: toStreamIndexes(streams.video),
      audio: toStreamIndexes(streams.audio),
      subtitle: toStreamIndexes(streams.subtitle),
    };

    const audioTracks = job.mediaInfo.tracks.audio;
    const rawDefaultAudio = Number(req.body?.defaultAudio);
    const defaultAudio = Number.isInteger(rawDefaultAudio) && rawDefaultAudio >= 0 ? rawDefaultAudio : null;

    // 导出视频时必须指定默认音轨，用于封装进 MP4
    if (selection.video.length > 0 && audioTracks.length > 0) {
      if (defaultAudio === null) {
        res.status(400).json({ error: '请先为视频选择默认音轨' });
        return;
      }
      if (!audioTracks.some((track) => track.streamIndex === defaultAudio)) {
        res.status(400).json({ error: '默认音轨不存在，请重新选择' });
        return;
      }
    }
    selection.defaultAudio = defaultAudio;

    const { items, skipped } = buildPlan(job.mediaInfo, outputDir, selection);
    if (items.length === 0) {
      res.status(400).json({ error: '未选中任何可导出的轨道', skipped });
      return;
    }

    const exportJob = createExportJob(job, { outputDir, items, skipped });
    runExportJob(exportJob, job).catch((error) => {
      exportJob.status = 'failed';
      exportJob.error = error.message;
      exportJob.finishedAt = new Date().toISOString();
    });

    res.status(202).json(serializeExport(exportJob));
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/export/:id', (req, res) => {
  const job = getExportJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: '导出任务不存在' });
    return;
  }
  res.json(serializeExport(job));
});

apiRouter.post('/export/:id/cancel', (req, res) => {
  const job = getExportJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: '导出任务不存在' });
    return;
  }
  if (job.status === 'running' || job.status === 'queued') {
    cancelExportJob(job);
  }
  res.json(serializeExport(job));
});
