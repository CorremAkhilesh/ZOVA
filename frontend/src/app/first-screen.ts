import type { QueryClient } from '@tanstack/react-query';
import { primeSession } from '@/features/auth/session';
import type { AppRouter } from './router';

/**
 * Starts everything the first screen needs at once, before React renders:
 * - the session check (a returning user's stored session answers immediately, see primeSession);
 * - the code of the routes the address matches (e.g. the app shell and the chat list for /chats).
 *
 * The router would otherwise ask for a route's code only after the session check has answered,
 * one round trip after the other. Only the matched routes load: everything else stays lazy.
 */
export function startFirstScreen(queryClient: QueryClient, router: AppRouter): void {
  primeSession(queryClient);
  for (const match of router.matchRoutes(router.latestLocation)) {
    const route = Object.values(router.routesById).find(
      (candidate) => candidate.id === match.routeId,
    );
    if (route) void router.loadRouteChunk(route)?.catch(() => undefined);
  }
}
