import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/auth/session';
import { ChatAvatar } from '@/features/chats/components/ChatAvatar';
import { useChats } from '@/features/chats/queries';
import type { ChatSummary } from '@/features/chats/types';
import { toChatSummary } from '@/features/chats/view';
import { groupAbilities } from '@/features/groups/rules';
import { useWithoutLocked } from '@/features/lock/chat-lock';
import type { ChatRow } from '@/features/sync/local-db';
import { cn } from '@/lib/utils';

/** A chat I can send to now: not a deactivated person, not a group I left or where only admins talk. */
export function canShareTo(row: ChatRow): boolean {
  if (row.type === 'group') return Boolean(row.group && groupAbilities(row.group).send);
  return row.otherUser?.deactivated !== true;
}

/** My chats as the picker shows them: newest first (Saved Messages included), never locked ones. */
function useShareChats(): ChatSummary[] | undefined {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const rows = useWithoutLocked(useChats());
  return useMemo(() => {
    const labels = {
      saved: t('chats.saved'),
      unknown: t('chats.unknownPerson'),
      photo: t('media.photo'),
      voice: t('voice.preview'),
      system: () => '',
      deleted: t('messages.deleted'),
      reacted: () => '',
      video: t('media.video'),
    };
    return rows?.filter(canShareTo).map((row) => toChatSummary(row, me, labels));
  }, [me, rows, t]);
}

/**
 * Recent chats and a search: tick up to `max` (one, for text that waits in the message box). Hidden
 * admins never appear: only chats I already have are offered, and the server checks every send.
 */
export function ShareChatPicker(props: {
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
}) {
  const { t } = useTranslation();
  const chats = useShareChats();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const shown = (chats ?? []).filter((chat) => chat.name.toLocaleLowerCase().includes(needle));
  const toggle = (id: string) => {
    if (props.selected.includes(id)) props.onChange(props.selected.filter((item) => item !== id));
    else if (props.max === 1) props.onChange([id]);
    else if (props.selected.length < props.max) props.onChange([...props.selected, id]);
  };
  const full = props.max > 1 && props.selected.length >= props.max;
  return (
    <section aria-label={t('share.chooseChats')} className="space-y-2">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('share.search')}
        aria-label={t('share.search')}
      />
      <p className="text-xs text-text-muted" aria-live="polite">
        {props.max === 1
          ? t('share.pickOne')
          : t('share.picked', { count: props.selected.length, max: props.max })}
      </p>
      {chats && shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">{t('share.noChats')}</p>
      ) : null}
      <ul className="divide-y rounded-xl border bg-surface">
        {shown.map((chat) => {
          const on = props.selected.includes(chat.id);
          return (
            <li key={chat.id}>
              <label
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-background',
                  full && !on && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type={props.max === 1 ? 'radio' : 'checkbox'}
                  name="share-chat"
                  className="sr-only"
                  checked={on}
                  disabled={full && !on}
                  onChange={() => toggle(chat.id)}
                />
                <ChatAvatar chat={chat} className="size-10" />
                <span className="min-w-0 flex-1 truncate">{chat.name}</span>
                <span
                  aria-hidden
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full border-2',
                    on ? 'border-brand bg-brand text-brand-foreground' : 'border-border',
                  )}
                >
                  {on ? <Check className="size-4" /> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
