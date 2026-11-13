import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LazyMotion, MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IosInstallSheetHost } from '@/features/install/IosInstallSheetHost';
import { listenForInstallEvents } from '@/features/install/install-store';
import { syncThemeWithDocument, useThemeStore } from '@/features/theme/theme-store';
import { ErrorBoundary } from './ErrorBoundary';
import { type AppRouter, createAppRouter, createQueryClient } from './router';

/** Motion's animation code arrives after the first paint (lib/motion-features.ts). Use `m.div`, not
 * `motion.div`: a `motion` component brings the whole library back into the main bundle. */
const loadMotionFeatures = () => import('@/lib/motion-features').then((module) => module.default);

interface AppProps {
  queryClient?: QueryClient;
  router?: AppRouter;
}

export function App({ queryClient: providedClient, router: providedRouter }: AppProps) {
  const [queryClient] = useState(() => providedClient ?? createQueryClient());
  const [router] = useState(() => providedRouter ?? createAppRouter(queryClient));
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => syncThemeWithDocument(), []);
  useEffect(() => listenForInstallEvents(), []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* "user" = honour prefers-reduced-motion for every motion component. */}
        <LazyMotion features={loadMotionFeatures}>
          <MotionConfig reducedMotion="user">
            <TooltipProvider>
              <RouterProvider router={router} />
              <Toaster position="top-center" richColors theme={mode} />
              <IosInstallSheetHost />
            </TooltipProvider>
          </MotionConfig>
        </LazyMotion>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
