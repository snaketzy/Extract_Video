import { useRef, useState, type DragEvent } from 'react';
import { FileVideo, Loader2, Upload, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { releaseSource, uploadSource } from '@/store/mediaSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

const ACCEPT =
  'video/*,.mkv,.mp4,.mov,.m4v,.ts,.m2ts,.mts,.webm,.avi,.flv,.wmv,.mpg,.mpeg,.vob,.rmvb,.3gp';

export function FilePickerCard() {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { sourceFile, uploadStatus, uploadProgress, uploadError, media } = useAppSelector(
    (state) => state.media
  );

  const busy = uploadStatus === 'uploading' || uploadStatus === 'parsing';

  const handleFile = (file: File | undefined) => {
    if (!file || busy) return;
    // 换文件时顺手清理上一个上传到服务端的临时文件
    if (media) {
      void api.deleteMedia(media.id).catch(() => undefined);
    }
    void dispatch(uploadSource(file));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. 选择本地视频文件</CardTitle>
        <CardDescription>
          选择后由后端 FFmpeg 解析容器信息，列出视频轨道、音频轨道与字幕轨道的参数
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            handleFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        {!busy && (
          <div
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') openPicker();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
            )}
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Upload className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">点击选择文件，或拖拽视频文件到此处</p>
              <p className="text-muted-foreground text-xs">
                支持 MP4 / MKV / MOV / TS / M2TS / WebM / AVI / FLV 等 FFmpeg 可解析的容器
              </p>
            </div>
          </div>
        )}

        {busy && sourceFile && (
          <div className="space-y-3 rounded-xl border px-4 py-4">
            <div className="flex items-center gap-3">
              <FileVideo className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{sourceFile.name}</p>
                <p className="text-muted-foreground text-xs">{formatBytes(sourceFile.size)}</p>
              </div>
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            </div>
            <Progress value={uploadStatus === 'parsing' ? 100 : uploadProgress} />
            <p className="text-muted-foreground text-xs">
              {uploadStatus === 'uploading'
                ? `正在上传到本地后端… ${uploadProgress}%`
                : '上传完成，正在解析轨道信息…'}
            </p>
          </div>
        )}

        {uploadStatus === 'ready' && media && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
            <FileVideo className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{media.file.name}</p>
              <p className="text-muted-foreground text-xs">
                {formatBytes(media.file.sizeBytes)}
                {media.format.longName ? ` · ${media.format.longName}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">视频 {media.counts.video}</Badge>
              <Badge variant="secondary">音频 {media.counts.audio}</Badge>
              <Badge variant="secondary">字幕 {media.counts.subtitle}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={openPicker}>
                更换文件
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void dispatch(releaseSource())}
                className="text-muted-foreground"
              >
                <X />
                移除
              </Button>
            </div>
          </div>
        )}

        {uploadStatus === 'error' && uploadError && (
          <Alert variant="destructive">
            <AlertDescription>{uploadError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
