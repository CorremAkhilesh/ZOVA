import { FORWARD_MAX_CHATS, type PublicProfile } from '@zuvo/protocol';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/auth/session';
import { useChats } from '@/features/chats/queries';
import type { ChatMessage, ChatSummary } from '@/features/chats/types';
import { toChatSummary } from '@/features/chats/view';
import { useKnownPeople } from '@/features/groups/queries';
import { groupAbilities } from '@/features/groups/rules';
import { useSyncStore } from '@/features/sync/store';
import { cn } from '@/lib/utils';
import { uuidv7 } from '@/lib/uuid';
import { canDeleteForEveryone, deletesAsAdmin, forwardAction, targetOf } from '../rules';
import { useMessageUi } from '../store';

const mayWrite = (chat: ChatSummary) =>
  !chat.deactivated && (!chat.group || groupAbilities(chat.group).send);

function ForwardDialog({ messages }: { messages: ChatMessage[] }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const set = useMessageUi((state) => state.set);
  const rows = useChats();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const chats = useMemo(() => {
    const labels = { saved: t('chats.saved'), unknown: t('chats.unknownPerson') };
    const needle = query.trim().toLocaleLowerCase();
    return (rows ?? [])
      .map((row) => toChatSummary(row, me, labels))
      .filter((chat) => mayWrite(chat) && chat.name.toLocaleLowerCase().includes(needle));
  }, [me, query, rows, t]);
  const close = () => set({ forwarding: null });
  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  const send = () => {
    const action = forwardAction(messages, picked, comment, uuidv7());
    void useSyncStore.getState().client?.act(action);
    useMessageUi.getState().stopSelecting();
    close();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent title={t('messages.forwardTo')} className="max-w-md">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('messages.searchChats')}
            aria-label={t('messages.searchChats')}
            className="pl-9"
          />
        </div>
        <p role="status" className="text-xs text-text-muted">
          {t('messages.forwardLimit', { count: picked.length, max: FORWARD_MAX_CHATS })}
        </p>
        <ul aria-label={t('messages.forwardTo')} className="max-h-64 space-y-0.5 overflow-y-auto">
          {chats.map((chat) => {
            const isPicked = picked.includes(chat.id);
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  aria-pressed={isPicked}
                  disabled={!isPicked && picked.length >= FORWARD_MAX_CHATS}
                  onClick={() => toggle(chat.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-background disabled:opacity-50',
                    isPicked && 'bg-brand-subtle',
                  )}
                >
                  <Avatar name={chat.name} src={chat.avatarSrc} className="size-9" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.name}</span>
                  {isPicked ? <Check className="size-4 text-brand-text" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
          {chats.length === 0 ? (
            <li className="p-3 text-center text-sm text-text-muted">{t('chats.noResults')}</li>
          ) : null}
        </ul>
        <Input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t('messages.addMessage')}
          aria-label={t('messages.addMessage')}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button disabled={picked.length === 0} onClick={send}>
            {t('messages.forward')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ messages, chat }: { messages: ChatMessage[]; chat: ChatSummary }) {
  const { t } = useTranslation();
  const set = useMessageUi((state) => state.set);
  const close = () => set({ deleting: null });
  const forEveryone = messages.every((message) => canDeleteForEveryone(message, chat));
  const remove = (scope: 'me' | 'everyone') => {
    const { client } = useSyncStore.getState();
    for (const message of messages) {
      void client?.act({
        type: 'delete',
        ...targetOf(message),
        scope,
        ...(scope === 'everyone' && deletesAsAdmin(message, chat) ? { asAdmin: true } : {}),
      });
    }
    useMessageUi.getState().stopSelecting();
    close();
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        title={t('messages.deleteTitle', { count: messages.length })}
        className="max-w-sm"
      >
        <div className="flex flex-col gap-2">
          {forEveryone ? (
            <Button variant="danger" onClick={() => remove('everyone')}>
              {t('messages.deleteEveryone')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => remove('me')}>
            {t('messages.deleteMe')}
          </Button>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WhoReactedDialog({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const session = useSession();
  const me = session?.user.id ?? '';
  const people = useKnownPeople();
  const set = useMessageUi((state) => state.set);
  const close = () => set({ whoReacted: null });
  const nameOf = (
    id: string,
  ): Pick<PublicProfile, 'displayName'> & { src?: string | undefined } => {
    if (id === me) return { displayName: t('chats.you') };
    const person = people?.get(id);
    if (person) return { displayName: person.displayName, src: person.avatar?.small };
    return { displayName: message.authorId === id ? message.authorName : t('chats.unknownPerson') };
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent title={t('messages.whoReacted')} className="max-w-sm">
        <ul aria-label={t('messages.whoReacted')} className="space-y-1">
          {(message.reactions ?? []).map((reaction) => {
            const person = nameOf(reaction.userId);
            const isMe = reaction.userId === me;
            return (
              <li key={reaction.userId} className="flex items-center gap-3 rounded-lg p-1.5">
                <Avatar
                  name={person.displayName ?? ''}
                  src={person.src}
                  className="size-8 text-xs"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
                {isMe ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-text"
                    onClick={() => {
                      void useSyncStore
                        .getState()
                        .client?.act({ type: 'react', ...targetOf(message), emoji: null });
                      close();
                    }}
                  >
                    {t('messages.removeReaction')}
                  </button>
                ) : null}
                <span aria-hidden className="text-lg">
                  {reaction.emoji}
                </span>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function MessageDialogs({ chat }: { chat: ChatSummary }) {
  const forwarding = useMessageUi((state) => state.forwarding);
  const deleting = useMessageUi((state) => state.deleting);
  const whoReacted = useMessageUi((state) => state.whoReacted);
  return (
    <>
      {forwarding ? <ForwardDialog messages={forwarding} /> : null}
      {deleting ? <DeleteDialog messages={deleting} chat={chat} /> : null}
      {whoReacted ? <WhoReactedDialog message={whoReacted} /> : null}
    </>
  );
}
