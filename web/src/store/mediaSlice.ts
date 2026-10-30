import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { api, uploadMedia } from '@/lib/api';
import type { AppConfig, ExportJob, HealthPayload, MediaInfo, SubtitleFormat, TrackKind } from '@/lib/types';
import type { RootState } from '@/store';

export interface MediaState {
  bootstrapStatus: 'idle' | 'loading' | 'ready' | 'error';
  health: HealthPayload | null;
  config: AppConfig | null;
  bootstrapError: string | null;

  sourceFile: { name: string; size: number } | null;
  uploadStatus: 'idle' | 'uploading' | 'parsing' | 'ready' | 'error';
  uploadProgress: number;
  uploadError: string | null;

  media: MediaInfo | null;
  selected: Record<TrackKind, number[]>;
  /** 并入视频的默认音轨（streamIndex），仅在导出视频时生效 */
  defaultAudio: number | null;
  /** 字幕导出格式，全部字幕轨共用一个单选 */
  subtitleFormat: SubtitleFormat;

  outputDir: string;
  pickerStatus: 'idle' | 'opening' | 'unsupported' | 'error';
  pickerError: string | null;

  exportJob: ExportJob | null;
  exportStarting: boolean;
  exportError: string | null;
}

const initialState: MediaState = {
  bootstrapStatus: 'idle',
  health: null,
  config: null,
  bootstrapError: null,

  sourceFile: null,
  uploadStatus: 'idle',
  uploadProgress: 0,
  uploadError: null,

  media: null,
  selected: { video: [], audio: [], subtitle: [] },
  defaultAudio: null,
  subtitleFormat: 'webvtt',

  outputDir: '',
  pickerStatus: 'idle',
  pickerError: null,

  exportJob: null,
  exportStarting: false,
  exportError: null,
};

function allStreamIndexes(media: MediaInfo): Record<TrackKind, number[]> {
  return {
    video: media.tracks.video.map((track) => track.streamIndex),
    audio: media.tracks.audio.map((track) => track.streamIndex),
    subtitle: media.tracks.subtitle
      .filter((track) => track.convertibleToSrt || track.convertibleToWebVtt)
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
  };
}

export const bootstrap = createAsyncThunk('media/bootstrap', async () => {
  const [health, config] = await Promise.all([api.health(), api.config()]);
  return { health, config };
});

export const uploadSource = createAsyncThunk<MediaInfo, File, { state: RootState; rejectValue: string }>(
  'media/uploadSource',
  async (file, { dispatch, rejectWithValue }) => {
    try {
      const { promise } = uploadMedia(file, (percent) => dispatch(uploadProgressChanged(percent)));
      return await promise;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '上传失败');
    }
  }
);

export const pickOutputDirectory = createAsyncThunk<
  { path?: string; cancelled?: boolean },
  void,
  { state: RootState; rejectValue: { message: string; unsupported: boolean } }
>('media/pickOutputDirectory', async (_arg, { getState, rejectWithValue }) => {
  const mediaId = getState().media.media?.id;
  if (!mediaId) {
    return rejectWithValue({ message: '请先选择视频文件', unsupported: false });
  }
  try {
    return await api.pickDirectory(mediaId);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    return rejectWithValue({
      message: error instanceof Error ? error.message : '打开目录选择框失败',
      unsupported: status === 501,
    });
  }
});

export const startExport = createAsyncThunk<ExportJob, void, { state: RootState; rejectValue: string }>(
  'media/startExport',
  async (_arg, { getState, rejectWithValue }) => {
    const { media, selected, outputDir, defaultAudio, subtitleFormat } = getState().media;
    if (!media) return rejectWithValue('请先选择视频文件');
    if (!outputDir.trim()) return rejectWithValue('请先选择导出目录');

    const plan = buildExportSelection(media, selected, defaultAudio, subtitleFormat);
    if (plan.requiresDefaultAudio && plan.defaultAudio === null) {
      return rejectWithValue('请先为视频选择默认音轨');
    }

    try {
      return await api.startExport(
        media.id,
        outputDir.trim(),
        { video: plan.video, audio: plan.audio, subtitle: plan.subtitle },
        plan.defaultAudio,
        plan.subtitleFormat
      );
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '导出失败');
    }
  }
);

export const refreshExport = createAsyncThunk<ExportJob, string, { rejectValue: string }>(
  'media/refreshExport',
  async (exportId, { rejectWithValue }) => {
    try {
      return await api.getExport(exportId);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '获取导出进度失败');
    }
  }
);

export const cancelExport = createAsyncThunk<ExportJob, string, { rejectValue: string }>(
  'media/cancelExport',
  async (exportId, { rejectWithValue }) => {
    try {
      return await api.cancelExport(exportId);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '取消导出失败');
    }
  }
);

export const releaseSource = createAsyncThunk<void, void, { state: RootState }>(
  'media/releaseSource',
  async (_arg, { getState }) => {
    const mediaId = getState().media.media?.id;
    if (mediaId) {
      await api.deleteMedia(mediaId).catch(() => undefined);
    }
  }
);

const mediaSlice = createSlice({
  name: 'media',
  initialState,
  reducers: {
    uploadProgressChanged(state, action: PayloadAction<number>) {
      state.uploadProgress = action.payload;
      if (state.uploadStatus === 'uploading' && action.payload >= 100) {
        state.uploadStatus = 'parsing';
      }
    },
    toggleTrack(state, action: PayloadAction<{ kind: TrackKind; streamIndex: number }>) {
      const { kind, streamIndex } = action.payload;
      const list = state.selected[kind];
      state.selected[kind] = list.includes(streamIndex)
        ? list.filter((item) => item !== streamIndex)
        : [...list, streamIndex];
    },
    setKindSelection(state, action: PayloadAction<{ kind: TrackKind; streamIndexes: number[] }>) {
      state.selected[action.payload.kind] = action.payload.streamIndexes;
    },
    defaultAudioChanged(state, action: PayloadAction<number | null>) {
      state.defaultAudio = action.payload;
    },
    subtitleFormatChanged(state, action: PayloadAction<SubtitleFormat>) {
      state.subtitleFormat = action.payload;
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
        if (!state.outputDir) state.outputDir = '';
      })
      .addCase(bootstrap.rejected, (state, action) => {
        state.bootstrapStatus = 'error';
        state.bootstrapError = action.error.message || '初始化失败';
      })

      .addCase(uploadSource.pending, (state, action) => {
        state.uploadStatus = 'uploading';
        state.uploadProgress = 0;
        state.uploadError = null;
        state.sourceFile = { name: action.meta.arg.name, size: action.meta.arg.size };
        state.media = null;
        state.selected = { video: [], audio: [], subtitle: [] };
        state.defaultAudio = null;
        state.subtitleFormat = 'webvtt';
        state.exportJob = null;
        state.exportError = null;
      })
      .addCase(uploadSource.fulfilled, (state, action) => {
        state.uploadStatus = 'ready';
        state.uploadProgress = 100;
        state.media = action.payload;
        state.selected = allStreamIndexes(action.payload);
        state.defaultAudio = null;
        state.subtitleFormat = 'webvtt';
      })
      .addCase(uploadSource.rejected, (state, action) => {
        state.uploadStatus = 'error';
        state.uploadError = action.payload || action.error.message || '上传失败';
        state.uploadProgress = 0;
        state.media = null;
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

      .addCase(startExport.pending, (state) => {
        state.exportStarting = true;
        state.exportError = null;
      })
      .addCase(startExport.fulfilled, (state, action) => {
        state.exportStarting = false;
        state.exportJob = action.payload;
      })
      .addCase(startExport.rejected, (state, action) => {
        state.exportStarting = false;
        state.exportError = action.payload || action.error.message || '导出失败';
      })

      .addCase(refreshExport.fulfilled, (state, action) => {
        if (state.exportJob?.id === action.payload.id) state.exportJob = action.payload;
      })

      .addCase(cancelExport.fulfilled, (state, action) => {
        if (state.exportJob?.id === action.payload.id) state.exportJob = action.payload;
      })

      .addCase(releaseSource.fulfilled, (state) => {
        state.sourceFile = null;
        state.uploadStatus = 'idle';
        state.uploadProgress = 0;
        state.uploadError = null;
        state.media = null;
        state.selected = { video: [], audio: [], subtitle: [] };
        state.defaultAudio = null;
        state.subtitleFormat = 'webvtt';
        state.exportJob = null;
      });
  },
});

export const {
  uploadProgressChanged,
  toggleTrack,
  setKindSelection,
  defaultAudioChanged,
  subtitleFormatChanged,
  outputDirChanged,
  pickerErrorCleared,
  exportErrorCleared,
} = mediaSlice.actions;

export default mediaSlice.reducer;
