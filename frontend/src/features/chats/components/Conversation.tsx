import type { PublicProfile } from '@zuvo/protocol';
import { ArrowDown, Bookmark, Loader2, MessagesSquare } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ChatWallpaper } from '@/features/appearance/components/ChatWallpaper';
import { useSession } from '@/features/auth/session';
import { DisappearingRow } from '@/features/disappearing/DisappearingRow';
import { useWithoutExpired } from '@/features/disappearing/use-without-expired';
import { GroupInfoBody } from '@/features/groups/components/GroupInfoPane';
import { useGroupMembers, useKnownPeople } from '@/features/groups/queries';
import { ChatGallery } from '@/features/media/components/ChatGallery';
import { DropZone } from '@/features/media/components/DropZone';
import { MediaViewer, toViewerItem } from '@/features/media/components/MediaViewer';
import { PreviewSheet } from '@/features/media/components/PreviewSheet';
import { useSendMedia } from '@/features/media/use-send-media';
import { MentionJump } from '@/features/mentions/MentionJump';
import { MessageDialogs } from '@/features/messages/components/MessageDialogs';
import { MessageMenu } from '@/features/messages/components/MessageMenu';
import { ProfileCard } from '@/features/people/components/ProfileCard';
import { PinnedBar } from '@/features/pins/PinnedBar';
import { InChatSearchBar } from '@/features/search/components/InChatSearchBar';
import type { ChatRow } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { useIsDesktop } from '@/lib/hooks';
import { useConversationMessages } from '../queries';
import type { ChatSummary } from '../types';
import { useMarkRead } from '../use-mark-read';
import { toChatMessage, toChatSummary } from '../view';
import { ChatFooter, footerNotice } from './ChatFooter';
import { ChatInfoPane } from './ChatInfoPane';
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
  row: ChatRow;
  chatId: string;
  onOpenMedia: (mediaId: string) => void;
  person: PublicProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('conversation.info')} className="max-w-lg">
        <ProfileCard person={props.person} />
        <DisappearingRow chat={props.row} />
        <div className="flex h-80 flex-col">
          <ChatGallery chatId={props.chatId} onOpen={props.onOpenMedia} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** On a phone, chat info opens over the conversation. */
function MobileInfo(props: {
  row: ChatRow;
  chat: ChatSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenMedia: (mediaId: string) => void;
}) {
  const { t } = useTranslation();
  const { row, chat, open, onOpenChange, onOpenMedia } = props;
  if (chat.kind === 'group') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={t('conversation.info')} className="max-w-lg">
          <div className="flex max-h-[75vh] flex-col">
            <GroupInfoBody row={row} chat={chat} onOpenMedia={onOpenMedia} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (!row.otherUser) return null;
  return (
    <MobileProfile
      row={row}
      chatId={row.id}
      onOpenMedia={onOpenMedia}
      person={row.otherUser}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

/** The chat as the screens show it, and how far its messages go. */
function useConversationView(chat: ChatRow) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const saved = t('chats.saved');
  const unknown = t('chats.unknownPerson');
  const { rows: stored, ...older } = useConversationMessages(chat);
  // Disappearing messages leave the moment they expire, before the purge removes them.
  const rows = useWithoutExpired(stored, (row) => row.expiresAt);
  const members = useGroupMembers(chat);
  const people = useKnownPeople();
  const summary = useMemo(
    () => toChatSummary(chat, me, { saved, unknown }),
    [chat, me, saved, unknown],
  );
  const messages = useMemo(
    () => rows?.map((row) => toChatMessage(row, me, summary.name, chat, people, unknown)),
    [chat, me, people, rows, summary.name, unknown],
  );
  const newestSeq = useMemo(() => rows?.findLast((row) => row.seq !== null)?.seq ?? 0, [rows]);
  return { summary, messages, rows, newestSeq, older, members };
}

/** How many messages came after the reader last was at the bottom. */
function useNewMessageCount(newestSeq: number, atBottom: boolean): number {
  const seenSeq = useRef(newestSeq);
  if (atBottom) seenSeq.current = newestSeq;
  return atBottom ? 0 : Math.max(0, newestSeq - seenSeq.current);
}

export function Conversation({ chat }: { chat: ChatRow }) {
  const isDesktop = useIsDesktop();
  const [infoOpen, setInfoOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const { summary, messages, rows, newestSeq, older, members } = useConversationView(chat);
  const { loadingOlder, loadFailed, hasOlder, loadOlder } = older;
  const list = useRef<MessageListHandle>(null);
  const newCount = useNewMessageCount(newestSeq, atBottom);
  useMarkRead(chat, newestSeq, atBottom);
  const client = useSyncStore((state) => state.client);
  const jumpToLatest = useCallback(() => list.current?.scrollToBottom(), []);
  const showEmpty = messages?.length === 0 && !loadingOlder;
  const media = useSendMedia(chat.id);
  const [viewing, setViewing] = useState<string | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const localItems = useMemo(
    () =>
      (rows ?? []).flatMap((row) => {
        const item =
          row.seq === null ? null : toViewerItem({ ...row, id: row.id ?? '', seq: row.seq });
        return item ? [item] : [];
      }),
    [rows],
  );
  const canSend = footerNotice(summary) === null;

  return (
    <div className="flex h-full min-h-0">
      {canSend ? (
        <PreviewSheet
          picked={media.picked}
          maxBytes={media.maxBytes}
          onChange={media.setPicked}
          allowViewOnce={summary.kind !== 'saved'}
          onClose={media.clear}
          onSend={media.send}
        />
      ) : null}
      {viewing ? (
        <MediaViewer
          chatId={chat.id}
          localItems={localItems}
          startId={viewing}
          onClose={closeViewer}
        />
      ) : null}
      <DropZone
        className="flex min-w-0 flex-1 flex-col"
        onFiles={canSend ? media.addFiles : undefined}
      >
        <h2 className="sr-only">{summary.name}</h2>
        <MessageMenu chat={summary} />
        <MessageDialogs chat={summary} />
        <ConversationHeader
          chat={summary}
          showBack={!isDesktop}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((open) => !open)}
          members={members}
        />
        <PinnedBar chat={chat} />
        <InChatSearchBar chatId={chat.id} />
        <ChatWallpaper wallpaper={chat.wallpaper} className="relative min-h-0 flex-1">
          {showEmpty ? <EmptyChat saved={summary.kind === 'saved'} name={summary.name} /> : null}
          {messages && !showEmpty ? (
            <MessageList
              ref={list}
              chatName={summary.name}
              isGroup={summary.kind === 'group'}
              chatId={chat.id}
              messages={messages}
              onReachTop={hasOlder ? loadOlder : undefined}
              onAtBottomChange={setAtBottom}
              onRetry={(clientMsgId) => void client?.retry(clientMsgId)}
              onOpenMedia={setViewing}
            />
          ) : null}
          <OlderStatus loading={loadingOlder} failed={loadFailed} onRetry={loadOlder} />
          {atBottom ? null : <JumpToLatest count={newCount} onJump={jumpToLatest} />}
          <MentionJump key={chat.id} chat={chat} />
        </ChatWallpaper>
        <ChatFooter chat={summary} onSent={jumpToLatest} onFiles={media.addFiles} />
      </DropZone>
      {infoOpen && isDesktop ? (
        <ChatInfoPane
          chat={summary}
          row={chat}
          onClose={() => setInfoOpen(false)}
          onOpenMedia={setViewing}
        />
      ) : null}
      {isDesktop ? null : (
        <MobileInfo
          row={chat}
          chat={summary}
          open={infoOpen}
          onOpenChange={setInfoOpen}
          onOpenMedia={setViewing}
        />
      )}
    </div>
  );
}
