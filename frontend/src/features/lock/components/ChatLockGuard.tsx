import { Lock } from 'lucide-react';
import { lazy, type ReactNode, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '@/features/chats/queries';
import { useChatsUnlocked, useLockStore } from '../store';

const PinPrompt = lazy(() =>
  import('./PinPrompt').then((module) => ({ default: module.PinPrompt })),
);

function LockedChatScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 overflow-y-auto p-6">
      <Lock className="size-8 text-brand" aria-hidden />
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold tracking-tight">{t('lock.chatLockedTitle')}</h1>
        <p className="text-sm text-text-muted">{t('lock.unlockChatsHint')}</p>
      </div>
      <Suspense fallback={null}>
        <PinPrompt
          label={t('lock.enterPin')}
          onUnlocked={() => useLockStore.getState().unlockChats()}
        />
      </Suspense>
    </div>
  );
}

/**
 * A locked chat opens only within the 5 minutes after the PIN: a link straight to it, or the
 * chat still open when they run out, shows the PIN screen instead.
 */
export function ChatLockGuard({ chatId, children }: { chatId: string; children: ReactNode }) {
  const chat = useChat(chatId);
  const unlocked = useChatsUnlocked();
  // Not read yet: show nothing rather than a moment of a locked chat.
  if (chat === undefined) return null;
  if (chat?.locked === true && !unlocked) return <LockedChatScreen />;
  return children;
}
