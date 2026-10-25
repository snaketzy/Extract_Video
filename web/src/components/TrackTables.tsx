import type { CheckedState } from '@radix-ui/react-checkbox';

import { Badge } from '@/components/ui/badge';
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
import { setKindSelection, toggleTrack } from '@/store/mediaSlice';
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

export function TrackTables() {
  const dispatch = useAppDispatch();
  const { media, selected } = useAppSelector((state) => state.media);
  if (!media) return null;

  const base = outputBaseName(media.file.name);

  const videoIndexes = media.tracks.video.map((track) => track.streamIndex);
  const audioIndexes = media.tracks.audio.map((track) => track.streamIndex);
  const subtitleIndexes = media.tracks.subtitle.map((track) => track.streamIndex);

  const handleToggle = (kind: TrackKind, streamIndex: number) => {
    dispatch(toggleTrack({ kind, streamIndex }));
  };

  const handleToggleAll = (kind: TrackKind, indexes: number[], checked: boolean) => {
    dispatch(setKindSelection({ kind, streamIndexes: checked ? indexes : [] }));
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
        <CardDescription>勾选需要导出的轨道；字幕仅支持可转换为 SRT 的文本字幕</CardDescription>
      </CardHeader>
      <CardContent>
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
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SelectHead {...audioProps} />
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
                    {media.tracks.audio.map((track: AudioTrack) => (
                      <TableRow key={track.streamIndex}>
                        <SelectCell {...audioProps} streamIndex={track.streamIndex} />
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
                          {`${base}.${track.name}.mp3`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="subtitle">
            {media.tracks.subtitle.length === 0 ? (
              <EmptyTracks text="该文件不含字幕轨道" />
            ) : (
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
                    {media.tracks.subtitle.map((track: SubtitleTrack) => (
                      <TableRow key={track.streamIndex}>
                        <TableCell>
                          <Checkbox
                            checked={selected.subtitle.includes(track.streamIndex)}
                            disabled={!track.convertibleToSrt}
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
                          {track.convertibleToSrt ? (
                            <Badge variant="secondary">文本，可转 SRT</Badge>
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
                          {track.convertibleToSrt ? `${base}.${track.name}.srt` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
