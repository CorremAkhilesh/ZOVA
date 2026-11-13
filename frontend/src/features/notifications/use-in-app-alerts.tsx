import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { Message, PushSettings } from '@zuvo/protocol';
import { MessageCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { previewText } from '@/features/chats/view';
import { toPlainText } from '@/features/formatting/parse';
import { useLockStore } from '@/features/lock/store';
import { pollPreview } from '@/features/polls/preview';
import { shouldAlert } from '@/features/quiet-hours/quiet';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { i18n } from '@/lib/i18n';
import { type InAppAlert, inAppAlert } from './alert-rules';
import { usePushState } from './api';
import { playChime } from './sound';
import { currentWindowState, onIncomingMessage } from './window-state';

const TOAST_MS = 5000;
/** A brand-new chat arrives with its first message: give the sync a moment to store it. */
const CHAT_WAIT_MS = 500;

/** The chat open in this tab, from the URL. */
export const openChatIdFrom = (pathname: string) => /^\/chats\/([^/]+)/.exec(pathname)?.[1] ?? null;

/** One line for a message: its text, or "📷 Photo", "📄 report.pdf"… */
export function messagePreview(message: Message): string {
  const labels = {
    photo: i18n.t('media.photo'),
    video: i18n.t('media.video'),
    voice: i18n.t('voice.preview'),
  };
  if (message.type === 'text')
    return toPlainText(message.text ?? '')
      .replace(/\s+/gu, ' ')
      .trim();
  if (message.type === 'poll') return pollPreview(message.poll?.question ?? message.text ?? '');
  if (message.type === 'voice') return `🎤 ${labels.voice}`;
  const caption = message.viewOnce ? '' : (message.text ?? '');
  const preview =
    message.type === 'document' || message.type === 'audio' ? (message.media?.name ?? '') : caption;
  return previewText({ type: message.type, preview }, labels);
}

function AlertToast({ alert, onOpen }: { alert: InAppAlert; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-2xl border bg-surface p-3 text-left shadow-lg hover:bg-background"
    >
      <span className="rounded-full bg-brand-subtle p-2 text-brand-text">
        <MessageCircle className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{alert.title}</span>
        {alert.body ? (
          <span className="block truncate text-sm text-text-muted">{alert.body}</span>
        ) : null}
      </span>
    </button>
  );
}

interface Live {
  openChatId: string | null;
  settings: PushSettings | undefined;
}

async function storedChat(db: LocalDb, chatId: string) {
  const lookup = () => db.chats.get(chatId).catch(() => undefined);
  const chat = await lookup();
  if (chat) return chat;
  await new Promise((resolve) => setTimeout(resolve, CHAT_WAIT_MS));
  return lookup();
}

/** The toast for a new message, if it gets one (see alert-rules.ts). */
async function alertFor(message: Message, me: string, live: () => Live) {
  if (message.senderId === null || message.senderId === me) return null;
  const db = getUserDb(me);
  const chat = await storedChat(db, message.chatId);
  const sender = await db.profiles.get(message.senderId).catch(() => undefined);
  const { openChatId, settings } = live();
  const { visible, focused } = currentWindowState();
  return inAppAlert(message, {
    me,
    chat,
    senderName: sender?.displayName ?? null,
    openChatId,
    windowActive: visible && focused,
    appLocked: useLockStore.getState().appLocked,
    showPreview: settings?.showPreview ?? true,
    quietAllows: (candidate) => shouldAlert(candidate),
    preview: messagePreview,
    newMessage: i18n.t('notifications.newMessage'),
  });
}

/** A toast (and the chime, if on) for new messages in other chats while the app is in front. */
export function useInAppAlerts(): void {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const settings = usePushState().data?.settings;
  const live = useRef<Live>({ openChatId: openChatIdFrom(pathname), settings });
  live.current = { openChatId: openChatIdFrom(pathname), settings };

  useEffect(
    () =>
      onIncomingMessage((message, me) => {
        void alertFor(message, me, () => live.current).then((alert) => {
          if (!alert) return;
          const id = `message:${alert.chatId}`;
          const open = () => {
            toast.dismiss(id);
            void navigate({ to: '/chats/$chatId', params: { chatId: alert.chatId } });
          };
          toast.custom(() => <AlertToast alert={alert} onOpen={open} />, {
            id,
            duration: TOAST_MS,
          });
          if (live.current.settings?.sound ?? true) playChime();
        });
      }),
    [navigate],
  );
}
