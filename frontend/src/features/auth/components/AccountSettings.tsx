import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { getUserDb } from '@/features/sync/local-db';
import { useSession } from '../session';
import { useSignOut } from '../use-sign-out';

/** Settings → Account: who is signed in, when the session ends, and sign out. */
export function AccountSettings() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  /** Null while closed; otherwise how many messages on this device have not been sent yet. */
  const [asking, setAsking] = useState<number | null>(null);
  if (!session) return null;

  const ask = async () => {
    // Signing out wipes this device: anything still waiting to be sent goes with it.
    const unsent = await getUserDb(session.user.id)
      .outbox.count()
      .catch(() => 0);
    setAsking(unsent);
  };

  const { user } = session;
  const name = user.displayName ?? user.email;
  const expires = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(session.session.expiresAt));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={name} src={user.avatar?.small} className="size-12" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-sm text-text-muted">{user.email}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">{t('auth.account.sessionEnds')}</dt>
        <dd>{expires}</dd>
      </dl>
      <Button variant="outline" disabled={busy} onClick={() => void ask()}>
        <LogOut className="size-4" aria-hidden />
        {t('auth.signOut')}
      </Button>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => (open ? null : setAsking(null))}
        title={t('auth.signOutConfirm.title')}
        description={[
          asking ? t('auth.signOutConfirm.unsent', { count: asking }) : '',
          t('auth.signOutConfirm.body'),
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={t('auth.signOut')}
        pending={busy}
        danger={Boolean(asking)}
        onConfirm={async () => {
          setBusy(true);
          await signOut('signed-out');
        }}
      />
    </div>
  );
}
