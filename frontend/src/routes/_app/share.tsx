import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ShareScreen } from '@/features/share/components/ShareScreen';

/** "Share to Zuvo": the service worker sends shares here (src/sw/share). Signed in only (_app). */
export const Route = createFileRoute('/_app/share')({
  validateSearch: z.object({
    // The router reads `?retry=1` as a number: take either.
    id: z.coerce.string().max(64).optional(),
    retry: z.coerce.string().optional(),
    error: z.coerce.string().optional(),
  }),
  component: function ShareRoute() {
    const search = Route.useSearch();
    return (
      // Inside the shell's <main> already.
      <div className="h-full">
        <ShareScreen id={search.id} retry={search.retry === '1'} error={search.error === '1'} />
      </div>
    );
  },
});
