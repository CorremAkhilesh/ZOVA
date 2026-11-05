import { useQuery } from '@tanstack/react-query';
import type { Message } from '@zuvo/protocol';
import { ChevronLeft, ChevronRight, CloudOff, Download, Minus, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { mediaApi, mediaContentUrl } from '../api';
import { useZoomPan } from '../use-zoom-pan';

/** The viewer is always on black, in either theme. */
const ON_BLACK = 'text-white hover:bg-white/15 hover:text-white';

export interface ViewerItem {
  mediaId: string;
  kind: 'image' | 'video';
  name: string;
  caption: string | null;
  seq: number;
}

export function toViewerItem(message: Message): ViewerItem | null {
  const { media } = message;
  if (!media?.id || (media.kind !== 'image' && media.kind !== 'video')) return null;
  return {
    mediaId: media.id,
    kind: media.kind,
    name: media.name,
    caption: message.text,
    seq: message.seq,
  };
}

/** Everything from the server plus what only this device has yet, in chat order. */
export function mergeViewerItems(local: ViewerItem[], remote: ViewerItem[]): ViewerItem[] {
  const byId = new Map([...remote, ...local].map((item) => [item.mediaId, item]));
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

const FRESH_LINK_MS = 30_000;

function ViewerVideo({ mediaId, onMissing }: { mediaId: string; onMissing: () => void }) {
  // A signed link: some browsers leave cookies off the requests a video player makes.
  const { data, isError, refetch } = useQuery({
    queryKey: ['media-link', mediaId],
    queryFn: () => mediaApi.link(mediaId, false),
    staleTime: 10 * 60_000,
    retry: false,
  });
  useEffect(() => {
    if (isError) onMissing();
  }, [isError, onMissing]);
  const renewedAt = useRef(0);
  const resumeAt = useRef<number | null>(null);
  if (!data) return null;

  // Links expire, and a player notices on its next request, such as a seek. A new link that fails
  // straight away means the file itself is gone.
  function onVideoError(video: HTMLVideoElement) {
    if (Date.now() - renewedAt.current < FRESH_LINK_MS) return onMissing();
    renewedAt.current = Date.now();
    resumeAt.current = video.currentTime;
    const before = data?.url;
    void refetch().then((fresh) => {
      // Asked again within the same second: the same link, so nothing would reload by itself.
      if (fresh.data?.url === before) video.load();
    });
  }

  return (
    // biome-ignore lint/a11y/useMediaCaption: people's own videos come with no captions
    <video
      src={data.url}
      controls
      autoPlay
      playsInline
      onError={(event) => onVideoError(event.currentTarget)}
      onLoadedMetadata={(event) => {
        if (resumeAt.current !== null) event.currentTarget.currentTime = resumeAt.current;
        resumeAt.current = null;
      }}
      className="max-h-full max-w-full"
    />
  );
}

interface MediaViewerProps {
  chatId: string;
  /** What this device already has. The server fills in the rest of the chat. */
  localItems: ViewerItem[];
  startId: string;
  onClose: () => void;
}

/** Full screen, one item at a time: arrows or swipes to move, Esc or the back gesture to leave. */
export function MediaViewer({ chatId, localItems, startId, onClose }: MediaViewerProps) {
  const { t } = useTranslation();
  const gallery = useQuery({
    queryKey: ['chat-gallery', chatId, 'media', 'viewer'],
    queryFn: () => mediaApi.gallery(chatId, 'media', undefined),
    staleTime: 30_000,
  });
  const items = useMemo(() => {
    const remote = (gallery.data?.items ?? []).flatMap((message) => {
      const item = toViewerItem(message);
      return item ? [item] : [];
    });
    return mergeViewerItems(localItems, remote);
  }, [gallery.data, localItems]);

  const [currentId, setCurrentId] = useState(startId);
  const [missing, setMissing] = useState(false);
  const index = items.findIndex((item) => item.mediaId === currentId);
  const item = items[index];

  const move = (direction: 1 | -1) => {
    const next = items[index + direction];
    if (!next) return;
    setCurrentId(next.mediaId);
    setMissing(false);
    zoomPan.reset();
  };
  const zoomPan = useZoomPan(move);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') move(1);
      else if (event.key === 'ArrowLeft') move(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The back gesture closes the viewer rather than leaving the chat. Going back is deferred because
  // development's StrictMode unmounts and remounts straight away, which must not close it.
  const closedByBack = useRef(false);
  const pushed = useRef(false);
  const goingBack = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(goingBack.current);
    if (!pushed.current) {
      pushed.current = true;
      window.history.pushState({ ...window.history.state, mediaViewer: true }, '');
    }
    const onPop = () => {
      closedByBack.current = true;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      goingBack.current = setTimeout(() => {
        if (!closedByBack.current) window.history.back();
      }, 0);
    };
  }, [onClose]);

  async function download() {
    if (!item) return;
    const { url } = await mediaApi.link(item.mediaId, true);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={item?.name ?? t('media.viewerTitle')}
        hideClose
        hideTitle
        className="inset-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 text-white"
      >
        <div className="flex items-center justify-end gap-1 p-2">
          {item?.kind === 'image' ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={ON_BLACK}
                aria-label={t('media.zoomOut')}
                onClick={() => zoomPan.apply(zoomPan.zoom / 1.5)}
              >
                <Minus className="size-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={ON_BLACK}
                aria-label={t('media.zoomIn')}
                onClick={() => zoomPan.apply(zoomPan.zoom * 1.5)}
              >
                <Plus className="size-5" />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className={ON_BLACK}
            aria-label={t('media.download')}
            onClick={() => void download()}
          >
            <Download className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={ON_BLACK}
            aria-label={t('media.close')}
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>
        <div
          {...(item?.kind === 'image' ? zoomPan.handlers : {})}
          className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
        >
          {index > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('media.previous')}
              onClick={() => move(-1)}
              className={`${ON_BLACK} absolute left-2 z-10 hidden md:inline-flex`}
            >
              <ChevronLeft className="size-6" />
            </Button>
          ) : null}
          {missing || !item ? (
            <p className="flex flex-col items-center gap-2 text-sm">
              <CloudOff className="size-8" aria-hidden />
              {t('media.notAvailable')}
            </p>
          ) : item.kind === 'video' ? (
            <ViewerVideo
              key={item.mediaId}
              mediaId={item.mediaId}
              onMissing={() => setMissing(true)}
            />
          ) : (
            <img
              key={item.mediaId}
              src={mediaContentUrl(item.mediaId)}
              alt={item.caption ?? item.name}
              draggable={false}
              onError={() => setMissing(true)}
              style={{
                transform: `translate(${zoomPan.pan.x}px, ${zoomPan.pan.y}px) scale(${zoomPan.zoom})`,
              }}
              className="max-h-full max-w-full object-contain select-none"
            />
          )}
          {index >= 0 && index < items.length - 1 ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('media.next')}
              onClick={() => move(1)}
              className={`${ON_BLACK} absolute right-2 z-10 hidden md:inline-flex`}
            >
              <ChevronRight className="size-6" />
            </Button>
          ) : null}
        </div>
        <p className="min-h-10 px-4 py-2 text-center text-sm">
          {item?.caption ?? ''}
          {items.length > 1 ? (
            <span className="block text-xs opacity-70">
              {t('media.position', { index: index + 1, total: items.length })}
            </span>
          ) : null}
        </p>
      </DialogContent>
    </Dialog>
  );
}
