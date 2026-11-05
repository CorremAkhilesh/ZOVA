import { CloudOff, Play, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/features/chats/types';
import { useSyncStore } from '@/features/sync/store';
import { AudioBubble } from '@/features/voice/components/AudioBubble';
import { VoiceBubble } from '@/features/voice/components/VoiceBubble';
import { cn } from '@/lib/utils';
import { formatDuration } from '../process';
import { useLocalPreview, useThumbnail } from '../use-thumbnail';
import { DocumentCard } from './DocumentCard';

/** Keeps a bubble to a sensible size whatever the picture's shape. */
const MAX_BOX_PX = 320;

function boxStyle(message: ChatMessage) {
  const { width, height } = message.media ?? {};
  const ratio = width && height ? width / height : 4 / 3;
  return { aspectRatio: String(Math.min(2.2, Math.max(0.6, ratio))), maxWidth: MAX_BOX_PX };
}

function NotAvailable() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/90 p-2 text-center text-xs text-text-muted">
      <CloudOff className="size-5" aria-hidden />
      {t('media.notAvailable')}
    </div>
  );
}

/** How far the upload is, with a way to stop it. */
export function UploadRing({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const client = useSyncStore((state) => state.client);
  const size = message.media?.size ?? 1;
  const fraction = Math.min(1, (message.uploadedBytes ?? 0) / size);
  const circumference = 2 * Math.PI * 18;
  return (
    <button
      type="button"
      aria-label={t('media.cancelUpload', { percent: Math.round(fraction * 100) })}
      onClick={(event) => {
        event.stopPropagation();
        if (message.clientMsgId) void client?.cancelMedia(message.clientMsgId);
      }}
      className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white"
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className="transition-[stroke-dashoffset] motion-reduce:transition-none"
        />
      </svg>
      <X className="size-4" aria-hidden />
    </button>
  );
}

function VideoBadges({ duration }: { duration: number | null }) {
  return (
    <>
      <span className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white">
        <Play className="size-5" aria-hidden />
      </span>
      {duration !== null ? (
        <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 text-[11px] text-white tabular-nums">
          {formatDuration(duration)}
        </span>
      ) : null}
    </>
  );
}

/** Blurred at once, then the picture, or a notice if it is gone. */
function Picture(props: {
  placeholder: string | null;
  source: string | null;
  missing: boolean;
  onError: () => void;
}) {
  return (
    <>
      {props.placeholder ? (
        <img
          src={props.placeholder}
          alt=""
          className="absolute inset-0 size-full scale-110 object-cover blur-md"
        />
      ) : null}
      {props.source && !props.missing ? (
        <img
          src={props.source}
          alt=""
          loading="lazy"
          onError={props.onError}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {props.missing ? <NotAvailable /> : null}
    </>
  );
}

interface VisualProps {
  message: ChatMessage;
  onOpen: ((mediaId: string) => void) | undefined;
  /** "+3" over the last visible album item. */
  more?: number;
  fill?: boolean;
}

/** A photo or a video's poster: blurred at once, sharp when the thumbnail arrives. */
export function MediaVisual({ message, onOpen, more = 0, fill = false }: VisualProps) {
  const { t, i18n } = useTranslation();
  const { media } = message;
  const uploading = message.status === 'pending' && !media?.id;
  const thumbnail = useThumbnail(media?.id || undefined, Boolean(media?.hasThumbnail));
  const local = useLocalPreview(message.clientMsgId, uploading);
  const [failed, setFailed] = useState(false);
  if (!media) return null;
  const video = media.kind === 'video';
  const source = thumbnail.url ?? local;
  const missing = thumbnail.missing || failed;
  const label = t(video ? 'media.openVideo' : 'media.openPhoto', {
    name: media.name,
    time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(message.at),
  });

  return (
    <div
      style={fill ? undefined : boxStyle(message)}
      className={cn(
        'relative block w-full overflow-hidden rounded-xl bg-background',
        fill && 'h-full',
      )}
    >
      <button
        type="button"
        aria-label={label}
        disabled={!media.id || missing}
        onClick={() => media.id && onOpen?.(media.id)}
        className="absolute inset-0 block size-full"
      >
        <Picture
          placeholder={media.placeholder}
          source={source}
          missing={missing}
          onError={() => setFailed(true)}
        />
        {video && !uploading && !missing ? <VideoBadges duration={media.duration} /> : null}
        {more > 0 ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
            +{more}
          </span>
        ) : null}
      </button>
      {uploading ? <UploadRing message={message} /> : null}
    </div>
  );
}

const VISIBLE_IN_ALBUM = 4;

/** Up to four items, the last saying how many more there are. */
export function AlbumGrid({
  items,
  onOpen,
}: {
  items: ChatMessage[];
  onOpen: ((mediaId: string) => void) | undefined;
}) {
  const visible = items.slice(0, VISIBLE_IN_ALBUM);
  const more = items.length - visible.length;
  return (
    <div
      className={cn(
        'grid w-72 max-w-full gap-0.5 overflow-hidden rounded-xl',
        visible.length > 1 && 'grid-cols-2',
      )}
    >
      {visible.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            'aspect-square',
            visible.length === 3 && index === 0 && 'col-span-2 aspect-[2/1]',
          )}
        >
          <MediaVisual
            message={item}
            onOpen={onOpen}
            fill
            more={index === visible.length - 1 ? more : 0}
          />
        </div>
      ))}
    </div>
  );
}

/** Whatever a media message shows above its caption. */
export function MessageMedia({
  message,
  onOpen,
}: {
  message: ChatMessage;
  onOpen: ((mediaId: string) => void) | undefined;
}) {
  if (message.media?.kind === 'document') return <DocumentCard message={message} />;
  if (message.media?.kind === 'voice') return <VoiceBubble message={message} />;
  if (message.media?.kind === 'audio') return <AudioBubble message={message} />;
  return (
    <div className="w-72 max-w-full">
      <MediaVisual message={message} onOpen={onOpen} />
    </div>
  );
}
