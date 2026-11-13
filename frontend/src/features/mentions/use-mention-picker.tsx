import { useQuery } from '@tanstack/react-query';
import type { GroupMember } from '@zuvo/protocol';
import {
  type KeyboardEvent,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { useSession } from '@/features/auth/session';
import { useChat } from '@/features/chats/queries';
import { groupsApi } from '@/features/groups/api';
import { membersKey } from '@/features/groups/queries';
import { cn } from '@/lib/utils';
import {
  EVERYONE,
  findMentions,
  insertMention,
  type MentionCandidate,
  mentionQuery,
} from './mentions';

const SHOWN_MAX = 8;

type Option = MentionCandidate & { avatar?: string | undefined; everyone?: boolean };

/** The members of an open group, from the same cache the chat screen fills. */
export function useMentionCandidates(chatId: string) {
  const me = useSession()?.user.id;
  const chat = useChat(chatId);
  const group = chat?.type === 'group' && chat.group?.active ? chat.group : null;
  const { data } = useQuery({
    queryKey: membersKey(chatId),
    queryFn: () => groupsApi.members(chatId),
    enabled: group !== null,
  });
  return useMemo(() => {
    const members: GroupMember[] = group ? (data ?? []) : [];
    const candidates = members
      .filter((member) => member.user.id !== me && !member.user.deactivated)
      .map((member) => ({
        userId: member.user.id,
        name: member.user.displayName,
        avatar: member.user.avatar?.small,
      }));
    const admin = group?.myRole === 'owner' || group?.myRole === 'admin';
    const everyoneAllowed = Boolean(group && admin && group.settings.mentionEveryone !== 'off');
    return { isGroup: group !== null, candidates, everyoneAllowed };
  }, [data, group, me]);
}

/**
 * "@" in a group's composer: a list of members to pick from, kept in step with the caret, with the
 * keyboard (arrows, Enter or Tab, Esc). Mentions are worked out from the final text when sending.
 */
export function useMentionPicker(
  chatId: string,
  text: string,
  field: RefObject<HTMLTextAreaElement | null>,
  update: (next: string) => void,
) {
  const { t } = useTranslation();
  const listId = useId();
  const { isGroup, candidates, everyoneAllowed } = useMentionCandidates(chatId);
  const [caret, setCaret] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Where the caret goes once the chosen mention is in the box: set right after React writes the
  // value, before the next key. (A later animation frame moved it back over what was typed since.)
  const pendingCaret = useRef<{ value: string; caret: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    const element = field.current;
    if (!pending || !element || element.value !== pending.value) return;
    element.setSelectionRange(pending.caret, pending.caret);
    pendingCaret.current = null;
  });
  const at = caret ?? field.current?.selectionStart ?? text.length;
  const query = isGroup ? mentionQuery(text, Math.min(at, text.length)) : null;
  const options: Option[] = useMemo(() => {
    if (!query) return [];
    const needle = query.query.toLocaleLowerCase();
    const people: Option[] = candidates.filter(
      (candidate) =>
        candidate.name
          .toLocaleLowerCase()
          .split(/\s+/u)
          .some((word) => word.startsWith(needle)) ||
        candidate.name.toLocaleLowerCase().startsWith(needle),
    );
    const everyone: Option[] =
      everyoneAllowed && EVERYONE.startsWith(needle)
        ? [{ userId: EVERYONE, name: EVERYONE, everyone: true }]
        : [];
    return [...everyone, ...people].slice(0, SHOWN_MAX);
  }, [candidates, everyoneAllowed, query]);
  const open = query !== null && options.length > 0 && dismissedAt !== query.start;
  const active = Math.min(index, Math.max(0, options.length - 1));

  function choose(option: Option) {
    if (!query) return;
    const next = insertMention(text, query.start, at, option.name);
    update(next.value);
    setCaret(next.caret);
    setIndex(0);
    pendingCaret.current = { value: next.value, caret: next.caret };
  }

  return {
    /** True when the key was for the picker, and handled. */
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (!open) return false;
      const option = options[active];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setIndex((active + step + options.length) % options.length);
      } else if ((event.key === 'Enter' || event.key === 'Tab') && option) {
        choose(option);
      } else if (event.key === 'Escape') {
        setDismissedAt(query?.start ?? null);
      } else return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    /** The caret moved without typing: the picker follows it. */
    onSelect: () => setCaret(field.current?.selectionStart ?? null),
    onChange: () => {
      // Typed after choosing: the caret is already where the typing put it.
      pendingCaret.current = null;
      setCaret(null);
    },
    inputProps: isGroup
      ? {
          // A textarea stays a textbox (axe: aria-allowed-role); it still points at the list.
          'aria-autocomplete': 'list' as const,
          'aria-controls': open ? listId : undefined,
          'aria-activedescendant': open ? `${listId}-${active}` : undefined,
        }
      : {},
    /** What goes with the message: the mentions in its final text. */
    payload: (value: string) => (isGroup ? findMentions(value, candidates, everyoneAllowed) : {}),
    picker: open ? (
      <div
        id={listId}
        role="listbox"
        aria-label={t('mentions.pick')}
        className="mx-2 mb-1 max-h-60 overflow-y-auto rounded-xl border bg-surface p-1 shadow-lg"
      >
        {options.map((option, position) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys go through the composer (aria-activedescendant)
          <div
            key={option.userId}
            id={`${listId}-${position}`}
            role="option"
            tabIndex={-1}
            aria-selected={position === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
              position === active && 'bg-brand-subtle',
            )}
          >
            {option.everyone ? (
              <span className="grid size-7 place-items-center rounded-full bg-accent-subtle font-semibold text-accent-text">
                @
              </span>
            ) : (
              <span aria-hidden>
                <Avatar name={option.name} src={option.avatar} className="size-7" />
              </span>
            )}
            <span data-name className="truncate">
              {option.everyone ? t('mentions.everyone') : option.name}
            </span>
          </div>
        ))}
      </div>
    ) : null,
  };
}
