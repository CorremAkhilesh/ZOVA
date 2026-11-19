import { CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/features/chats/types';
import { useThumbnail } from '@/features/media/use-thumbnail';
import { cn } from '@/lib/utils';
import { backgroundStyle } from '../text-styles';

function Thumb({ mediaId }: { mediaId: string }) {
  const { url } = useThumbnail(mediaId, true);
  if (!url) return null;
  return <img src={url} alt="" className="size-10 shrink-0 rounded object-cover" />;
}

/**
 * Above a reply to a status: "Status", what it said (or a thumbnail), and a tile of a text status's
 * colour. Once it has expired, only "Status".
 */
export function StatusQuote({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t } = useTranslation();
  const reply = message.statusReply;
  if (!reply) return null;
  const live = Date.parse(reply.expiresAt) > Date.now();
  const body =
    reply.text ??
    (reply.kind === 'video'
      ? t('updates.video')
      : reply.kind === 'image'
        ? t('updates.photo')
        : '');
  return (
    <div
      className={cn(
        'mb-1 flex w-full items-center gap-2 rounded-lg border-l-4 px-2 py-1 text-left text-xs',
        mine
          ? 'border-bubble-outgoing-meta bg-black/15 text-bubble-outgoing-text'
          : 'border-brand bg-background text-bubble-incoming-text',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 font-semibold">
          <CircleDashed className="size-3.5" aria-hidden />
          {t('updates.label')}
        </span>
        {live && body ? <span className="line-clamp-2 opacity-90">{body}</span> : null}
      </span>
      {live && reply.mediaId && reply.hasThumbnail ? <Thumb mediaId={reply.mediaId} /> : null}
      {live && reply.kind === 'text' && reply.style ? (
        <span
          aria-hidden
          className="size-10 shrink-0 rounded"
          style={backgroundStyle(reply.style.background)}
        />
      ) : null}
    </div>
  );
}
