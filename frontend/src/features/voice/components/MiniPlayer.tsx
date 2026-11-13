import { Pause, Play, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '@/features/media/process';
import { closePlayer, cycleSpeed, togglePlaying, usePlayer } from '../player';
import { useConnectPlayer } from '../use-connect-player';

/** Keeps what is playing in reach while scrolling or moving to another chat. */
export function MiniPlayer() {
  const { t } = useTranslation();
  const track = usePlayer((state) => state.track);
  const playing = usePlayer((state) => state.playing);
  const position = usePlayer((state) => state.position);
  const speed = usePlayer((state) => state.speed);
  useConnectPlayer();
  // Signing out leaves this screen: nothing keeps playing after that.
  useEffect(() => () => closePlayer(), []);
  if (!track) return null;
  return (
    <section
      aria-label={t('voice.nowPlaying')}
      className="glass flex h-11 shrink-0 items-center gap-2 border-b px-3"
    >
      <button
        type="button"
        onClick={togglePlaying}
        aria-label={playing ? t('voice.pause') : t('voice.play')}
        className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-white"
      >
        {playing ? (
          <Pause className="size-4" aria-hidden />
        ) : (
          <Play className="size-4" aria-hidden />
        )}
      </button>
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{track.title}</span>
        <span className="ml-2 text-xs text-text-muted tabular-nums">
          {formatDuration(position)} / {formatDuration(track.duration)}
        </span>
      </p>
      <button
        type="button"
        onClick={cycleSpeed}
        aria-label={t('voice.speed', { speed })}
        className="rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums"
      >
        {speed}x
      </button>
      <button
        type="button"
        onClick={closePlayer}
        aria-label={t('voice.closePlayer')}
        className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-background"
      >
        <X className="size-4" aria-hidden />
      </button>
    </section>
  );
}
