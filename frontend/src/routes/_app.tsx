import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router';
import { AppRail } from '@/components/common/AppRail';
import { BottomTabs } from '@/components/common/BottomTabs';
import { ChatListSkeleton } from '@/components/common/ChatListSkeleton';
import { ErrorScreen, NotFound } from '@/components/common/StatusScreens';
import { AppearanceHost } from '@/features/appearance/components/AppearanceHost';
import { SessionGate } from '@/features/auth/components/SessionGate';
import { requireCompleteSession } from '@/features/auth/guards';
import { rememberJoinPath } from '@/features/groups/rules';
import { LockHost } from '@/features/lock/components/LockHost';
import { MentionProfileHost } from '@/features/mentions/mention-marks';
import { ModerationHost } from '@/features/moderation/components/ModerationHost';
import { NotificationsHost } from '@/features/notifications/NotificationsHost';
import { SearchHost } from '@/features/search/components/SearchHost';
import { useSyncClient } from '@/features/sync/use-sync-client';
import { MiniPlayer } from '@/features/voice/components/MiniPlayer';
import { useIsDesktop } from '@/lib/hooks';

export const Route = createFileRoute('/_app')({
  // Signed in with a display name, or off to the welcome / name screens.
  beforeLoad: async ({ context, location }) => {
    try {
      return await requireCompleteSession(context.queryClient);
    } catch (redirected) {
      // Sent to sign in first: carry on to the invite link afterwards.
      rememberJoinPath(location.pathname);
      throw redirected;
    }
  },
  component: AppShell,
  // Never a blank screen: while the session check (first visit on this device) or the shell's code
  // loads, a skeleton shows at once. It ships with the route itself (not split), so it needs no
  // download of its own.
  pendingComponent: () => (
    <main className="h-full">
      <ChatListSkeleton />
    </main>
  ),
  pendingMs: 0,
  pendingMinMs: 0,
  codeSplitGroupings: [['component'], ['errorComponent'], ['notFoundComponent']],
  // Rendered inside the shell's <main>, so no extra landmark here.
  notFoundComponent: NotFound,
  errorComponent: ({ reset }) => <ErrorScreen onRetry={reset} />,
});

/**
 * Desktop (≥768px): icon rail + content. Mobile: content + bottom tabs, hidden while a
 * conversation is open so it can use the full screen.
 */
function AppShell() {
  useSyncClient();
  const isDesktop = useIsDesktop();
  const matchRoute = useMatchRoute();
  const inConversation = Boolean(matchRoute({ to: '/chats/$chatId' }));
  // Opened from anywhere: menus, the search box, Ctrl/Cmd+K. Their code loads on first use.
  const hosts = (
    <>
      <ModerationHost />
      <SearchHost />
      <MentionProfileHost />
      <LockHost />
      <AppearanceHost />
      <NotificationsHost />
    </>
  );

  if (isDesktop) {
    return (
      <div className="flex h-full">
        {hosts}
        <AppRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <SessionGate />
          <MiniPlayer />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {hosts}
      <main className="glass flex min-h-0 flex-1 flex-col">
        <SessionGate />
        <MiniPlayer />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </main>
      {inConversation ? null : <BottomTabs />}
    </div>
  );
}
