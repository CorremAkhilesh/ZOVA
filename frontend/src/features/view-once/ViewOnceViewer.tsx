import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';

/**
 * A photo is fetched into memory (never the HTTP cache or the thumbnail store) and its object URL
 * revoked on close; a video streams from its short-lived link, which the service worker never
 * caches (/v1 is on its never-cache list). Nothing here offers download, forward or share.
 */
function usePhotoBlob(url: string, onFail: () => void) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    void fetch(url, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch(() => {
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [onFail, url]);
  return objectUrl;
}

function Photo({ url, onFail }: { url: string; onFail: () => void }) {
  const { t } = useTranslation();
  const source = usePhotoBlob(url, onFail);
  if (!source) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-white/80">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('viewOnce.loading')}
      </p>
    );
  }
  return (
    <img
      src={source}
      alt=""
      draggable={false}
      onError={onFail}
      className="max-h-full max-w-full select-none object-contain"
    />
  );
}

export function ViewOnceViewer(props: {
  url: string;
  kind: 'image' | 'video';
  onClose: () => void;
  /** The file could not be shown: it is gone, so the bubble says "Opened" rather than break. */
  onFail: () => void;
}) {
  const { t } = useTranslation();
  const { url, kind, onClose, onFail } = props;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={t(kind === 'video' ? 'viewOnce.viewerVideo' : 'viewOnce.viewerPhoto')}
        description={t('viewOnce.screenshotNote')}
        // No "Save image as…" or "Save video as…" from the browser's menu.
        onContextMenu={(event) => event.preventDefault()}
        className="h-[100dvh] max-h-none w-screen max-w-none rounded-none border-0 bg-black text-white [&_button]:text-white [&_p]:text-white/80"
      >
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {kind === 'image' ? (
            <Photo url={url} onFail={onFail} />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: people's own videos come with no captions
            <video
              src={url}
              controls
              autoPlay
              playsInline
              disablePictureInPicture
              controlsList="nodownload noremoteplayback"
              onError={onFail}
              className="max-h-full max-w-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
