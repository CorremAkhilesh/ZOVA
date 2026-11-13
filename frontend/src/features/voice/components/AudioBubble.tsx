import { Download, Loader2, Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type ChatMessage, ME } from '@/features/chats/types';
import { useDownload } from '@/features/media/components/DocumentCard';
import { UploadRing } from '@/features/media/components/MessageMedia';
import { formatBytes, formatDuration } from '@/features/media/process';
import { cn } from '@/lib/utils';
import { playTrack, seekTo, togglePlaying } from '../player';
import { toTrack } from '../track';
import { trackLabels, useTrackState } from '../use-track';
import { PlayIcon } from './PlayIcon';
import { SpeedButton } from './SpeedButton';

function DownloadButton(props: { name: string; download: ReturnType<typeof useDownload> }) {
  const { t } = useTranslation();
  const { name, download } = props;
  return (
    <button
      type="button"
      aria-label={t('media.downloadNamed', { name })}
      disabled={download.state === 'working'}
      onClick={() => void download.start()}
      className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full bg-black/15"
    >
      {download.state === 'working' ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
    </button>
  );
}

/** Nothing until the length is known: a file says only once it has loaded. */
function timeLabel(active: boolean, position: number, duration: number) {
  if (active) return formatDuration(position);
  return duration > 0 ? formatDuration(duration) : null;
}

function problemOf(cannotPlay: boolean, cannotDownload: boolean) {
  if (cannotPlay) return 'voice.cannotPlay';
  return cannotDownload ? 'media.notAvailable' : null;
}

function FilePlayButton(props: { playing: boolean; disabled: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onPress}
      aria-label={props.playing ? t('voice.pauseFile') : t('voice.playFile')}
      className="flex size-9 items-center justify-center rounded-full bg-black/20"
    >
      <PlayIcon playing={props.playing} className="size-4" />
    </button>
  );
}

/** A music or sound file someone attached: a plain player, with no waveform or "played" status. */
export function AudioBubble({ message }: { message: ChatMessage }) {
  const { t, i18n } = useTranslation();
  const { media } = message;
  const download = useDownload(media?.id || undefined);
  const { active, playing, position, known, failed } = useTrackState(message.id, media?.id);
  if (!media) return null;
  const uploading = message.status === 'pending' && !media.id;
  const duration = known ?? media.duration ?? 0;
  const start = () => {
    const track = toTrack(message, trackLabels(t));
    if (track) playTrack(track);
  };
  const controls = {
    playing,
    disabled: failed,
    onPress: () => (active ? togglePlaying() : start()),
  };
  const time = timeLabel(active, position, duration);
  const problem = problemOf(failed, download.state === 'failed');

  return (
    <div
      className={cn(
        'w-72 max-w-full space-y-1 rounded-xl p-2',
        message.authorId === ME ? 'bg-black/15' : 'bg-background',
      )}
    >
      <div className="flex items-center gap-2">
        <Music className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{media.name}</p>
        {uploading ? null : <DownloadButton name={media.name} download={download} />}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative size-9 shrink-0">
          {uploading ? <UploadRing message={message} /> : <FilePlayButton {...controls} />}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(duration))}
          value={Math.round(position)}
          disabled={uploading || failed || !active}
          aria-label={t('voice.seek')}
          aria-valuetext={`${formatDuration(position)} / ${formatDuration(duration)}`}
          onChange={(event) => seekTo(Number(event.target.value))}
          className="min-w-0 flex-1 accent-current"
        />
        {active ? <SpeedButton /> : null}
      </div>
      <p className="text-[11px] tabular-nums opacity-90">
        {[time, formatBytes(media.size, i18n.language)].filter(Boolean).join(' · ')}
      </p>
      {problem ? (
        <p role="alert" className="text-xs font-semibold">
          {t(problem)}
        </p>
      ) : null}
    </div>
  );
}
