import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { syncThemeWithDocument, useThemeStore } from '@/features/theme/theme-store';
import { ErrorBoundary } from './ErrorBoundary';
import { type AppRouter, createAppRouter, createQueryClient } from './router';

interface AppProps {
  queryClient?: QueryClient;
  router?: AppRouter;
}

export function App({ queryClient: providedClient, router: providedRouter }: AppProps) {
  const [queryClient] = useState(() => providedClient ?? createQueryClient());
  const [router] = useState(() => providedRouter ?? createAppRouter(queryClient));
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => syncThemeWithDocument(), []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* "user" = honour prefers-reduced-motion for every motion component. */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster position="top-center" richColors theme={mode} />
          </TooltipProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
