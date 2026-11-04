import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { OfflineBanner } from '@/components/common/OfflineBanner';
import { ErrorScreen, NotFound } from '@/components/common/StatusScreens';

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
  return (
    <div className="app-backdrop flex h-dvh flex-col overflow-hidden">
      <OfflineBanner />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
