import { cancelExportJob, runExportJob } from './export.js';
import { getMediaJob } from './jobs.js';

/**
 * 串行执行批次：一个文件的全部轨道导出完成后，才开始下一个文件
 * 串行可以避免多个 FFmpeg 抢占 CPU，重编码时速度反而更稳定
 */
export async function runBatchJob(batchJob) {
  batchJob.status = 'running';

  for (const entry of batchJob.entries) {
    if (batchJob.cancelled) break;

    const media = getMediaJob(entry.mediaId);
    if (!media) {
      entry.exportJob.status = 'failed';
      entry.exportJob.error = '源文件已过期，请重新选择文件';
      entry.exportJob.finishedAt = new Date().toISOString();
      continue;
    }

    batchJob.currentEntry = entry;
    await runExportJob(entry.exportJob, media);
    batchJob.currentEntry = null;
  }

  batchJob.finishedAt = new Date().toISOString();

  if (batchJob.cancelled) {
    batchJob.status = 'cancelled';
    return batchJob;
  }

  batchJob.status = 'completed';
  return batchJob;
}

/** 中止批次：杀掉当前 FFmpeg，并把还没开始的条目标记为已取消 */
export function cancelBatchJob(batchJob) {
  batchJob.cancelled = true;
  batchJob.status = 'cancelled';
  batchJob.error = '用户已取消批次导出';

  if (batchJob.currentEntry) {
    cancelExportJob(batchJob.currentEntry.exportJob);
  }

  for (const entry of batchJob.entries) {
    if (entry.exportJob.status === 'queued') {
      entry.exportJob.status = 'cancelled';
      entry.exportJob.error = '用户已取消批次导出';
      entry.exportJob.finishedAt = new Date().toISOString();
    }
  }

  return batchJob;
}
