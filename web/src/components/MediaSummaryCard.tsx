import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBitrate, formatBytes, formatDuration, formatText } from '@/lib/format';
import { selectActiveItem } from '@/store/mediaSlice';
import { useAppSelector } from '@/store/hooks';

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="truncate text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

export function MediaSummaryCard() {
  const item = useAppSelector(selectActiveItem);
  const media = item?.media;
  if (!media) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>文件概览</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoItem label="文件名" value={formatText(media.file.name)} />
        <InfoItem label="容器格式" value={formatText(media.format.longName || media.format.name)} />
        <InfoItem label="时长" value={formatDuration(media.format.durationSec)} />
        <InfoItem label="文件大小" value={formatBytes(media.file.sizeBytes)} />
        <InfoItem label="总码率" value={formatBitrate(media.format.bitrate)} />
        <InfoItem label="流总数" value={`${media.format.streamCount} 条`} />
      </CardContent>
    </Card>
  );
}
