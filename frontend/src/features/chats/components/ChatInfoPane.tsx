import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { GroupInfoBody } from '@/features/groups/components/GroupInfoPane';
import { ChatGallery } from '@/features/media/components/ChatGallery';
import type { ChatRow } from '@/features/sync/local-db';
import type { ChatSummary } from '../types';
import { ChatAvatar } from './ChatAvatar';

export function ChatInfoPane({
  chat,
  row,
  onClose,
  onOpenMedia,
}: {
  chat: ChatSummary;
  row: ChatRow;
  onClose: () => void;
  onOpenMedia: (mediaId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <motion.aside
      aria-label={t('conversation.info')}
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="glass flex h-full w-80 shrink-0 flex-col border-l"
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        <h2 className="font-semibold">{t('conversation.info')}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t('conversation.closeInfo')}
        >
          <X className="size-4" />
        </Button>
      </div>
      {chat.kind === 'group' ? (
        <GroupInfoBody row={row} chat={chat} onOpenMedia={onOpenMedia} />
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <ChatAvatar chat={chat} className="size-24 text-2xl" />
            <p className="text-lg font-semibold">{chat.name}</p>
            {chat.username ? <p className="text-sm text-text-muted">@{chat.username}</p> : null}
            {chat.about ? <p className="text-sm text-text-muted">{chat.about}</p> : null}
          </div>
          {chat.kind === 'saved' ? null : <ChatGallery chatId={chat.id} onOpen={onOpenMedia} />}
        </>
      )}
    </motion.aside>
  );
}
