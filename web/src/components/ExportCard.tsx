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
import type { ExportFileState, TrackKind } from '@/lib/types';
import {
  buildExportSelection,
  cancelExport,
  outputDirChanged,
  pickOutputDirectory,
  refreshExport,
  startExport,
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

function StatusBadge({ file }: { file: ExportFileState }) {
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

export function ExportCard() {
  const dispatch = useAppDispatch();
  const { media, selected, defaultAudio, subtitleFormat, outputDir, pickerStatus, pickerError, exportJob, exportStarting, exportError, config } =
    useAppSelector((state) => state.media);

  const exportId = exportJob?.id ?? null;
  const isExporting = exportJob?.status === 'queued' || exportJob?.status === 'running';

  useEffect(() => {
    if (!exportId || !isExporting) return undefined;
    const timer = window.setInterval(() => {
      void dispatch(refreshExport(exportId));
    }, 700);
    return () => window.clearInterval(timer);
  }, [dispatch, exportId, isExporting]);

  if (!media) return null;

  const plan = buildExportSelection(media, selected, defaultAudio, subtitleFormat);
  const totalSelected = plan.video.length + plan.audio.length + plan.subtitle.length;
  const subtitleExtension = plan.subtitleFormat === 'webvtt' ? 'vtt' : 'srt';
  const missingDefaultAudio = plan.requiresDefaultAudio && plan.defaultAudio === null;
  const pickerSupported = config?.folderPickerSupported !== false && pickerStatus !== 'unsupported';
  const canExport =
    totalSelected > 0 && !missingDefaultAudio && outputDir.trim().length > 0 && !isExporting && !exportStarting;

  const overallPercent =
    exportJob && exportJob.total > 0
      ? Math.round(
          (exportJob.files.reduce(
            (sum, file) => sum + (file.status === 'done' || file.status === 'failed' ? 100 : file.percent),
            0
          ) /
            (exportJob.total * 100)) *
            100
        )
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. 导出到本地目录</CardTitle>
        <CardDescription>
          点击「选择文件夹」将调起系统原生目录对话框；导出文件直接写入该目录，不经过浏览器下载
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">输出目录</p>
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
          <p className="text-sm font-medium">导出内容</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={plan.video.length ? 'secondary' : 'outline'}>
              视频 {plan.video.length} 条 → mp4
            </Badge>
            <Badge variant={plan.audio.length ? 'secondary' : 'outline'}>
              音频 {plan.audio.length} 条 → mp3
            </Badge>
            <Badge variant={plan.subtitle.length ? 'secondary' : 'outline'}>
              字幕 {plan.subtitle.length} 条 → {subtitleExtension}
            </Badge>
            {plan.requiresDefaultAudio && (
              <Badge variant={plan.defaultAudio === null ? 'destructive' : 'secondary'}>
                默认音轨 {plan.defaultAudio === null ? '未选择' : '→ 并入 mp4'}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">共 {totalSelected} 个文件</span>
          </div>
          <p className="text-muted-foreground font-mono text-xs">
            {`视频：${media.file.name.replace(/\.[^.]+$/, '')}.mp4 · 音频：<原文件名>.<轨道名>.mp3 · 字幕：<原文件名>.<轨道名>.${subtitleExtension}`}
          </p>
        </div>

        {exportError && (
          <Alert variant="destructive">
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Button size="lg" disabled={!canExport} onClick={() => void dispatch(startExport())}>
            {exportStarting || isExporting ? <Loader2 className="animate-spin" /> : <Download />}
            {isExporting ? '导出中…' : exportJob ? '重新导出' : '开始导出'}
          </Button>
          {isExporting && exportJob && (
            <Button variant="outline" onClick={() => void dispatch(cancelExport(exportJob.id))}>
              <X />
              取消
            </Button>
          )}
          {!outputDir.trim() && <span className="text-muted-foreground text-xs">请先选择导出目录</span>}
          {missingDefaultAudio && (
            <span className="text-destructive text-xs">请先在「音频轨道」中为视频选择默认音轨</span>
          )}
          {totalSelected === 0 && <span className="text-muted-foreground text-xs">请至少勾选一条轨道</span>}
        </div>

        {exportJob && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                导出进度
                <span className="text-muted-foreground ml-2 text-xs">
                  {exportJob.completed} / {exportJob.total}
                  {exportJob.failed > 0 ? ` · 失败 ${exportJob.failed}` : ''}
                </span>
              </p>
              <Badge
                variant={
                  exportJob.status === 'completed'
                    ? 'success'
                    : exportJob.status === 'failed'
                      ? 'destructive'
                      : exportJob.status === 'cancelled'
                        ? 'outline'
                        : 'secondary'
                }
              >
                {exportJob.status === 'queued' && '排队中'}
                {exportJob.status === 'running' && '导出中'}
                {exportJob.status === 'completed' && '已完成'}
                {exportJob.status === 'failed' && '失败'}
                {exportJob.status === 'cancelled' && '已取消'}
              </Badge>
            </div>

            <Progress value={overallPercent} />

            {exportJob.error && (
              <Alert variant="destructive">
                <AlertDescription>{exportJob.error}</AlertDescription>
              </Alert>
            )}

            {exportJob.skipped.length > 0 && (
              <Alert variant="warning">
                <Subtitles />
                <div>
                  <AlertTitle>已跳过 {exportJob.skipped.length} 条字幕轨道</AlertTitle>
                  <AlertDescription>
                    {exportJob.skipped.map((track) => `${track.trackName}（${track.reason}）`).join('；')}
                  </AlertDescription>
                </div>
              </Alert>
            )}

            <div className="divide-y rounded-lg border">
              {exportJob.files.map((file) => (
                <div key={`${file.kind}-${file.streamIndex}`} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindIcon kind={file.kind} />
                    <span className="font-mono text-xs break-all">{file.fileName}</span>
                    <span className="text-muted-foreground text-xs">{KIND_LABELS[file.kind]}</span>
                    <StatusBadge file={file} />
                    {file.mode === 'transcode' && <Badge variant="outline">已转码</Badge>}
                    {file.mode === 'copy' && <Badge variant="outline">直接复制</Badge>}
                    {file.audioTrackName && (
                      <Badge variant="secondary">含默认音轨：{file.audioTrackName}</Badge>
                    )}
                    {file.status === 'done' && file.sizeBytes !== null && (
                      <span className="text-muted-foreground text-xs">{formatBytes(file.sizeBytes)}</span>
                    )}
                    {file.status === 'running' && file.speed && (
                      <span className="text-muted-foreground text-xs">{file.speed}</span>
                    )}
                    {file.status === 'running' && (
                      <span className="text-muted-foreground ml-auto text-xs">{file.percent.toFixed(0)}%</span>
                    )}
                    {file.status === 'done' && <Check className="ml-auto size-4 text-emerald-600" />}
                  </div>
                  {file.status === 'running' && <Progress value={file.percent} className="h-1.5" />}
                  {file.notice && <p className="text-muted-foreground text-xs">{file.notice}</p>}
                  {file.error && <p className="text-destructive text-xs">失败原因：{file.error}</p>}
                </div>
              ))}
            </div>

            {exportJob.status === 'completed' && (
              <p className="text-muted-foreground text-xs">
                已写入目录：<span className="font-mono">{exportJob.outputDir}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
