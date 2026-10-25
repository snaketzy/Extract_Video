import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(currentDir, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
export const WEB_DIST = path.join(PROJECT_ROOT, 'web', 'dist');

export const PORT = Number(process.env.PORT || 8080);
export const HOST = process.env.HOST || '127.0.0.1';

/** 上传源文件的存放根目录 */
export const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(SERVER_ROOT, 'data', 'uploads');

/** 单个上传文件体积上限，默认 60GB */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 60 * 1024 * 1024 * 1024);

/** 任务记录（含上传文件）保留时长，默认 6 小时 */
export const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 6 * 60 * 60 * 1000);

/** 导出音频时的目标码率 */
export const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '192k';

/** 是否允许调用系统原生目录选择框（DISABLE_FOLDER_PICKER=1 关闭） */
export const FOLDER_PICKER_ENABLED = process.env.DISABLE_FOLDER_PICKER !== '1';

/** 兜底输出目录：当所选目录不可用时使用 */
export const DEFAULT_OUTPUT_DIR = process.env.DEFAULT_OUTPUT_DIR
  ? path.resolve(process.env.DEFAULT_OUTPUT_DIR)
  : path.join(PROJECT_ROOT, 'output');
