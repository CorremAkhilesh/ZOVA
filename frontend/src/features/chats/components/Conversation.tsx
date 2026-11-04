import type { PublicProfile } from '@zuvo/protocol';
import { ArrowDown, Bookmark, Loader2, MessagesSquare } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useSession } from '@/features/auth/session';
import { ProfileCard } from '@/features/people/components/ProfileCard';
import type { ChatRow } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { useIsDesktop } from '@/lib/hooks';
import { useConversationMessages } from '../queries';
import { useMarkRead } from '../use-mark-read';
import { toChatMessage, toChatSummary } from '../view';
import { ChatInfoPane } from './ChatInfoPane';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
import { MessageList, type MessageListHandle } from './MessageList';

function EmptyChat({ saved, name }: { saved: boolean; name: string }) {
  const { t } = useTranslation();
  const Icon = saved ? Bookmark : MessagesSquare;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon className="size-8 text-text-muted" aria-hidden />
      <p className="max-w-xs text-sm text-text-muted">
        {saved ? t('conversation.savedEmpty') : t('conversation.emptyChat', { name })}
      </p>
    </div>
  );
}

const PILL =
  'glass absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1 text-xs text-text-muted shadow-sm';

function OlderStatus(props: { loading: boolean; failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (props.loading) {
    return (
      <p role="status" className={PILL}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('conversation.loadingOlder')}
      </p>
    );
  }
  if (!props.failed) return null;
  return (
    <div role="alert" className={PILL}>
      {t('conversation.olderFailed')}
      <button type="button" className="font-semibold text-brand-text" onClick={props.onRetry}>
        {t('errors.retry')}
      </button>
    </div>
  );
}

function JumpToLatest({ count, onJump }: { count: number; onJump: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      onClick={onJump}
      className="absolute right-4 bottom-4 rounded-full shadow-md"
    >
      <ArrowDown className="size-4" aria-hidden />
      {t('conversation.jumpToLatest')}
      {count > 0 ? (
        <span className="rounded-full bg-brand px-1.5 text-xs text-brand-foreground">{count}</span>
      ) : null}
    </Button>
  );
}

function MobileProfile(props: {
  person: PublicProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('conversation.info')} className="max-w-lg">
        <ProfileCard person={props.person} />
      </DialogContent>
    </Dialog>
  );
}

export function Conversation({ chat }: { chat: ChatRow }) {
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const [infoOpen, setInfoOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const { rows, loadingOlder, loadFailed, hasOlder, loadOlder } = useConversationMessages(chat);
  const list = useRef<MessageListHandle>(null);
  const saved = t('chats.saved');
  const unknown = t('chats.unknownPerson');
  const summary = useMemo(
    () => toChatSummary(chat, me, { saved, unknown }),
    [chat, me, saved, unknown],
  );
  const messages = useMemo(
    () => rows?.map((row) => toChatMessage(row, me, summary.name)),
    [me, rows, summary.name],
  );

  const newestSeq = useMemo(() => rows?.findLast((row) => row.seq !== null)?.seq ?? 0, [rows]);

  // Everything up to here has been seen; the jump button counts what came after.
  const seenSeq = useRef(newestSeq);
  if (atBottom) seenSeq.current = newestSeq;
  const newCount = atBottom ? 0 : Math.max(0, newestSeq - seenSeq.current);

  useMarkRead(chat, newestSeq, atBottom);
  const client = useSyncStore((state) => state.client);

  const jumpToLatest = useCallback(() => list.current?.scrollToBottom(), []);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="sr-only">{summary.name}</h2>
        <ConversationHeader
          chat={summary}
          showBack={!isDesktop}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((open) => !open)}
        />
        <div className="chat-wallpaper relative min-h-0 flex-1">
          {messages === undefined ? null : messages.length === 0 && !loadingOlder ? (
            <EmptyChat saved={summary.kind === 'saved'} name={summary.name} />
          ) : (
            <MessageList
              ref={list}
              chatName={summary.name}
              isGroup={summary.kind === 'group'}
              messages={messages}
              onReachTop={hasOlder ? loadOlder : undefined}
              onAtBottomChange={setAtBottom}
              onRetry={(clientMsgId) => void client?.retry(clientMsgId)}
            />
          )}
          <OlderStatus loading={loadingOlder} failed={loadFailed} onRetry={loadOlder} />
          {atBottom ? null : <JumpToLatest count={newCount} onJump={jumpToLatest} />}
        </div>
        {summary.deactivated ? (
          <p className="glass border-t px-4 py-3 text-center text-sm text-text-muted">
            {t('people.deactivated')}
          </p>
        ) : (
          <Composer chatId={chat.id} onSent={jumpToLatest} />
        )}
      </div>
      {infoOpen && isDesktop ? (
        <ChatInfoPane chat={summary} onClose={() => setInfoOpen(false)} />
      ) : null}
      {!isDesktop && chat.otherUser ? (
        <MobileProfile person={chat.otherUser} open={infoOpen} onOpenChange={setInfoOpen} />
      ) : null}
    </div>
  );
}
