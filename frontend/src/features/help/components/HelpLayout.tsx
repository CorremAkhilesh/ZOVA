import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/common/Logo';
import { Button } from '@/components/ui/button';
import { useKnownSignedIn } from '../signed-in';

/**
 * /help and its pages: public, so new colleagues can read them before they have an account. Only
 * static text; the one server value (the file size limit) is asked for when already signed in.
 */
export function HelpLayout() {
  const { t } = useTranslation();
  const signedIn = useKnownSignedIn();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <Link to={signedIn ? '/chats' : '/'} className="rounded-md">
          <Logo withName />
        </Link>
        <Button asChild size="sm" variant={signedIn ? 'outline' : 'default'}>
          <Link to={signedIn ? '/chats' : '/'}>
            {signedIn ? t('help.backToApp') : t('help.signIn')}
          </Link>
        </Button>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
