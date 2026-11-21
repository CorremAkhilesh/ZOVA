import { createFileRoute, redirect } from '@tanstack/react-router';

/** Moved into the admin panel: old links and bookmarks still arrive. */
export const Route = createFileRoute('/_app/settings/admin/notifications')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/notifications', replace: true });
  },
});
