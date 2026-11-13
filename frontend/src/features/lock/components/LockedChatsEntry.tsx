import { ChevronDown, Lock } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/session';
import { ChatListItem } from '@/features/chats/components/ChatListItem';
import { toChatSummary } from '@/features/chats/view';
import type { ChatRow } from '@/features/sync/local-db';
import { cn } from '@/lib/utils';
import { maskLocked } from '../chat-lock';
import { useChatsUnlocked, useLockStore } from '../store';

const UnlockChatsDialog = lazy(() => import('./UnlockChatsDialog'));

function LockedRows({ rows }: { rows: ChatRow[] }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const now = new Date();
  const labels = useMemo(
    () => ({ saved: t('chats.saved'), unknown: t('chats.unknownPerson') }),
    [t],
  );
  return (
    <ul className="space-y-0.5" data-testid="locked-chat-rows">
      {rows.map((row) => (
        <li key={row.id} className="chat-row">
          <ChatListItem
            chat={maskLocked(toChatSummary(row, me, labels), t('lock.locked'))}
            now={now}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * "Locked chats (2)" at the top of the list: no names or previews until the PIN, then the chats
 * for 5 minutes in this tab. Their previews stay hidden even then.
 */
export function LockedChatsEntry({
  rows,
  hidden,
}: {
  rows: ChatRow[] | undefined;
  hidden: boolean;
}) {
  const { t } = useTranslation();
  const locked = useMemo(() => rows?.filter((row) => row.locked === true) ?? [], [rows]);
  const unlocked = useChatsUnlocked();
  const [expanded, setExpanded] = useState(false);
  const [asking, setAsking] = useState(false);
  if (hidden || locked.length === 0) return null;
  const open = unlocked && expanded;

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => (unlocked ? setExpanded(!expanded) : setAsking(true))}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-background"
        >
          <Lock className="size-4 text-text-muted" aria-hidden />
          <span className="flex-1 text-left">{t('lock.lockedChats')}</span>
          <span className="text-xs font-normal text-text-muted">{locked.length}</span>
          <ChevronDown
            className={cn('size-4 text-text-muted transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {unlocked ? (
          <Button variant="ghost" size="sm" onClick={() => useLockStore.getState().relockChats()}>
            {t('lock.lockNow')}
          </Button>
        ) : null}
      </div>
      {open ? <LockedRows rows={locked} /> : null}
      {asking ? (
        <Suspense fallback={null}>
          <UnlockChatsDialog
            onClose={(done) => {
              setAsking(false);
              if (done) setExpanded(true);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
