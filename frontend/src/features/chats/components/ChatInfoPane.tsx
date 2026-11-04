import { Bell, ChevronRight, Image, Star, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ChatSummary } from '../types';
import { ChatAvatar } from './ChatAvatar';

export function ChatInfoPane({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const { t } = useTranslation();
  const rows = [
    { icon: Image, label: t('info.media') },
    { icon: Star, label: t('info.starred') },
    { icon: Bell, label: t('info.notifications') },
  ];

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
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
        <ChatAvatar chat={chat} className="size-24 text-2xl" />
        <p className="text-lg font-semibold">{chat.name}</p>
        {chat.username ? <p className="text-sm text-text-muted">@{chat.username}</p> : null}
        {chat.about ? <p className="text-sm text-text-muted">{chat.about}</p> : null}
      </div>
      <ul className="space-y-1 px-3">
        {rows.map(({ icon: Icon, label }) => (
          <li key={label}>
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm opacity-60"
            >
              <Icon className="size-5 text-brand-text" aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight className="size-4 text-text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </motion.aside>
  );
}
