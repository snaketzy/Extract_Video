import type {
  AppConfig,
  BatchJob,
  HealthPayload,
  MediaInfo,
  SubtitleFormat,
  TrackKind,
} from '@/lib/types';

const API_BASE = '/api';

function errorMessageFrom(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === 'string' && value) return value;
  }
  return fallback;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = new Error(errorMessageFrom(payload, `请求失败（HTTP ${response.status}）`)) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  return payload as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return parseResponse<T>(response);
}

export const api = {
  health: () => request<HealthPayload>('/health'),

  config: () => request<AppConfig>('/config'),

  getMedia: (mediaId: string) => request<MediaInfo>(`/media/${mediaId}`),

  deleteMedia: (mediaId: string) => request<{ ok: boolean }>(`/media/${mediaId}`, { method: 'DELETE' }),

  pickDirectory: (mediaId: string) =>
    request<{ path?: string; cancelled?: boolean }>(`/media/${mediaId}/pick-directory`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** 单个文件的批次导出请求项 */
  startBatchExport: (outputRoot: string, items: BatchExportItem[]) =>
    request<BatchJob>('/batch/export', {
      method: 'POST',
      body: JSON.stringify({ outputRoot, items }),
    }),

  getBatch: (batchId: string) => request<BatchJob>(`/batch/${batchId}`),

  cancelBatch: (batchId: string) =>
    request<BatchJob>(`/batch/${batchId}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
};

export interface BatchExportItem {
  mediaId: string;
  streams: Record<TrackKind, number[]>;
  defaultAudio: number | null;
  subtitleFormat: SubtitleFormat;
}

/** 上传源文件：请求体为文件二进制，进度通过 XHR 上报 */
export function uploadMedia(
  file: File,
  onProgress: (percent: number) => void
): { promise: Promise<MediaInfo>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<MediaInfo>((resolve, reject) => {
    xhr.open('POST', `${API_BASE}/media`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        resolve(payload as MediaInfo);
        return;
      }
      reject(new Error(errorMessageFrom(payload, `上传失败（HTTP ${xhr.status}）`)));
    };

    xhr.onerror = () => reject(new Error('上传失败：无法连接后端服务'));
    xhr.onabort = () => reject(new Error('上传已取消'));

    xhr.send(file);
  });

  return { promise, abort: () => xhr.abort() };
}
