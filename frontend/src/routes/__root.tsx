import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { OfflineBanner } from '@/components/common/OfflineBanner';
import { ErrorScreen, NotFound } from '@/components/common/StatusScreens';
import { useLanguageSync } from '@/features/settings/use-language-sync';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <main className="h-full">
      <NotFound />
    </main>
  ),
  errorComponent: ({ reset }) => (
    <main className="h-full">
      <ErrorScreen onRetry={reset} />
    </main>
  ),
});

function RootLayout() {
  useLanguageSync();
  useKeyboardHeight();
  return (
    // Safe-area padding: notches, rounded corners and the translucent iOS status bar. The height
    // shrinks to what an on-screen keyboard leaves visible (lib/use-keyboard-height.ts).
    <div className="app-backdrop relative flex h-[var(--app-height,100dvh)] flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      {/* Installed desktop app with window-controls-overlay: a draggable title-bar strip. */}
      <div aria-hidden className="titlebar-area" />
      <OfflineBanner />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
