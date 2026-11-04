import { CornerUpLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsDesktop } from '@/lib/hooks';
import { buildTimeline, dayKind } from '../chat-utils';
import { mockMessagesFor } from '../mock-data';
import type { ChatMessage, ChatSummary } from '../types';
import { ChatInfoPane } from './ChatInfoPane';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
import { MessageBubble } from './MessageBubble';

function DateSeparator({ date }: { date: Date }) {
  const { t, i18n } = useTranslation();
  const kind = dayKind(date, new Date());
  const label =
    kind === 'today'
      ? t('conversation.today')
      : kind === 'yesterday'
        ? t('conversation.yesterday')
        : new Intl.DateTimeFormat(i18n.language, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(date);
  return (
    <li className="sticky top-2 z-10 my-3 flex justify-center" aria-label={label}>
      <span className="glass rounded-full border px-3 py-1 text-xs font-medium text-text-muted shadow-sm">
        {label}
      </span>
    </li>
  );
}

export function Conversation({ chat }: { chat: ChatSummary }) {
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  const [infoOpen, setInfoOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const timeline = useMemo(() => buildTimeline(mockMessagesFor(chat.id)), [chat.id]);
  const endRef = useRef<HTMLLIElement>(null);

  // The route remounts this component per chat (key = chat id), so once is enough.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="sr-only">{chat.name}</h2>
        <ConversationHeader
          chat={chat}
          showBack={!isDesktop}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((open) => !open)}
        />
        <div className="chat-wallpaper min-h-0 flex-1 overflow-y-auto px-3 py-2 md:px-8">
          <ol aria-label={chat.name} className="mx-auto flex max-w-3xl flex-col">
            {timeline.map((item) =>
              item.type === 'date' ? (
                <DateSeparator key={item.key} date={item.date} />
              ) : (
                <li key={item.key} className="group/msg relative">
                  <MessageBubble
                    message={item.message}
                    firstInGroup={item.firstInGroup}
                    lastInGroup={item.lastInGroup}
                    showAuthor={chat.kind === 'group'}
                  />
                  <button
                    type="button"
                    onClick={() => setReplyTo(item.message)}
                    aria-label={t('conversation.reply')}
                    className="absolute top-1/2 right-1/2 hidden -translate-y-1/2 rounded-full bg-surface p-1.5 text-text-muted shadow-md group-hover/msg:block focus-visible:block"
                  >
                    <CornerUpLeft className="size-4" />
                  </button>
                </li>
              ),
            )}
            <li ref={endRef} aria-hidden className="h-px" />
          </ol>
        </div>
        <Composer replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
      </div>
      {infoOpen && isDesktop ? (
        <ChatInfoPane chat={chat} onClose={() => setInfoOpen(false)} />
      ) : null}
    </div>
  );
}
