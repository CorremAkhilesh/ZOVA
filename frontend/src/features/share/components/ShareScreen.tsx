import { useNavigate } from '@tanstack/react-router';
import { brand } from '@zuvo/config';
import { Send, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalDb } from '@/features/chats/queries';
import { useAppConfig } from '@/features/media/use-app-config';
import { useSyncStore } from '@/features/sync/store';
import { prefillDraft, SHARE_CHATS_MAX, sendSharedFiles, tooLarge } from '../send-share';
import { sharedText, useSharedItem } from '../use-shared-item';
import { ShareChatPicker } from './ShareChatPicker';
import { SharePreview } from './SharePreview';

function Notice({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-xl border bg-surface p-4 text-sm">
      {text}
    </p>
  );
}

/**
 * /share: what another app shared ("Share to Zuvo"). Pick up to five chats, add a caption and send:
 * files go through the usual outbox (resumable, with progress in each chat). Text or a link alone
 * waits in one chat's message box instead, ready to edit.
 */
export function ShareScreen(props: { id?: string | undefined; retry: boolean; error: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const db = useLocalDb();
  const config = useAppConfig();
  const { state, discard } = useSharedItem(props.id);
  const [chatIds, setChatIds] = useState<string[]>([]);
  const [caption, setCaption] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const close = async () => {
    await discard();
    await navigate({ to: '/chats' });
  };

  const header = (
    <div className="flex items-center gap-2">
      <h1 className="flex-1 text-xl font-semibold">{t('share.title', { brand: brand.name })}</h1>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('share.cancel')}
        onClick={() => void close()}
      >
        <X className="size-5" aria-hidden />
      </Button>
    </div>
  );
  const page = (body: React.ReactNode) => (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {header}
        {body}
      </div>
    </div>
  );

  if (props.retry || props.error) {
    return page(
      <Notice text={t(props.retry ? 'share.retry' : 'share.failed', { brand: brand.name })} />,
    );
  }
  if (state.status === 'loading') {
    return page(
      <div role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton className="h-16 w-full" />
      </div>,
    );
  }
  if (state.status === 'missing') return page(<Notice text={t('share.nothing')} />);

  const { item } = state;
  const files = item.files;
  const text = sharedText(item);
  const textOnly = files.length === 0;
  const big = new Set(tooLarge(files, config?.media.maxFileBytes ?? null));
  const captionValue = caption ?? text;

  const send = async () => {
    const client = useSyncStore.getState().client;
    const [first] = chatIds;
    if (!first) return;
    setSending(true);
    try {
      if (textOnly) {
        if (db) await prefillDraft(db, first, text);
      } else {
        if (!client) throw new Error('offline');
        await sendSharedFiles({ client, chatIds, files, caption: captionValue });
        toast.success(t('share.sent', { count: chatIds.length }));
      }
      await discard();
      await navigate(
        chatIds.length === 1
          ? { to: '/chats/$chatId', params: { chatId: first } }
          : { to: '/chats' },
      );
    } catch {
      toast.error(t('share.sendFailed'));
      setSending(false);
    }
  };

  return page(
    <>
      <SharePreview item={item} tooLarge={big} maxBytes={config?.media.maxFileBytes ?? null} />
      <ShareChatPicker
        selected={chatIds}
        onChange={setChatIds}
        max={textOnly ? 1 : SHARE_CHATS_MAX}
      />
      {textOnly ? null : (
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('share.caption')}</span>
          <textarea
            value={captionValue}
            onChange={(event) => setCaption(event.target.value)}
            rows={2}
            maxLength={4096}
            className="w-full resize-y rounded-xl border bg-surface px-3 py-2 text-sm"
          />
        </label>
      )}
      <div className="sticky bottom-0 bg-background/90 py-2 backdrop-blur">
        <Button
          size="lg"
          className="w-full"
          disabled={chatIds.length === 0 || sending || big.size > 0}
          onClick={() => void send()}
        >
          <Send className="size-4" aria-hidden />
          {textOnly ? t('share.openChat') : t('share.send', { count: chatIds.length })}
        </Button>
      </div>
    </>,
  );
}
