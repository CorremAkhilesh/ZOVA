import { createFileRoute } from '@tanstack/react-router';
import { NotMePage } from '@/features/security/components/NotMePage';

/** Public: opened from the new-login email, signed in or not. The token is in the URL fragment. */
export const Route = createFileRoute('/security/not-me')({
  component: NotMePage,
});
