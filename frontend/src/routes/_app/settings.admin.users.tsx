import { createFileRoute, redirect } from '@tanstack/react-router';

/** Moved into the admin panel: old links and bookmarks still arrive. */
export const Route = createFileRoute('/_app/settings/admin/users')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/users', replace: true });
  },
});
