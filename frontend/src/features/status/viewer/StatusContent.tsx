import { useQuery } from '@tanstack/react-query';
import type { Status } from '@zuvo/protocol';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { mediaApi } from '@/features/media/api';
import { cn } from '@/lib/utils';
import { backgroundStyle, FONT_CLASSES, textSizeClass } from '../text-styles';

/** A signed link to a status's file (the same cache as the chat's media viewer). */
export const mediaLinkQuery = (mediaId: string) => ({
  queryKey: ['media-link', mediaId],
  queryFn: () => mediaApi.link(mediaId, false),
  staleTime: 10 * 60_000,
  retry: 1,
});

interface StatusContentProps {
  status: Status;
  paused: boolean;
  /** A video's real length, once its metadata is in. */
  onVideoLength: (seconds: number) => void;
  /** Waiting for data (buffering): the clock holds. */
  onWaiting: (waiting: boolean) => void;
}

/** What the status says or shows, filling the screen. */
export function StatusContent({ status, paused, onVideoLength, onWaiting }: StatusContentProps) {
  const { t } = useTranslation();
  const mediaId = status.media?.id ?? '';
  const link = useQuery({ ...mediaLinkQuery(mediaId), enabled: Boolean(mediaId) });
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else void element.play().catch(() => undefined);
  }, [paused]);

  // No file yet: the clock waits for it.
  useEffect(() => {
    if (status.kind !== 'text') onWaiting(!link.data);
  }, [status.kind, link.data, onWaiting]);

  if (status.kind === 'text') {
    // The colour fills the whole window (StatusBackdrop); here only the words, big and centred.
    return (
      <div className="grid h-full w-full place-items-center overflow-y-auto px-6 py-24 text-center text-white md:px-10 md:py-8">
        <p
          className={cn(
            'max-w-2xl leading-tight break-words whitespace-pre-wrap [text-shadow:0_1px_3px_rgb(0_0_0/0.25)]',
            FONT_CLASSES[status.style?.font ?? 'sans'],
            textSizeClass(status.text ?? ''),
          )}
        >
          {status.text}
        </p>
      </div>
    );
  }
  if (link.isError) {
    return (
      <p role="alert" className="grid h-full place-items-center text-sm text-white/80">
        {t('media.notAvailable')}
      </p>
    );
  }
  return (
    // Absolutely filling the stage, so the picture's max height is the stage's: never cut, never
    // under the reply box, its own shape kept.
    <div className="absolute inset-0 flex items-center justify-center">
      {link.data && status.kind === 'image' ? (
        <img
          src={link.data.url}
          alt={status.text ?? t('updates.photo')}
          className="relative max-h-full max-w-full object-contain md:rounded-lg md:shadow-2xl"
        />
      ) : null}
      {link.data && status.kind === 'video' ? (
        // biome-ignore lint/a11y/useMediaCaption: people's own clips have no captions to offer
        <video
          ref={video}
          src={link.data.url}
          autoPlay
          playsInline
          aria-label={status.text ?? t('updates.video')}
          className="relative max-h-full max-w-full object-contain md:rounded-lg md:shadow-2xl"
          onLoadedMetadata={(event) => onVideoLength(event.currentTarget.duration)}
          onWaiting={() => onWaiting(true)}
          onPlaying={() => onWaiting(false)}
        />
      ) : null}
      {status.text ? (
        <p className="absolute inset-x-0 bottom-28 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-xl bg-black/55 px-4 py-2 text-center text-base text-white backdrop-blur-sm md:bottom-4">
          {status.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Behind everything, filling the window: a text status's colour; a photo's own colours, blurred
 * (its tiny placeholder); else near-black.
 */
export function StatusBackdrop({ status }: { status: Status }) {
  if (status.kind === 'text') {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={status.style ? backgroundStyle(status.style.background) : undefined}
      />
    );
  }
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-[#0b0b12]">
      {status.media?.placeholder ? (
        <img
          src={status.media.placeholder}
          alt=""
          className="h-full w-full scale-110 object-cover opacity-45 blur-3xl"
        />
      ) : null}
    </div>
  );
}

/**
 * The next status's file, fetched ahead: its link, and the picture itself (or the start of the
 * video), so the next one shows at once.
 */
export function Preload({ status }: { status: Status | undefined }) {
  const mediaId = status?.media?.id ?? '';
  const link = useQuery({ ...mediaLinkQuery(mediaId), enabled: Boolean(mediaId) });
  if (!status || !link.data) return null;
  if (status.kind === 'image')
    return <img src={link.data.url} alt="" aria-hidden className="hidden" />;
  // biome-ignore lint/a11y/useMediaCaption: never shown, only fetched ahead
  return <video src={link.data.url} preload="auto" muted aria-hidden className="hidden" />;
}
