import { Lock } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const UnlockChatsDialog = lazy(() => import('./UnlockChatsDialog'));

/**
 * In place of what locked chats would show (starred messages, forward targets, media): one line,
 * never a name or a preview, and the PIN to see them for 5 minutes in this tab.
 */
export function LockedHiddenNotice({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  return (
    <div
      data-testid="locked-hidden"
      className={cn('flex items-center gap-3 rounded-xl border border-dashed p-3', className)}
    >
      <Lock className="size-4 shrink-0 text-text-muted" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-text-muted">{text}</p>
      <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
        {t('lock.unlock')}
      </Button>
      {asking ? (
        <Suspense fallback={null}>
          <UnlockChatsDialog onClose={() => setAsking(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
