import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocalDb } from '@/features/chats/queries';
import { type ChatMessage, ME } from '@/features/chats/types';
import { UploadRing } from '@/features/media/components/MessageMedia';
import { cn } from '@/lib/utils';
import { isAlreadyOpened, viewOnceApi } from './api';
import { OnceIcon } from './OnceIcon';
import { ViewOnceViewer } from './ViewOnceViewer';

type Open = { url: string; kind: 'image' | 'video' };

/** Opening counts at once on the server, so this device remembers it straight away too. */
function useOpen(message: ChatMessage) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Open | null>(null);
  const [openedHere, setOpenedHere] = useState(false);
  const markOpened = useCallback(() => {
    setOpenedHere(true);
    void db?.messages.update(message.id, { viewOnceOpened: true }).catch(() => undefined);
  }, [db, message.id]);
  const open = async () => {
    if (!message.serverId || busy) return;
    setBusy(true);
    try {
      const { url } = await viewOnceApi.open(message.chatId, message.serverId);
      setViewing({ url, kind: message.media?.kind === 'video' ? 'video' : 'image' });
      markOpened();
    } catch (error) {
      if (isAlreadyOpened(error)) {
        markOpened();
        toast(t('viewOnce.alreadyOpened'));
      } else {
        toast.error(t('viewOnce.openFailed'));
      }
    } finally {
      setBusy(false);
    }
  };
  const close = useCallback(() => {
    setViewing(null);
    markOpened();
  }, [markOpened]);
  return { busy, viewing, openedHere, open, close };
}

const BOX = 'relative flex w-56 max-w-full items-center gap-3 rounded-xl px-2 py-2 text-left';

/**
 * No preview, ever: an icon, "Photo" or "Video", and "View once" or "Opened". Only someone else's,
 * not yet opened, can be tapped. My own shows the same, and is never opened from here.
 */
export function ViewOnceBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const { busy, viewing, openedHere, open, close } = useOpen(message);
  const mine = message.authorId === ME;
  const opened = message.viewOnceOpened === true || openedHere;
  const video = message.media?.kind === 'video';
  const what = t(video ? 'viewOnce.video' : 'viewOnce.photo');
  const uploading = mine && message.status === 'pending' && !message.media?.id;
  const content = (
    <>
      {busy ? (
        <Loader2 className="size-7 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <OnceIcon className="size-7 text-xs" faded={opened} />
      )}
      <span className="min-w-0">
        <span className="block font-medium">{what}</span>
        <span className="block text-xs opacity-80">
          {opened ? t('viewOnce.opened') : t('viewOnce.label')}
        </span>
      </span>
    </>
  );
  const canOpen = !mine && !opened && Boolean(message.serverId);
  return (
    <>
      {canOpen ? (
        <button
          type="button"
          aria-label={t(video ? 'viewOnce.openVideo' : 'viewOnce.openPhoto')}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            void open();
          }}
          className={cn(BOX, 'hover:bg-black/5')}
        >
          {content}
        </button>
      ) : (
        <div
          className={cn(BOX, uploading && 'min-h-14')}
          data-view-once={opened ? 'opened' : 'unopened'}
        >
          {content}
          {uploading ? <UploadRing message={message} /> : null}
        </div>
      )}
      {viewing ? (
        <ViewOnceViewer url={viewing.url} kind={viewing.kind} onClose={close} onFail={close} />
      ) : null}
    </>
  );
}
