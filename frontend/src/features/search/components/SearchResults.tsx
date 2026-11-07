import type { PublicProfile } from '@zuvo/protocol';
import { FileText, Image, Link2, MessagesSquare, Mic, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import type { ChatRow } from '@/features/sync/local-db';
import { cn } from '@/lib/utils';
import { snippetOf } from '../local-search';
import type { MessageHit } from '../use-message-search';
import { Highlighted } from './Highlighted';

export type SearchOption =
  | { kind: 'chat'; id: string; chat: ChatRow }
  | { kind: 'person'; id: string; person: PublicProfile }
  | { kind: 'message'; id: string; hit: MessageHit };

const TYPE_ICON: Record<string, typeof Image> = {
  image: Image,
  video: Video,
  document: FileText,
  audio: FileText,
  voice: Mic,
};

export const optionId = (option: SearchOption) => `search-${option.kind}-${option.id}`;

function Row(props: {
  option: SearchOption;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys go through the search field (aria-activedescendant)
    <div
      id={optionId(props.option)}
      role="option"
      tabIndex={-1}
      aria-selected={props.active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onPick}
      onMouseMove={props.onHover}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
        props.active && 'bg-brand-subtle',
      )}
    >
      {props.children}
    </div>
  );
}

function OptionBody({ option, q }: { option: SearchOption; q: string }) {
  const { t, i18n } = useTranslation();
  if (option.kind === 'chat') {
    const { chat } = option;
    const name =
      chat.type === 'self'
        ? t('chats.saved')
        : (chat.group?.name ?? chat.otherUser?.displayName ?? t('chats.unknownPerson'));
    return (
      <>
        <Avatar
          name={name}
          src={chat.group?.photo?.small ?? chat.otherUser?.avatar?.small}
          className="size-9"
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          <Highlighted text={name} q={q} />
        </span>
      </>
    );
  }
  if (option.kind === 'person') {
    const { person } = option;
    return (
      <>
        <Avatar name={person.displayName} src={person.avatar?.small} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            <Highlighted text={person.displayName} q={q} />
          </span>
          {person.username ? (
            <span className="block truncate text-xs text-text-muted">@{person.username}</span>
          ) : null}
        </span>
      </>
    );
  }
  const { hit } = option;
  const Icon =
    TYPE_ICON[hit.type] ?? (/https?:\/\/|www\./i.test(hit.text) ? Link2 : MessagesSquare);
  const chatName =
    hit.chatType === 'self' ? t('chats.saved') : (hit.chatTitle ?? t('chats.unknownPerson'));
  return (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-text-muted">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex gap-2 text-xs text-text-muted">
          <span className="truncate font-medium text-text">{chatName}</span>
          {hit.senderName && hit.senderName !== chatName ? (
            <span className="truncate">{hit.senderName}</span>
          ) : null}
          <time className="ml-auto shrink-0" dateTime={hit.at}>
            {new Date(hit.at).toLocaleDateString(i18n.language)}
          </time>
        </span>
        <span className="block truncate text-sm">
          <Highlighted text={snippetOf(hit.text, q) || t(`search.kinds.${hit.type}`)} q={q} />
        </span>
      </span>
    </>
  );
}

/** One section (Chats, People, Messages) of the results listbox: a named group of options. */
export function ResultSection(props: {
  title: string;
  options: SearchOption[];
  activeId: string | null;
  q: string;
  onPick: (option: SearchOption) => void;
  onHover: (option: SearchOption) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a listbox's sections must be role="group" (a fieldset is not allowed there)
    <div role="group" aria-label={props.title}>
      <div aria-hidden className="px-2.5 pt-3 pb-1 text-xs font-semibold text-text-muted uppercase">
        {props.title}
      </div>
      {props.options.map((option) => (
        <Row
          key={optionId(option)}
          option={option}
          active={props.activeId === optionId(option)}
          onPick={() => props.onPick(option)}
          onHover={() => props.onHover(option)}
        >
          <OptionBody option={option} q={props.q} />
        </Row>
      ))}
    </div>
  );
}
