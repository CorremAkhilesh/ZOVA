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

/** Toasts go after a short while; a swipe or the close button sends one away at once. */
const TOAST_DURATION_MS = 3500;
/** Above the composer (desktop) and above the composer or tab bar on phones (+ safe area). */
const TOAST_OFFSET = 88;
const TOAST_MOBILE_OFFSET = 'calc(84px + env(safe-area-inset-bottom))';

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
              <Toaster
                // Never over a header (its buttons must stay tappable): at the bottom, above the
                // composer and the phone's tab bar, clear of the home indicator.
                position="bottom-center"
                offset={{ bottom: TOAST_OFFSET }}
                mobileOffset={{ bottom: TOAST_MOBILE_OFFSET }}
                duration={TOAST_DURATION_MS}
                swipeDirections={['left', 'right', 'bottom']}
                closeButton
                richColors
                theme={mode}
              />
              <IosInstallSheetHost />
            </TooltipProvider>
          </MotionConfig>
        </LazyMotion>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
