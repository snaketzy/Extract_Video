import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { HOST, JOB_TTL_MS, PORT, WEB_DIST } from './config.js';
import { apiRouter } from './routes/api.js';
import { describeBinaries } from './lib/binaries.js';
import { ensureUploadRoot, sweepExpired, sweepOrphanUploadDirs } from './lib/jobs.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRouter);

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: '资源不存在' });
});

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  const status = error.status || (error.name === 'PayloadTooLargeError' ? 413 : 500);
  if (status >= 500) {
    console.error('[api]', error);
  }
  res.status(status).json({ error: error.message || '服务端内部错误' });
});

const CLEANUP_INTERVAL_MS = Math.min(JOB_TTL_MS, 30 * 60 * 1000);

await ensureUploadRoot().catch((error) => {
  console.error('无法创建上传目录：', error.message);
});

// 服务重启后内存中的任务记录会丢失，启动时清掉遗留的上传目录
await sweepOrphanUploadDirs().catch((error) => console.error('[cleanup]', error.message));

setInterval(() => {
  sweepExpired().catch((error) => console.error('[cleanup]', error.message));
}, CLEANUP_INTERVAL_MS).unref();

const binaries = await describeBinaries();
if (!binaries.ffmpeg.available || !binaries.ffprobe.available) {
  console.warn('[警告] 未能就绪 FFmpeg/FFprobe：', binaries.ffmpeg.message || binaries.ffprobe.message);
} else {
  console.log(
    `[ffmpeg] ${binaries.ffmpeg.source} 版本 ${binaries.ffmpeg.version} → ${binaries.ffmpeg.path}`
  );
  console.log(`[ffprobe] ${binaries.ffprobe.source} 版本 ${binaries.ffprobe.version}`);
}

app.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST}:${PORT}`);
  if (!existsSync(WEB_DIST)) {
    console.log('[server] 尚未构建前端，开发时请运行：npm run dev');
  }
});
