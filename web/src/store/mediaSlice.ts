import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { api, uploadMedia, type BatchExportItem } from '@/lib/api';
import type {
  AppConfig,
  BatchJob,
  HealthPayload,
  MediaInfo,
  SubtitleFormat,
  TrackKind,
} from '@/lib/types';
import type { RootState } from '@/store';

export interface MediaItemState {
  /** 前端列表 key，与后端 mediaId 解耦 */
  key: string;
  sourceFile: { name: string; size: number } | null;
  uploadStatus: 'idle' | 'uploading' | 'parsing' | 'ready' | 'error';
  uploadProgress: number;
  uploadError: string | null;

  media: MediaInfo | null;
  selected: Record<TrackKind, number[]>;
  /** 并入视频的默认音轨（streamIndex），仅在导出视频时生效 */
  defaultAudio: number | null;
  /** 字幕导出格式，按文件独立设置 */
  subtitleFormat: SubtitleFormat;
}

export interface MediaState {
  bootstrapStatus: 'idle' | 'loading' | 'ready' | 'error';
  health: HealthPayload | null;
  config: AppConfig | null;
  bootstrapError: string | null;

  /** 待处理的文件列表（即一个导出批次） */
  items: MediaItemState[];
  activeKey: string | null;
  /** 添加文件被拒绝时的提示（例如超过每批上限） */
  selectionError: string | null;

  outputDir: string;
  pickerStatus: 'idle' | 'opening' | 'unsupported' | 'error';
  pickerError: string | null;

  batchJob: BatchJob | null;
  exportStarting: boolean;
  exportError: string | null;
}

const initialState: MediaState = {
  bootstrapStatus: 'idle',
  health: null,
  config: null,
  bootstrapError: null,

  items: [],
  activeKey: null,
  selectionError: null,

  outputDir: '',
  pickerStatus: 'idle',
  pickerError: null,

  batchJob: null,
  exportStarting: false,
  exportError: null,
};

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function allStreamIndexes(media: MediaInfo): Record<TrackKind, number[]> {
  return {
    video: media.tracks.video.map((track) => track.streamIndex),
    audio: media.tracks.audio.map((track) => track.streamIndex),
    subtitle: media.tracks.subtitle
      .filter((track) => track.convertibleToSrt || track.convertibleToWebVtt || track.convertibleToSup)
      .map((track) => track.streamIndex),
  };
}

/** 该文件是否有字幕轨可用指定格式导出 */
export function subtitleFormatAvailable(tracks: MediaInfo['tracks']['subtitle'], format: SubtitleFormat): boolean {
  return tracks.some((track) =>
    format === 'webvtt' ? track.convertibleToWebVtt : track.convertibleToSrt
  );
}

/**
 * 计算真正下发给后端的导出选择
 * 导出视频时默认音轨会并入 MP4，因此不再单独导出为 mp3
 */
export function buildExportSelection(
  media: MediaInfo,
  selected: Record<TrackKind, number[]>,
  defaultAudio: number | null,
  subtitleFormat: SubtitleFormat
) {
  const requiresDefaultAudio = selected.video.length > 0 && media.tracks.audio.length > 0;
  return {
    requiresDefaultAudio,
    defaultAudio: requiresDefaultAudio ? defaultAudio : null,
    subtitleFormat,
    video: selected.video,
    audio: requiresDefaultAudio ? selected.audio.filter((index) => index !== defaultAudio) : selected.audio,
    subtitle: selected.subtitle,
    total: selected.video.length + selected.audio.length + selected.subtitle.length,
  };
}

/** 当前正在编辑的文件条目 */
export function selectActiveItem(state: RootState): MediaItemState | null {
  const { items, activeKey } = state.media;
  if (!activeKey) return null;
  return items.find((item) => item.key === activeKey) ?? null;
}

/** 已解析完成、可参与导出的文件条目 */
export function selectReadyItems(state: RootState): MediaItemState[] {
  return state.media.items.filter((item) => item.media);
}

export const bootstrap = createAsyncThunk('media/bootstrap', async () => {
  const [health, config] = await Promise.all([api.health(), api.config()]);
  return { health, config };
});

/** 串行上传多个文件，进度与结果逐个回写到对应条目 */
export const uploadSources = createAsyncThunk<void, File[], { state: RootState }>(
  'media/uploadSources',
  async (files, { dispatch }) => {
    const queued = files.map((file) => ({ key: newKey(), name: file.name, size: file.size }));
    dispatch(itemsQueued(queued));

    for (let index = 0; index < files.length; index += 1) {
      const { key } = queued[index];
      const file = files[index];
      try {
        const { promise } = uploadMedia(file, (percent) =>
          dispatch(itemProgressChanged({ key, progress: percent }))
        );
        const media = await promise;
        dispatch(itemUploaded({ key, media }));
      } catch (error) {
        dispatch(
          itemUploadFailed({ key, message: error instanceof Error ? error.message : '上传失败' })
        );
      }
    }
  }
);

export const removeItem = createAsyncThunk<void, string, { state: RootState }>(
  'media/removeItem',
  async (key, { getState, dispatch }) => {
    const item = getState().media.items.find((entry) => entry.key === key);
    if (item?.media) {
      await api.deleteMedia(item.media.id).catch(() => undefined);
    }
    dispatch(itemRemoved(key));
  }
);

export const clearItems = createAsyncThunk<void, void, { state: RootState }>(
  'media/clearItems',
  async (_arg, { getState, dispatch }) => {
    const { items } = getState().media;
    await Promise.all(
      items
        .filter((item) => item.media)
        .map((item) => api.deleteMedia(item.media!.id).catch(() => undefined))
    );
    dispatch(itemsCleared());
  }
);

export const pickOutputDirectory = createAsyncThunk<
  { path?: string; cancelled?: boolean },
  void,
  { state: RootState; rejectValue: { message: string; unsupported: boolean } }
>('media/pickOutputDirectory', async (_arg, { getState, rejectWithValue }) => {
  const anchor = getState().media.items.find((item) => item.media);
  if (!anchor?.media) {
    return rejectWithValue({ message: '请先选择视频文件', unsupported: false });
  }
  try {
    return await api.pickDirectory(anchor.media.id);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    return rejectWithValue({
      message: error instanceof Error ? error.message : '打开目录选择框失败',
      unsupported: status === 501,
    });
  }
});

export const startBatchExport = createAsyncThunk<BatchJob, void, { state: RootState; rejectValue: string }>(
  'media/startBatchExport',
  async (_arg, { getState, rejectWithValue }) => {
    const { items, outputDir } = getState().media;
    const ready = items.filter((item) => item.media);
    if (ready.length === 0) return rejectWithValue('请先选择视频文件');
    if (!outputDir.trim()) return rejectWithValue('请先选择导出目录');

    const payload: BatchExportItem[] = [];
    for (const item of ready) {
      const media = item.media;
      if (!media) continue;
      const plan = buildExportSelection(media, item.selected, item.defaultAudio, item.subtitleFormat);
      if (plan.requiresDefaultAudio && plan.defaultAudio === null) {
        return rejectWithValue(`${media.file.name}：请先为视频选择默认音轨`);
      }
      if (plan.total === 0) {
        return rejectWithValue(`${media.file.name}：请至少勾选一条轨道`);
      }
      payload.push({
        mediaId: media.id,
        streams: { video: plan.video, audio: plan.audio, subtitle: plan.subtitle },
        defaultAudio: plan.defaultAudio,
        subtitleFormat: plan.subtitleFormat,
      });
    }

    try {
      return await api.startBatchExport(outputDir.trim(), payload);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '导出失败');
    }
  }
);

export const refreshBatch = createAsyncThunk<BatchJob, string, { rejectValue: string }>(
  'media/refreshBatch',
  async (batchId, { rejectWithValue }) => {
    try {
      return await api.getBatch(batchId);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '获取导出进度失败');
    }
  }
);

export const cancelBatch = createAsyncThunk<BatchJob, string, { rejectValue: string }>(
  'media/cancelBatch',
  async (batchId, { rejectWithValue }) => {
    try {
      return await api.cancelBatch(batchId);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '取消导出失败');
    }
  }
);

const mediaSlice = createSlice({
  name: 'media',
  initialState,
  reducers: {
    itemsQueued(state, action: PayloadAction<{ key: string; name: string; size: number }[]>) {
      for (const entry of action.payload) {
        state.items.push({
          key: entry.key,
          sourceFile: { name: entry.name, size: entry.size },
          uploadStatus: 'uploading',
          uploadProgress: 0,
          uploadError: null,
          media: null,
          selected: { video: [], audio: [], subtitle: [] },
          defaultAudio: null,
          subtitleFormat: 'webvtt',
        });
      }
      if (!state.activeKey && state.items.length > 0) {
        state.activeKey = state.items[0].key;
      }
      state.batchJob = null;
      state.exportError = null;
    },
    itemProgressChanged(state, action: PayloadAction<{ key: string; progress: number }>) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      item.uploadProgress = action.payload.progress;
      if (item.uploadStatus === 'uploading' && action.payload.progress >= 100) {
        item.uploadStatus = 'parsing';
      }
    },
    itemUploaded(state, action: PayloadAction<{ key: string; media: MediaInfo }>) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      const { media } = action.payload;
      item.media = media;
      item.uploadStatus = 'ready';
      item.uploadProgress = 100;
      item.uploadError = null;
      item.selected = allStreamIndexes(media);
      item.defaultAudio = null;
    },
    itemUploadFailed(state, action: PayloadAction<{ key: string; message: string }>) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      item.uploadStatus = 'error';
      item.uploadError = action.payload.message;
      item.uploadProgress = 0;
      item.media = null;
    },
    itemRemoved(state, action: PayloadAction<string>) {
      const index = state.items.findIndex((entry) => entry.key === action.payload);
      if (index < 0) return;
      state.items.splice(index, 1);
      if (state.activeKey === action.payload) {
        const fallback = state.items[index] ?? state.items[index - 1] ?? null;
        state.activeKey = fallback ? fallback.key : null;
      }
    },
    itemsCleared(state) {
      state.items = [];
      state.activeKey = null;
      state.selectionError = null;
      state.batchJob = null;
      state.exportError = null;
    },
    activeKeyChanged(state, action: PayloadAction<string>) {
      state.activeKey = action.payload;
    },
    selectionErrorChanged(state, action: PayloadAction<string | null>) {
      state.selectionError = action.payload;
    },
    trackToggled(state, action: PayloadAction<{ key: string; kind: TrackKind; streamIndex: number }>) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      const { kind, streamIndex } = action.payload;
      const list = item.selected[kind];
      item.selected[kind] = list.includes(streamIndex)
        ? list.filter((value) => value !== streamIndex)
        : [...list, streamIndex];
    },
    kindSelectionSet(
      state,
      action: PayloadAction<{ key: string; kind: TrackKind; streamIndexes: number[] }>
    ) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      item.selected[action.payload.kind] = action.payload.streamIndexes;
    },
    defaultAudioChanged(state, action: PayloadAction<{ key: string; streamIndex: number | null }>) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      item.defaultAudio = action.payload.streamIndex;
    },
    subtitleFormatChanged(state, action: PayloadAction<{ key: string; format: SubtitleFormat }>) {
      const item = state.items.find((entry) => entry.key === action.payload.key);
      if (!item) return;
      item.subtitleFormat = action.payload.format;
    },
    /** 把某个文件的勾选、默认音轨与字幕格式套用到其余文件（轨道索引会按目标文件的实际轨道过滤） */
    selectionAppliedToAll(state, action: PayloadAction<string>) {
      const source = state.items.find((entry) => entry.key === action.payload && entry.media);
      if (!source || !source.media) return;
      for (const item of state.items) {
        if (item.key === source.key || !item.media) continue;
        const videoIndexes = new Set(item.media.tracks.video.map((track) => track.streamIndex));
        const audioIndexes = new Set(item.media.tracks.audio.map((track) => track.streamIndex));
        const subtitleIndexes = new Set(item.media.tracks.subtitle.map((track) => track.streamIndex));
        item.selected = {
          video: source.selected.video.filter((index) => videoIndexes.has(index)),
          audio: source.selected.audio.filter((index) => audioIndexes.has(index)),
          subtitle: source.selected.subtitle.filter((index) => subtitleIndexes.has(index)),
        };
        item.subtitleFormat = source.subtitleFormat;
        item.defaultAudio =
          source.defaultAudio !== null && audioIndexes.has(source.defaultAudio) ? source.defaultAudio : null;
      }
    },
    outputDirChanged(state, action: PayloadAction<string>) {
      state.outputDir = action.payload;
      state.pickerError = null;
      if (state.pickerStatus === 'error') state.pickerStatus = 'idle';
    },
    pickerErrorCleared(state) {
      state.pickerError = null;
      if (state.pickerStatus === 'error') state.pickerStatus = 'idle';
    },
    exportErrorCleared(state) {
      state.exportError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrap.pending, (state) => {
        state.bootstrapStatus = 'loading';
      })
      .addCase(bootstrap.fulfilled, (state, action) => {
        state.bootstrapStatus = 'ready';
        state.health = action.payload.health;
        state.config = action.payload.config;
        state.bootstrapError = null;
      })
      .addCase(bootstrap.rejected, (state, action) => {
        state.bootstrapStatus = 'error';
        state.bootstrapError = action.error.message || '初始化失败';
      })

      .addCase(pickOutputDirectory.pending, (state) => {
        state.pickerStatus = 'opening';
        state.pickerError = null;
      })
      .addCase(pickOutputDirectory.fulfilled, (state, action) => {
        state.pickerStatus = 'idle';
        if (action.payload.path) state.outputDir = action.payload.path;
      })
      .addCase(pickOutputDirectory.rejected, (state, action) => {
        const payload = action.payload;
        state.pickerStatus = payload?.unsupported ? 'unsupported' : 'error';
        state.pickerError = payload?.message || action.error.message || '打开目录选择框失败';
      })

      .addCase(startBatchExport.pending, (state) => {
        state.exportStarting = true;
        state.exportError = null;
      })
      .addCase(startBatchExport.fulfilled, (state, action) => {
        state.exportStarting = false;
        state.batchJob = action.payload;
      })
      .addCase(startBatchExport.rejected, (state, action) => {
        state.exportStarting = false;
        state.exportError = action.payload || action.error.message || '导出失败';
      })

      .addCase(refreshBatch.fulfilled, (state, action) => {
        if (state.batchJob?.id === action.payload.id) state.batchJob = action.payload;
      })

      .addCase(cancelBatch.fulfilled, (state, action) => {
        if (state.batchJob?.id === action.payload.id) state.batchJob = action.payload;
      });
  },
});

export const {
  itemsQueued,
  itemProgressChanged,
  itemUploaded,
  itemUploadFailed,
  itemRemoved,
  itemsCleared,
  activeKeyChanged,
  selectionErrorChanged,
  trackToggled,
  kindSelectionSet,
  defaultAudioChanged,
  subtitleFormatChanged,
  selectionAppliedToAll,
  outputDirChanged,
  pickerErrorCleared,
  exportErrorCleared,
} = mediaSlice.actions;

export default mediaSlice.reducer;
