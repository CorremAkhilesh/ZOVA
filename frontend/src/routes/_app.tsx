import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router';
import { AppRail } from '@/components/common/AppRail';
import { BottomTabs } from '@/components/common/BottomTabs';
import { ErrorScreen, NotFound } from '@/components/common/StatusScreens';
import { SessionGate } from '@/features/auth/components/SessionGate';
import { requireCompleteSession } from '@/features/auth/guards';
import { InstallBanner } from '@/features/install/InstallUi';
import { useIsDesktop } from '@/lib/hooks';

export const Route = createFileRoute('/_app')({
  // Signed in with a display name, or off to the welcome / name screens.
  beforeLoad: ({ context }) => requireCompleteSession(context.queryClient),
  component: AppShell,
  // Rendered inside the shell's <main>, so no extra landmark here.
  notFoundComponent: NotFound,
  errorComponent: ({ reset }) => <ErrorScreen onRetry={reset} />,
});

/**
 * Desktop (≥768px): icon rail + content. Mobile: content + bottom tabs, hidden while a
 * conversation is open so it can use the full screen.
 */
function AppShell() {
  const isDesktop = useIsDesktop();
  const matchRoute = useMatchRoute();
  const inConversation = Boolean(matchRoute({ to: '/chats/$chatId' }));

  if (isDesktop) {
    return (
      <div className="flex h-full">
        <AppRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <SessionGate />
          <InstallBanner />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <main className="glass flex min-h-0 flex-1 flex-col">
        <SessionGate />
        {inConversation ? null : <InstallBanner />}
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </main>
      {inConversation ? null : <BottomTabs />}
    </div>
  );
}
