import { Router } from 'express';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DEFAULT_OUTPUT_DIR,
  FOLDER_PICKER_ENABLED,
  MAX_BATCH_FILES,
  MAX_UPLOAD_BYTES,
  UPLOAD_ROOT,
} from '../config.js';
import { describeBinaries } from '../lib/binaries.js';
import { probeMedia } from '../lib/probe.js';
import { buildPlan, normalizeSubtitleFormat } from '../lib/export.js';
import { cancelBatchJob, runBatchJob } from '../lib/batch.js';
import { baseNameOf, uniqueFileName } from '../lib/trackName.js';
import {
  createBatchJob,
  createMediaJob,
  dropMediaJob,
  getBatchJob,
  getMediaJob,
  serializeBatch,
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
    maxBatchFiles: MAX_BATCH_FILES,
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

/**
 * 创建批次导出任务
 * body: { outputRoot, items: [{ mediaId, streams, defaultAudio, subtitleFormat }] }
 * 每个文件输出到 <outputRoot>/<源文件基名>/ 下的独立目录
 */
apiRouter.post('/batch/export', async (req, res, next) => {
  try {
    const outputRoot = String(req.body?.outputRoot || '').trim();
    if (!outputRoot) {
      res.status(400).json({ error: '请先选择导出目录' });
      return;
    }
    if (!path.isAbsolute(outputRoot)) {
      res.status(400).json({ error: '导出目录必须是绝对路径' });
      return;
    }

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      res.status(400).json({ error: '请先选择要导出的文件' });
      return;
    }
    if (rawItems.length > MAX_BATCH_FILES) {
      res.status(400).json({ error: `每批最多处理 ${MAX_BATCH_FILES} 个文件，当前 ${rawItems.length} 个` });
      return;
    }

    // 同批出现同名基名时，后一个目录追加 -2
    const usedDirNames = new Set();
    const entries = [];

    for (const raw of rawItems) {
      const job = getMediaJob(String(raw?.mediaId || ''));
      if (!job) {
        res.status(404).json({ error: '有文件的临时任务已过期，请重新选择后再导出' });
        return;
      }

      const streams = raw?.streams || {};
      const selection = {
        video: toStreamIndexes(streams.video),
        audio: toStreamIndexes(streams.audio),
        subtitle: toStreamIndexes(streams.subtitle),
      };

      const audioTracks = job.mediaInfo.tracks.audio;
      // 注意：Number(null) === 0，未指定默认音轨时必须显式当作「未选择」
      const rawDefaultAudio = raw?.defaultAudio;
      const parsedDefaultAudio =
        rawDefaultAudio === null || rawDefaultAudio === undefined || rawDefaultAudio === ''
          ? NaN
          : Number(rawDefaultAudio);
      const defaultAudio =
        Number.isInteger(parsedDefaultAudio) && parsedDefaultAudio >= 0 ? parsedDefaultAudio : null;

      // 导出视频时必须指定默认音轨，用于封装进 MP4
      if (selection.video.length > 0 && audioTracks.length > 0) {
        if (defaultAudio === null) {
          res.status(400).json({ error: `${job.originalName}：请先为视频选择默认音轨` });
          return;
        }
        if (!audioTracks.some((track) => track.streamIndex === defaultAudio)) {
          res.status(400).json({ error: `${job.originalName}：默认音轨不存在，请重新选择` });
          return;
        }
      }
      selection.defaultAudio = defaultAudio;
      // 字幕导出格式：srt / webvtt，缺省为 webvtt
      selection.subtitleFormat = normalizeSubtitleFormat(raw?.subtitleFormat);

      const dirName = uniqueFileName(baseNameOf(job.originalName), usedDirNames);
      const outputDir = path.join(outputRoot, dirName);

      const { items, skipped } = buildPlan(job.mediaInfo, outputDir, selection);
      if (items.length === 0) {
        res.status(400).json({ error: `${job.originalName}：未选中任何可导出的轨道`, skipped });
        return;
      }

      entries.push({ media: job, outputDir, items, skipped });
    }

    const batchJob = createBatchJob({ outputRoot, entries });
    runBatchJob(batchJob).catch((error) => {
      batchJob.status = 'failed';
      batchJob.error = error.message;
      batchJob.finishedAt = new Date().toISOString();
    });

    res.status(202).json(serializeBatch(batchJob));
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/batch/:id', (req, res) => {
  const job = getBatchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: '批次任务不存在' });
    return;
  }
  res.json(serializeBatch(job));
});

apiRouter.post('/batch/:id/cancel', (req, res) => {
  const job = getBatchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: '批次任务不存在' });
    return;
  }
  if (job.status === 'queued' || job.status === 'running') {
    cancelBatchJob(job);
  }
  res.json(serializeBatch(job));
});
