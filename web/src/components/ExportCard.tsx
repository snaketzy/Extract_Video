import { useEffect } from 'react';
import { Check, Download, FolderOpen, Loader2, Subtitles, Video, Music, X } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { formatBytes } from '@/lib/format';
import type { BatchEntry, ExportFileState, TrackKind } from '@/lib/types';
import {
  buildExportSelection,
  cancelBatch,
  outputDirChanged,
  pickOutputDirectory,
  refreshBatch,
  selectReadyItems,
  startBatchExport,
} from '@/store/mediaSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

const KIND_LABELS: Record<TrackKind, string> = {
  video: '视频',
  audio: '音频',
  subtitle: '字幕',
};

function KindIcon({ kind }: { kind: TrackKind }) {
  if (kind === 'video') return <Video className="size-4 text-muted-foreground" />;
  if (kind === 'audio') return <Music className="size-4 text-muted-foreground" />;
  return <Subtitles className="size-4 text-muted-foreground" />;
}

function FileStatusBadge({ file }: { file: ExportFileState }) {
  if (file.status === 'pending') return <Badge variant="outline">等待中</Badge>;
  if (file.status === 'running') {
    return (
      <Badge variant="secondary">
        <Loader2 className="animate-spin" />
        处理中
      </Badge>
    );
  }
  if (file.status === 'done') return <Badge variant="success">已完成</Badge>;
  return <Badge variant="destructive">失败</Badge>;
}

function EntryStatusBadge({ entry }: { entry: BatchEntry }) {
  if (entry.status === 'pending') return <Badge variant="outline">排队中</Badge>;
  if (entry.status === 'running') {
    return (
      <Badge variant="secondary">
        <Loader2 className="animate-spin" />
        处理中
      </Badge>
    );
  }
  if (entry.status === 'done') return <Badge variant="success">已完成</Badge>;
  if (entry.status === 'cancelled') return <Badge variant="outline">已取消</Badge>;
  return <Badge variant="destructive">失败</Badge>;
}

export function ExportCard() {
  const dispatch = useAppDispatch();
  const {
    outputDir,
    pickerStatus,
    pickerError,
    batchJob,
    exportStarting,
    exportError,
    config,
  } = useAppSelector((state) => state.media);
  const readyItems = useAppSelector(selectReadyItems);

  const batchId = batchJob?.id ?? null;
  const isExporting = batchJob?.status === 'queued' || batchJob?.status === 'running';

  useEffect(() => {
    if (!batchId || !isExporting) return undefined;
    const timer = window.setInterval(() => {
      void dispatch(refreshBatch(batchId));
    }, 700);
    return () => window.clearInterval(timer);
  }, [dispatch, batchId, isExporting]);

  if (readyItems.length === 0) return null;

  const plans = readyItems.map((item) => {
    const plan = buildExportSelection(item.media!, item.selected, item.defaultAudio, item.subtitleFormat);
    const missingDefaultAudio = plan.requiresDefaultAudio && plan.defaultAudio === null;
    return {
      key: item.key,
      name: item.media!.file.name,
      plan,
      total: plan.total,
      missingDefaultAudio,
      invalid: missingDefaultAudio || plan.total === 0,
    };
  });

  const totalFiles = plans.reduce((sum, entry) => sum + entry.total, 0);
  const invalidPlans = plans.filter((entry) => entry.invalid);
  const pickerSupported = config?.folderPickerSupported !== false && pickerStatus !== 'unsupported';
  const canExport =
    outputDir.trim().length > 0 && invalidPlans.length === 0 && !isExporting && !exportStarting;

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. 导出到本地目录</CardTitle>
        <CardDescription>
          点击「选择文件夹」将调起系统原生目录对话框；每个文件会在该目录下新建同名子目录并写入结果，不经过浏览器下载
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">输出根目录</p>
          <div className="flex flex-wrap items-center gap-2">
            {pickerSupported && (
              <Button
                variant="outline"
                disabled={pickerStatus === 'opening'}
                onClick={() => void dispatch(pickOutputDirectory())}
              >
                {pickerStatus === 'opening' ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                {pickerStatus === 'opening' ? '等待选择…' : '选择文件夹'}
              </Button>
            )}
            <Input
              value={outputDir}
              onChange={(event) => dispatch(outputDirChanged(event.target.value))}
              placeholder="也可直接粘贴绝对路径，例如 /Users/you/Movies/output"
              className="min-w-[16rem] flex-1 font-mono text-xs"
            />
          </div>
          {!pickerSupported && (
            <p className="text-muted-foreground text-xs">
              当前环境不支持原生目录对话框，请手动填写绝对路径。
            </p>
          )}
          {pickerError && <p className="text-destructive text-xs">{pickerError}</p>}
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              导出内容
              <span className="text-muted-foreground ml-2 text-xs">
                共 {plans.length} 个文件 · {totalFiles} 个输出
              </span>
            </p>
            <Button size="lg" disabled={!canExport} onClick={() => void dispatch(startBatchExport())}>
              {exportStarting || isExporting ? <Loader2 className="animate-spin" /> : <Download />}
              {isExporting ? '导出中…' : batchJob ? '重新导出' : '开始批量导出'}
            </Button>
          </div>

          <div className="divide-y rounded-lg border">
            {plans.map((entry) => (
              <div key={entry.key} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{entry.name}</span>
                  <Badge variant={entry.plan.video.length ? 'secondary' : 'outline'}>
                    视频 {entry.plan.video.length} → mp4
                  </Badge>
                  <Badge variant={entry.plan.audio.length ? 'secondary' : 'outline'}>
                    音频 {entry.plan.audio.length} → mp3
                  </Badge>
                  <Badge variant={entry.plan.subtitle.length ? 'secondary' : 'outline'}>
                    字幕 {entry.plan.subtitle.length}
                  </Badge>
                  {entry.plan.requiresDefaultAudio && (
                    <Badge variant={entry.plan.defaultAudio === null ? 'destructive' : 'secondary'}>
                      默认音轨 {entry.plan.defaultAudio === null ? '未选择' : '→ 并入 mp4'}
                    </Badge>
                  )}
                </div>
                {entry.missingDefaultAudio && (
                  <p className="text-destructive text-xs">请先在「轨道参数」中为该文件选择默认音轨</p>
                )}
                {entry.total === 0 && <p className="text-destructive text-xs">请至少勾选一条轨道</p>}
              </div>
            ))}
          </div>
        </div>

        {exportError && (
          <Alert variant="destructive">
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {isExporting && batchJob && (
            <Button variant="outline" onClick={() => void dispatch(cancelBatch(batchJob.id))}>
              <X />
              取消导出
            </Button>
          )}
          {!outputDir.trim() && <span className="text-muted-foreground text-xs">请先选择导出目录</span>}
          {invalidPlans.length > 0 && (
            <span className="text-destructive text-xs">有 {invalidPlans.length} 个文件尚未配置完成</span>
          )}
        </div>

        {batchJob && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                批次导出进度
                <span className="text-muted-foreground ml-2 text-xs">
                  {batchJob.completed} / {batchJob.total}
                  {batchJob.failed > 0 ? ` · 失败 ${batchJob.failed}` : ''}
                </span>
              </p>
              <Badge
                variant={
                  batchJob.status === 'completed'
                    ? 'success'
                    : batchJob.status === 'failed'
                      ? 'destructive'
                      : batchJob.status === 'cancelled'
                        ? 'outline'
                        : 'secondary'
                }
              >
                {batchJob.status === 'queued' && '排队中'}
                {batchJob.status === 'running' && '导出中'}
                {batchJob.status === 'completed' && '已完成'}
                {batchJob.status === 'failed' && '失败'}
                {batchJob.status === 'cancelled' && '已取消'}
              </Badge>
            </div>

            <Progress value={batchJob.percent} />

            {batchJob.error && (
              <Alert variant="destructive">
                <AlertDescription>{batchJob.error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              {batchJob.entries.map((entry) => (
                <div key={entry.mediaId} className="rounded-lg border">
                  <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
                    <span className="truncate text-sm font-medium">{entry.sourceFileName}</span>
                    <EntryStatusBadge entry={entry} />
                    <span className="text-muted-foreground text-xs">
                      {entry.completed} / {entry.total}
                      {entry.failed > 0 ? ` · 失败 ${entry.failed}` : ''}
                    </span>
                    <span className="text-muted-foreground ml-auto hidden font-mono text-xs sm:inline">
                      {entry.outputDir}
                    </span>
                  </div>

                  {entry.error && (
                    <p className="text-destructive border-b px-4 py-2 text-xs">{entry.error}</p>
                  )}

                  {entry.skipped.length > 0 && (
                    <div className="border-b px-4 py-2">
                      <Alert variant="warning">
                        <Subtitles />
                        <div>
                          <AlertTitle>已跳过 {entry.skipped.length} 条字幕轨道</AlertTitle>
                          <AlertDescription>
                            {entry.skipped
                              .map((track) => `${track.trackName}（${track.reason}）`)
                              .join('；')}
                          </AlertDescription>
                        </div>
                      </Alert>
                    </div>
                  )}

                  <div className="divide-y">
                    {entry.files.map((file) => (
                      <div key={`${file.kind}-${file.streamIndex}`} className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <KindIcon kind={file.kind} />
                          <span className="font-mono text-xs break-all">{file.fileName}</span>
                          <span className="text-muted-foreground text-xs">{KIND_LABELS[file.kind]}</span>
                          <FileStatusBadge file={file} />
                          {file.mode === 'transcode' && <Badge variant="outline">已转码</Badge>}
                          {file.mode === 'copy' && <Badge variant="outline">直接复制</Badge>}
                          {file.audioTrackName && (
                            <Badge variant="secondary">含默认音轨：{file.audioTrackName}</Badge>
                          )}
                          {file.status === 'done' && file.sizeBytes !== null && (
                            <span className="text-muted-foreground text-xs">
                              {formatBytes(file.sizeBytes)}
                            </span>
                          )}
                          {file.status === 'running' && file.speed && (
                            <span className="text-muted-foreground text-xs">{file.speed}</span>
                          )}
                          {file.status === 'running' && (
                            <span className="text-muted-foreground ml-auto text-xs">
                              {file.percent.toFixed(0)}%
                            </span>
                          )}
                          {file.status === 'done' && <Check className="ml-auto size-4 text-emerald-600" />}
                        </div>
                        {file.status === 'running' && <Progress value={file.percent} className="h-1.5" />}
                        {file.notice && <p className="text-muted-foreground text-xs">{file.notice}</p>}
                        {file.error && <p className="text-destructive text-xs">失败原因：{file.error}</p>}
                      </div>
                    ))}
                    {entry.files.length === 0 && (
                      <p className="text-muted-foreground px-4 py-3 text-xs">暂无输出文件</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {batchJob.status === 'completed' && (
              <p className="text-muted-foreground text-xs">
                已写入根目录：<span className="font-mono">{batchJob.outputRoot}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
