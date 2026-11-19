import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Message } from '@zuvo/protocol';
import { BellOff, ChevronRight, Flag, type LucideIcon, Search, Star, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type ChatMessage, ME } from '@/features/chats/types';
import { mediaApi } from '@/features/media/api';
import { MediaVisual } from '@/features/media/components/MessageMedia';
import { useModeration } from '@/features/moderation/store';
import { Switch } from '@/features/quiet-hours/components/Switch';
import { useInChatSearch } from '@/features/search/in-chat-store';
import { useSyncStore } from '@/features/sync/store';
import { cn } from '@/lib/utils';

/** A white card of rows in chat info, WhatsApp-style. */
export function InfoCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('bg-surface py-1', className)}>{children}</section>;
}

/** A tappable row: icon, label, optional detail, chevron. At least 48 px tall. */
export function InfoRow(props: {
  icon: LucideIcon;
  label: string;
  detail?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const { icon: Icon } = props;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'flex min-h-12 w-full items-center gap-4 px-5 py-2 text-left hover:bg-background',
        props.danger ? 'text-danger' : 'text-text',
      )}
    >
      <Icon className={cn('size-5 shrink-0', props.danger ? '' : 'text-text-muted')} aria-hidden />
      <span className="min-w-0 flex-1">{props.label}</span>
      {props.detail}
      {props.danger ? null : <ChevronRight className="size-4 text-text-muted" aria-hidden />}
    </button>
  );
}

function RoundAction(props: { icon: LucideIcon; label: string; onClick: () => void }) {
  const { icon: Icon } = props;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex min-w-20 flex-col items-center gap-1.5 rounded-xl border px-4 py-3 text-sm text-brand-text hover:bg-background"
    >
      <Icon className="size-5" aria-hidden />
      {props.label}
    </button>
  );
}

/** Under the name: Add (if I may) and Search. Calls join them once the calls feature exists. */
export function InfoActions(props: { chatId: string; canAdd: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center gap-3">
      {props.canAdd ? (
        <RoundAction icon={UserPlus} label={t('groups.add')} onClick={props.onAdd} />
      ) : null}
      <RoundAction
        icon={Search}
        label={t('info.search')}
        onClick={() => useInChatSearch.getState().open(props.chatId)}
      />
    </div>
  );
}

const toItem = (message: Message): ChatMessage => ({
  id: message.id,
  chatId: message.chatId,
  clientMsgId: message.clientMsgId,
  authorId: ME,
  authorName: '',
  text: message.text ?? '',
  at: new Date(message.createdAt),
  media: message.media,
  albumId: message.albumId,
  linkPreview: message.linkPreview ?? null,
  expiresAt: message.expiresAt ?? null,
});

/** "Media, links and docs": how many, and the newest four pictures; opens the full gallery. */
export function MediaSummary(props: {
  chatId: string;
  onOpenGallery: () => void;
  onOpenMedia: (mediaId: string) => void;
}) {
  const { t } = useTranslation();
  const page = useQuery({
    queryKey: ['chat-gallery-summary', props.chatId],
    queryFn: () => mediaApi.gallery(props.chatId, 'media', undefined),
  });
  const items = (page.data?.items ?? []).filter((message) => !message.viewOnce).map(toItem);
  const count = page.data ? `${items.length}${page.data.hasMore ? '+' : ''}` : '';
  return (
    <InfoCard>
      <button
        type="button"
        onClick={props.onOpenGallery}
        className="flex min-h-12 w-full items-center justify-between px-5 py-2 text-left text-sm text-text-muted hover:bg-background"
      >
        <span>{t('info.mediaLinksDocs')}</span>
        <span className="flex items-center gap-1">
          {count}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </button>
      {items.length > 0 ? (
        <ul className="grid grid-cols-4 gap-1.5 px-5 pb-3">
          {items.slice(0, 4).map((item) => (
            <li key={item.id} className="aspect-square overflow-hidden rounded-lg">
              <MediaVisual message={item} onOpen={props.onOpenMedia} fill />
            </li>
          ))}
        </ul>
      ) : null}
    </InfoCard>
  );
}

/** Starred messages of this chat, and mute on/off. */
export function InfoShortcuts(props: { chatId: string; muted: boolean }) {
  const { t } = useTranslation();
  const client = useSyncStore((state) => state.client);
  return (
    <InfoCard>
      <Link
        to="/starred"
        search={{ chatId: props.chatId }}
        className="flex min-h-12 w-full items-center gap-4 px-5 py-2 hover:bg-background"
      >
        <Star className="size-5 text-text-muted" aria-hidden />
        <span className="flex-1">{t('info.starred')}</span>
        <ChevronRight className="size-4 text-text-muted" aria-hidden />
      </Link>
      <div className="flex min-h-12 items-center gap-4 px-5 py-2">
        <BellOff className="size-5 shrink-0 text-text-muted" aria-hidden />
        <div className="flex-1">
          <Switch
            label={t('info.mute')}
            hint=""
            checked={props.muted}
            onChange={(mute) =>
              void client?.act({
                type: 'prefs',
                chatId: props.chatId,
                prefs: { mute: mute ? 'always' : 'off' },
              })
            }
          />
        </div>
      </div>
    </InfoCard>
  );
}

/** Report the group (to the admins of the app). */
export function ReportGroupRow(props: { chatId: string; name: string }) {
  const { t } = useTranslation();
  return (
    <InfoRow
      icon={Flag}
      label={t('info.reportGroup')}
      danger
      onClick={() =>
        useModeration.getState().openReport({
          target: { kind: 'group', chatId: props.chatId },
          person: null,
          groupName: props.name,
        })
      }
    />
  );
}
