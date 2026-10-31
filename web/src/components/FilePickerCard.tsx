import { useRef, useState, type DragEvent } from 'react';
import { FileVideo, Loader2, Trash2, TriangleAlert, Upload, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  activeKeyChanged,
  clearItems,
  removeItem,
  selectionErrorChanged,
  uploadSources,
  type MediaItemState,
} from '@/store/mediaSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

const ACCEPT =
  'video/*,.mkv,.mp4,.mov,.m4v,.ts,.m2ts,.mts,.webm,.avi,.flv,.wmv,.mpg,.mpeg,.vob,.rmvb,.3gp';

const DEFAULT_MAX_BATCH_FILES = 10;

function ItemStatus({ item }: { item: MediaItemState }) {
  if (item.uploadStatus === 'error') {
    return <Badge variant="destructive">失败</Badge>;
  }
  if (item.uploadStatus === 'ready') {
    return <Badge variant="success">已解析</Badge>;
  }
  return (
    <Badge variant="secondary">
      <Loader2 className="animate-spin" />
      {item.uploadStatus === 'parsing' ? '解析中' : '上传中'}
    </Badge>
  );
}

export function FilePickerCard() {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { items, activeKey, selectionError, config } = useAppSelector((state) => state.media);

  const maxFiles = config?.maxBatchFiles ?? DEFAULT_MAX_BATCH_FILES;
  const busy = items.some(
    (item) => item.uploadStatus === 'uploading' || item.uploadStatus === 'parsing'
  );
  const full = items.length >= maxFiles;

  const handleFiles = (fileList: FileList | null | undefined) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const remaining = maxFiles - items.length;
    if (files.length > remaining) {
      dispatch(
        selectionErrorChanged(
          `每批次最多处理 ${maxFiles} 个文件，当前已有 ${items.length} 个，还可添加 ${Math.max(remaining, 0)} 个`
        )
      );
      return;
    }
    dispatch(selectionErrorChanged(null));
    void dispatch(uploadSources(files));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy || full) return;
    handleFiles(event.dataTransfer.files);
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. 选择本地视频文件</CardTitle>
        <CardDescription>
          支持一次选择或拖入多个文件，每批最多 {maxFiles} 个。由后端 FFmpeg 逐个解析容器信息，列出视频、音频与字幕轨道的参数
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!busy && !full) openPicker();
          }}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && !busy && !full) openPicker();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy && !full) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            busy || full
              ? 'cursor-not-allowed opacity-60'
              : 'cursor-pointer',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
          )}
        >
          <div className="flex size-11 items-center justify-center rounded-full bg-muted">
            <Upload className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {full ? `已达到每批上限（${maxFiles} 个文件）` : '点击选择文件，或拖拽多个视频文件到此处'}
            </p>
            <p className="text-muted-foreground text-xs">
              支持 MP4 / MKV / MOV / TS / M2TS / WebM / AVI / FLV 等 FFmpeg 可解析的容器
            </p>
          </div>
        </div>

        {selectionError && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{selectionError}</AlertDescription>
          </Alert>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                已选择 {items.length} / {maxFiles} 个文件
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy}
                onClick={() => void dispatch(clearItems())}
              >
                <Trash2 />
                清空全部
              </Button>
            </div>

            <div className="divide-y rounded-lg border">
              {items.map((item) => {
                const active = item.key === activeKey;
                return (
                  <div
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => dispatch(activeKeyChanged(item.key))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') dispatch(activeKeyChanged(item.key));
                    }}
                    className={cn(
                      'cursor-pointer space-y-2 px-4 py-3 transition-colors',
                      active ? 'bg-primary/5' : 'hover:bg-muted/40'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <FileVideo
                        className={cn('size-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.sourceFile?.name ?? '未知文件'}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatBytes(item.sourceFile?.size ?? null)}
                          {item.media?.format.longName ? ` · ${item.media.format.longName}` : ''}
                        </p>
                      </div>
                      {item.media && (
                        <div className="hidden flex-wrap items-center gap-2 sm:flex">
                          <Badge variant="secondary">视频 {item.media.counts.video}</Badge>
                          <Badge variant="secondary">音频 {item.media.counts.audio}</Badge>
                          <Badge variant="secondary">字幕 {item.media.counts.subtitle}</Badge>
                        </div>
                      )}
                      <ItemStatus item={item} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          void dispatch(removeItem(item.key));
                        }}
                        aria-label={`移除 ${item.sourceFile?.name ?? ''}`}
                      >
                        <X />
                      </Button>
                    </div>

                    {(item.uploadStatus === 'uploading' || item.uploadStatus === 'parsing') && (
                      <div className="space-y-1 pl-8">
                        <Progress value={item.uploadStatus === 'parsing' ? 100 : item.uploadProgress} />
                        <p className="text-muted-foreground text-xs">
                          {item.uploadStatus === 'uploading'
                            ? `正在上传到本地后端… ${item.uploadProgress}%`
                            : '上传完成，正在解析轨道信息…'}
                        </p>
                      </div>
                    )}

                    {item.uploadStatus === 'error' && item.uploadError && (
                      <p className="text-destructive pl-8 text-xs">{item.uploadError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
