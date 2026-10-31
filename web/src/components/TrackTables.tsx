import type { CheckedState } from '@radix-ui/react-checkbox';
import { CopyCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatBitrate,
  formatChannels,
  formatFps,
  formatResolution,
  formatSampleRate,
  formatText,
} from '@/lib/format';
import type { AudioTrack, SubtitleTrack, TrackKind, VideoTrack } from '@/lib/types';
import {
  activeKeyChanged,
  buildExportSelection,
  defaultAudioChanged,
  kindSelectionSet,
  selectActiveItem,
  selectionAppliedToAll,
  subtitleFormatAvailable,
  subtitleFormatChanged,
  trackToggled,
} from '@/store/mediaSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

function outputBaseName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

interface ColumnProps {
  selected: number[];
  allIndexes: number[];
  onToggleAll: (checked: boolean) => void;
  onToggle: (streamIndex: number) => void;
}

function SelectHead({ selected, allIndexes, onToggleAll }: ColumnProps) {
  const checkedState: CheckedState =
    selected.length === 0 ? false : selected.length === allIndexes.length ? true : 'indeterminate';

  return (
    <TableHead className="w-10">
      <Checkbox
        checked={checkedState}
        onCheckedChange={(value) => onToggleAll(value === true)}
        aria-label="全选"
      />
    </TableHead>
  );
}

function SelectCell({ streamIndex, selected, onToggle }: ColumnProps & { streamIndex: number }) {
  return (
    <TableCell>
      <Checkbox
        checked={selected.includes(streamIndex)}
        onCheckedChange={() => onToggle(streamIndex)}
        aria-label={`选择轨道 ${streamIndex}`}
      />
    </TableCell>
  );
}

function TrackFlags({ isDefault, isForced }: { isDefault: boolean; isForced: boolean }) {
  if (!isDefault && !isForced) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex gap-1">
      {isDefault && <Badge variant="outline">默认</Badge>}
      {isForced && <Badge variant="outline">强制</Badge>}
    </div>
  );
}

function TrackIdentity({
  indexInType,
  streamIndex,
  name,
}: {
  indexInType: number;
  streamIndex: number;
  name: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium">#{indexInType + 1}</p>
      <p className="text-muted-foreground text-xs">
        stream {streamIndex} · {name}
      </p>
    </div>
  );
}

function CodecCell({ codec, codecLongName }: { codec: string; codecLongName: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium uppercase">{codec}</p>
      {codecLongName && <p className="text-muted-foreground max-w-[16rem] text-xs">{codecLongName}</p>}
    </div>
  );
}

function EmptyTracks({ text }: { text: string }) {
  return <p className="text-muted-foreground py-8 text-center text-sm">{text}</p>;
}

/** 该字幕轨可导出的格式名 */
function subtitleFormatsOf(track: SubtitleTrack): string[] {
  const formats: string[] = [];
  if (track.convertibleToSrt) formats.push('SRT');
  if (track.convertibleToWebVtt) formats.push('WebVTT');
  if (track.convertibleToSup) formats.push('SUP');
  return formats;
}

export function TrackTables() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((state) => state.media.items);
  const item = useAppSelector(selectActiveItem);
  if (!item || !item.media) return null;

  const media = item.media;
  const { key, selected, defaultAudio, subtitleFormat } = item;
  const readyItems = items.filter((entry) => entry.media);

  const base = outputBaseName(media.file.name);
  const plan = buildExportSelection(media, selected, defaultAudio, subtitleFormat);

  const srtAvailable = subtitleFormatAvailable(media.tracks.subtitle, 'srt');
  const webvttAvailable = subtitleFormatAvailable(media.tracks.subtitle, 'webvtt');
  const hasPgsTrack = media.tracks.subtitle.some((track) => track.convertibleToSup);
  const subtitleExtension = subtitleFormat === 'webvtt' ? 'vtt' : 'srt';

  // 只有文件含视频轨道时，「默认音轨」才有意义（用于封装进 MP4）
  const showDefaultAudioColumn = media.tracks.video.length > 0;
  const defaultAudioName =
    defaultAudio === null ? null : media.tracks.audio.find((track) => track.streamIndex === defaultAudio)?.name ?? null;

  const videoIndexes = media.tracks.video.map((track) => track.streamIndex);
  const audioIndexes = media.tracks.audio.map((track) => track.streamIndex);
  const subtitleIndexes = media.tracks.subtitle.map((track) => track.streamIndex);

  const handleToggle = (kind: TrackKind, streamIndex: number) => {
    dispatch(trackToggled({ key, kind, streamIndex }));
  };

  const handleToggleAll = (kind: TrackKind, indexes: number[], checked: boolean) => {
    dispatch(kindSelectionSet({ key, kind, streamIndexes: checked ? indexes : [] }));
  };

  const videoProps: ColumnProps = {
    selected: selected.video,
    allIndexes: videoIndexes,
    onToggleAll: (checked) => handleToggleAll('video', videoIndexes, checked),
    onToggle: (streamIndex) => handleToggle('video', streamIndex),
  };
  const audioProps: ColumnProps = {
    selected: selected.audio,
    allIndexes: audioIndexes,
    onToggleAll: (checked) => handleToggleAll('audio', audioIndexes, checked),
    onToggle: (streamIndex) => handleToggle('audio', streamIndex),
  };
  const subtitleProps: ColumnProps = {
    selected: selected.subtitle,
    allIndexes: subtitleIndexes,
    onToggleAll: (checked) => handleToggleAll('subtitle', subtitleIndexes, checked),
    onToggle: (streamIndex) => handleToggle('subtitle', streamIndex),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. 轨道参数</CardTitle>
        <CardDescription>
          当前正在编辑：<span className="text-foreground font-medium">{media.file.name}</span>
          。勾选需要导出的轨道；导出视频需先在「音频轨道」中指定默认音轨（会封装进 MP4，不再单独导出为 mp3）；文本字幕以
          SRT / WebVTT 二选一导出，PGS 图形字幕原样导出为 .sup
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {readyItems.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">切换文件</span>
            {readyItems.map((entry) => (
              <Button
                key={entry.key}
                size="sm"
                variant={entry.key === key ? 'secondary' : 'outline'}
                onClick={() => dispatch(activeKeyChanged(entry.key))}
              >
                {entry.sourceFile?.name ?? entry.media?.file.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => dispatch(selectionAppliedToAll(key))}
            >
              <CopyCheck />
              应用到全部
            </Button>
          </div>
        )}

        <Tabs defaultValue="video">
          <TabsList>
            <TabsTrigger value="video">
              视频轨道
              <Badge variant="secondary">{media.counts.video}</Badge>
            </TabsTrigger>
            <TabsTrigger value="audio">
              音频轨道
              <Badge variant="secondary">{media.counts.audio}</Badge>
            </TabsTrigger>
            <TabsTrigger value="subtitle">
              字幕轨道
              <Badge variant="secondary">{media.counts.subtitle}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="video">
            {media.tracks.video.length === 0 ? (
              <EmptyTracks text="该文件不含视频轨道" />
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SelectHead {...videoProps} />
                      <TableHead>轨道</TableHead>
                      <TableHead>编码</TableHead>
                      <TableHead>分辨率</TableHead>
                      <TableHead>帧率</TableHead>
                      <TableHead>码率</TableHead>
                      <TableHead>位深 / 像素格式</TableHead>
                      <TableHead>Profile / Level</TableHead>
                      <TableHead>色彩</TableHead>
                      <TableHead>语言</TableHead>
                      <TableHead>标记</TableHead>
                      <TableHead>导出文件</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {media.tracks.video.map((track: VideoTrack) => (
                      <TableRow key={track.streamIndex}>
                        <SelectCell {...videoProps} streamIndex={track.streamIndex} />
                        <TableCell>
                          <TrackIdentity
                            indexInType={track.indexInType}
                            streamIndex={track.streamIndex}
                            name={track.name}
                          />
                        </TableCell>
                        <TableCell>
                          <CodecCell codec={track.codec} codecLongName={track.codecLongName} />
                        </TableCell>
                        <TableCell>{formatResolution(track.width, track.height)}</TableCell>
                        <TableCell>{formatFps(track.fps)}</TableCell>
                        <TableCell>{formatBitrate(track.bitrate)}</TableCell>
                        <TableCell>
                          {formatText(track.bitDepth ? `${track.bitDepth} bit` : null)}
                          <span className="text-muted-foreground"> / </span>
                          {formatText(track.pixelFormat)}
                        </TableCell>
                        <TableCell>
                          {formatText(track.profile)}
                          <span className="text-muted-foreground"> / </span>
                          {formatText(track.level)}
                        </TableCell>
                        <TableCell>{formatText(track.colorSpace)}</TableCell>
                        <TableCell>{formatText(track.language)}</TableCell>
                        <TableCell>
                          <TrackFlags isDefault={track.isDefault} isForced={track.isForced} />
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {media.tracks.video.length > 1
                            ? `${base}.v${track.indexInType + 1}.mp4`
                            : `${base}.mp4`}
                          {plan.requiresDefaultAudio && (
                            <p className={defaultAudioName ? undefined : 'text-destructive'}>
                              {defaultAudioName ? `含默认音轨：${defaultAudioName}` : '尚未选择默认音轨'}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="audio">
            {media.tracks.audio.length === 0 ? (
              <EmptyTracks text="该文件不含音频轨道" />
            ) : (
              <div className="space-y-3">
                {showDefaultAudioColumn && (
                  <p className="text-muted-foreground text-xs">
                    {plan.requiresDefaultAudio
                      ? '选中的默认音轨会封装进导出的 MP4，且不再单独导出为 mp3。'
                      : '勾选视频轨道后，可为视频选择一条默认音轨。'}
                  </p>
                )}
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SelectHead {...audioProps} />
                        {showDefaultAudioColumn && <TableHead className="w-24">默认音轨</TableHead>}
                        <TableHead>轨道</TableHead>
                        <TableHead>编码</TableHead>
                        <TableHead>采样率</TableHead>
                        <TableHead>声道</TableHead>
                        <TableHead>声道布局</TableHead>
                        <TableHead>码率</TableHead>
                        <TableHead>位深</TableHead>
                        <TableHead>语言</TableHead>
                        <TableHead>标记</TableHead>
                        <TableHead>导出文件</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {media.tracks.audio.map((track: AudioTrack) => {
                        const mergedIntoVideo =
                          plan.requiresDefaultAudio && track.streamIndex === defaultAudio;
                        return (
                          <TableRow key={track.streamIndex}>
                            <TableCell>
                              <Checkbox
                                checked={selected.audio.includes(track.streamIndex) && !mergedIntoVideo}
                                disabled={mergedIntoVideo}
                                onCheckedChange={() => handleToggle('audio', track.streamIndex)}
                                aria-label={`选择音频轨道 ${track.streamIndex}`}
                              />
                            </TableCell>
                            {showDefaultAudioColumn && (
                              <TableCell>
                                <input
                                  type="radio"
                                  name={`default-audio-track-${key}`}
                                  className="size-4 accent-primary"
                                  checked={defaultAudio === track.streamIndex}
                                  disabled={!plan.requiresDefaultAudio}
                                  onChange={() =>
                                    dispatch(defaultAudioChanged({ key, streamIndex: track.streamIndex }))
                                  }
                                  aria-label={`将音频轨道 ${track.streamIndex} 设为默认音轨`}
                                />
                              </TableCell>
                            )}
                            <TableCell>
                              <TrackIdentity
                                indexInType={track.indexInType}
                                streamIndex={track.streamIndex}
                                name={track.name}
                              />
                            </TableCell>
                            <TableCell>
                              <CodecCell codec={track.codec} codecLongName={track.codecLongName} />
                            </TableCell>
                            <TableCell>{formatSampleRate(track.sampleRate)}</TableCell>
                            <TableCell>{formatChannels(track.channels)}</TableCell>
                            <TableCell>{formatText(track.channelLayout)}</TableCell>
                            <TableCell>{formatBitrate(track.bitrate)}</TableCell>
                            <TableCell>{formatText(track.bitDepth ? `${track.bitDepth} bit` : null)}</TableCell>
                            <TableCell>{formatText(track.language)}</TableCell>
                            <TableCell>
                              <TrackFlags isDefault={track.isDefault} isForced={track.isForced} />
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs">
                              {mergedIntoVideo ? (
                                <Badge variant="secondary">已并入 mp4</Badge>
                              ) : (
                                `${base}.${track.name}.mp3`
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="subtitle">
            {media.tracks.subtitle.length === 0 ? (
              <EmptyTracks text="该文件不含字幕轨道" />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-sm font-medium">导出格式</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`subtitle-format-${key}`}
                      className="size-4 accent-primary"
                      checked={subtitleFormat === 'webvtt'}
                      disabled={!webvttAvailable}
                      onChange={() => dispatch(subtitleFormatChanged({ key, format: 'webvtt' }))}
                      aria-label="字幕导出为 WebVTT"
                    />
                    WebVTT（.vtt）
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`subtitle-format-${key}`}
                      className="size-4 accent-primary"
                      checked={subtitleFormat === 'srt'}
                      disabled={!srtAvailable}
                      onChange={() => dispatch(subtitleFormatChanged({ key, format: 'srt' }))}
                      aria-label="字幕导出为 SRT"
                    />
                    SRT（.srt）
                  </label>
                  {hasPgsTrack && (
                    <span className="text-muted-foreground text-xs">
                      格式仅作用于文本字幕轨；PGS 图形字幕固定导出为 .sup
                    </span>
                  )}
                </div>
                {!srtAvailable && !webvttAvailable && (
                  <p className="text-muted-foreground text-xs">
                    {hasPgsTrack
                      ? '当前字幕均为图形字幕，无法转换为 SRT / WebVTT；勾选后将以 .sup 原样导出'
                      : '当前字幕均为图形字幕，无法转换为 SRT / WebVTT'}
                  </p>
                )}
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SelectHead {...subtitleProps} />
                        <TableHead>轨道</TableHead>
                        <TableHead>编码</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>语言</TableHead>
                        <TableHead>标题</TableHead>
                        <TableHead>标记</TableHead>
                        <TableHead>导出文件</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {media.tracks.subtitle.map((track: SubtitleTrack) => {
                        const formats = subtitleFormatsOf(track);
                        return (
                          <TableRow key={track.streamIndex}>
                            <TableCell>
                              <Checkbox
                                checked={selected.subtitle.includes(track.streamIndex)}
                                disabled={formats.length === 0}
                                onCheckedChange={() => handleToggle('subtitle', track.streamIndex)}
                                aria-label={`选择字幕轨道 ${track.streamIndex}`}
                              />
                            </TableCell>
                            <TableCell>
                              <TrackIdentity
                                indexInType={track.indexInType}
                                streamIndex={track.streamIndex}
                                name={track.name}
                              />
                            </TableCell>
                            <TableCell>
                              <CodecCell codec={track.codec} codecLongName={track.codecLongName} />
                            </TableCell>
                            <TableCell>
                              {track.convertibleToSup ? (
                                <Badge variant="secondary">图形字幕，可原样导出 .sup</Badge>
                              ) : formats.length > 0 ? (
                                <Badge variant="secondary">文本，可转 {formats.join(' / ')}</Badge>
                              ) : (
                                <Badge variant="warning">{formatText(track.note, '图形字幕')}</Badge>
                              )}
                            </TableCell>
                            <TableCell>{formatText(track.language)}</TableCell>
                            <TableCell>{formatText(track.title)}</TableCell>
                            <TableCell>
                              <TrackFlags isDefault={track.isDefault} isForced={track.isForced} />
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs">
                              {track.convertibleToSup
                                ? `${base}.${track.name}.sup`
                                : formats.length > 0
                                  ? `${base}.${track.name}.${subtitleExtension}`
                                  : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
