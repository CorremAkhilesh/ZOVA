import { useTranslation } from 'react-i18next';
import { type ChatMessage, ME } from '@/features/chats/types';
import { UploadRing } from '@/features/media/components/MessageMedia';
import { formatDuration } from '@/features/media/process';
import { cn } from '@/lib/utils';
import { playTrack, seekTo, togglePlaying } from '../player';
import { toTrack } from '../track';
import { useTrackState } from '../use-track';
import { PlayIcon } from './PlayIcon';
import { SpeedButton } from './SpeedButton';
import { Waveform } from './Waveform';

/** A flat line for a note whose shape is not known, so it never looks broken. */
const FLAT_BARS = Array.from({ length: 64 }, () => 20);

function UnheardDot() {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('voice.unplayed')}
      className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border border-surface bg-accent"
    />
  );
}

function CannotPlay({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <p role="alert" className="text-xs font-semibold">
      {t('voice.cannotPlay')}
    </p>
  );
}

export function VoiceBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const { media } = message;
  const mine = message.authorId === ME;
  const { active, playing, loading, position, failed } = useTrackState(message.id, media?.id);
  if (!media) return null;
  const uploading = message.status === 'pending' && !media.id;
  const duration = media.duration ?? 0;
  const start = (at?: number) => {
    const next = toTrack(message, { voice: t('voice.preview') });
    if (next) playTrack(next, at);
  };
  const toggle = () => (active ? togglePlaying() : start());
  const seek = (seconds: number) => (active ? seekTo(seconds) : start(seconds));
  const barClasses = mine
    ? { playedClass: 'bg-bubble-outgoing-text', restClass: 'bg-bubble-outgoing-text/40' }
    : { playedClass: 'bg-brand', restClass: 'bg-text-muted/40' };

  return (
    <div className="flex w-72 max-w-full items-center gap-2">
      <div className="relative size-10 shrink-0">
        {uploading ? (
          <UploadRing message={message} />
        ) : (
          <button
            type="button"
            onClick={toggle}
            disabled={failed}
            aria-label={playing ? t('voice.pause') : t('voice.play')}
            className={cn(
              'flex size-10 items-center justify-center rounded-full',
              mine ? 'bg-black/20' : 'bg-brand text-white',
            )}
          >
            <PlayIcon playing={playing} loading={loading} className="size-5" />
          </button>
        )}
        {!mine && !message.played ? <UnheardDot /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <Waveform
          bars={media.waveform ?? FLAT_BARS}
          label={t('voice.seek')}
          position={position}
          duration={duration}
          disabled={uploading || failed}
          {...barClasses}
          onSeek={seek}
          onToggle={toggle}
        />
        <div className="flex h-5 items-center gap-2 text-[11px] tabular-nums opacity-90">
          <span>{formatDuration(active ? position : duration)}</span>
          {active ? <SpeedButton /> : null}
        </div>
        <CannotPlay show={failed} />
      </div>
    </div>
  );
}
