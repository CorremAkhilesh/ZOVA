import { STATUS_VIDEO_MAX_SECONDS } from '@zuvo/protocol';
import { Camera } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLocalDb } from '@/features/chats/queries';
import { type PreparedFile, prepareFile } from '@/features/media/process';
import { toUploadInfo } from '@/features/media/use-send-media';
import { uploadNow } from '@/features/scheduled/schedule-media';
import { ApiClientError } from '@/lib/api-client';
import { patchFeed, refreshStatuses, statusApi } from '../feed';

/** The status that a picked photo or video would become, with its caption. */
function MediaPreview(props: { prepared: PreparedFile; onClose: () => void }) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const { prepared } = props;
  const [caption, setCaption] = useState('');
  const [sent, setSent] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(prepared.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [prepared.file]);

  const post = async () => {
    setSent(0);
    try {
      const info = toUploadInfo(prepared);
      // The same resumable upload as chat files, in the foreground.
      const media = await uploadNow(
        { file: prepared.file, info, poster: prepared.poster },
        (bytes) => setSent(bytes / Math.max(info.size, 1)),
      );
      const kind = prepared.kind === 'video' ? 'video' : 'image';
      const { status } = await statusApi.create({
        kind,
        mediaId: media.id,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
      });
      if (db) {
        await patchFeed(db, (feed) => ({ ...feed, mine: [...feed.mine, status] }));
        void refreshStatuses(db);
      }
      toast.success(t('updates.posted'));
      props.onClose();
    } catch (error) {
      const code = error instanceof ApiClientError ? error.apiError?.code : undefined;
      toast.error(
        t(code === 'STATUS_VIDEO_TOO_LONG' ? 'updates.videoTooLong' : 'updates.postFailed'),
      );
      setSent(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open || sent !== null ? undefined : props.onClose())}>
      <DialogContent
        title={t(prepared.kind === 'video' ? 'updates.newVideo' : 'updates.newPhoto')}
        className="max-w-md"
      >
        <div className="grid max-h-[55vh] place-items-center overflow-hidden rounded-xl bg-black">
          {url && prepared.kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: a preview of the person's own clip
            <video src={url} controls playsInline className="max-h-[55vh] max-w-full" />
          ) : url ? (
            <img
              src={url}
              alt={t('updates.preview')}
              className="max-h-[55vh] max-w-full object-contain"
            />
          ) : null}
        </div>
        <label className="sr-only" htmlFor="status-caption">
          {t('updates.caption')}
        </label>
        <input
          id="status-caption"
          value={caption}
          maxLength={1024}
          placeholder={t('updates.caption')}
          onChange={(event) => setCaption(event.target.value)}
          className="h-11 w-full rounded-xl border bg-surface px-3 text-[15px] outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        {sent !== null ? (
          <progress
            aria-label={t('updates.uploading')}
            value={sent}
            max={1}
            className="h-2 w-full accent-brand"
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={sent !== null} onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={sent !== null} onClick={() => void post()}>
            {t('updates.post')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The camera button: pick (or take) a photo or a video of up to 60 seconds. A longer video is
 * refused with a clear message rather than cut.
 */
export function MediaStatusPicker() {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const ready = await prepareFile(file, false);
      if (ready.kind !== 'image' && ready.kind !== 'video') {
        toast.error(t('updates.photoOrVideo'));
        return;
      }
      if (ready.kind === 'video' && (ready.duration ?? 0) > STATUS_VIDEO_MAX_SECONDS + 0.5) {
        toast.error(t('updates.videoTooLong'));
        return;
      }
      setPrepared(ready);
    } catch {
      toast.error(t('updates.postFailed'));
    }
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        hidden
        data-testid="pick-status-media"
        onChange={(event) => void choose(event)}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('updates.newMedia')}
        onClick={() => input.current?.click()}
      >
        <Camera className="size-5" aria-hidden />
      </Button>
      {prepared ? <MediaPreview prepared={prepared} onClose={() => setPrepared(null)} /> : null}
    </>
  );
}
