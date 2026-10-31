import { useEffect } from 'react';
import { Film, Loader2, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ExportCard } from '@/components/ExportCard';
import { FilePickerCard } from '@/components/FilePickerCard';
import { MediaSummaryCard } from '@/components/MediaSummaryCard';
import { TrackTables } from '@/components/TrackTables';
import { bootstrap } from '@/store/mediaSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

function BinaryStatus() {
  const { bootstrapStatus, health } = useAppSelector((state) => state.media);

  if (bootstrapStatus === 'loading' || bootstrapStatus === 'idle') {
    return (
      <Badge variant="outline">
        <Loader2 className="animate-spin" />
        检测 FFmpeg
      </Badge>
    );
  }

  if (!health?.ok) {
    return (
      <Badge variant="destructive">
        <TriangleAlert />
        未检测到 FFmpeg / FFprobe
      </Badge>
    );
  }

  const ffmpeg = health.binaries.ffmpeg;
  return (
    <Badge variant="secondary" title={ffmpeg.path ?? undefined}>
      FFmpeg {ffmpeg.version}
      <span className="opacity-60">{ffmpeg.source === 'bundled' ? '（内置）' : '（系统）'}</span>
    </Badge>
  );
}

export default function App() {
  const dispatch = useAppDispatch();
  const { bootstrapStatus, bootstrapError, health } = useAppSelector((state) => state.media);
  const readyCount = useAppSelector(
    (state) => state.media.items.filter((item) => item.media).length
  );

  useEffect(() => {
    void dispatch(bootstrap());
  }, [dispatch]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-background sticky top-0 z-10 border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
              <Film className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold">视频轨道分离工具</h1>
              <p className="text-muted-foreground text-xs">
                本地 FFmpeg 解析容器信息，批量按轨道导出 MP4 / MP3 / 字幕
              </p>
            </div>
          </div>
          <BinaryStatus />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        {bootstrapStatus === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>
              {bootstrapError || '无法连接后端服务'}；请确认后端已启动（npm run dev / npm start）。
            </AlertDescription>
          </Alert>
        )}

        {bootstrapStatus === 'ready' && health && !health.ok && (
          <Alert variant="destructive">
            <AlertDescription>
              后端未找到 FFmpeg/FFprobe：{health.binaries.ffmpeg.message || health.binaries.ffprobe.message}
              。可执行 <span className="font-mono">brew install ffmpeg</span>，或在 server 目录执行{' '}
              <span className="font-mono">npm install</span> 以启用内置二进制。
            </AlertDescription>
          </Alert>
        )}

        <FilePickerCard />
        {readyCount > 0 && <MediaSummaryCard />}
        {readyCount > 0 && <TrackTables />}
        {readyCount > 0 && <ExportCard />}
      </main>
    </div>
  );
}
