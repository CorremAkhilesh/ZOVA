import { createFileRoute, redirect } from '@tanstack/react-router';

/** Moved into the admin panel: old links and bookmarks still arrive. */
export const Route = createFileRoute('/_app/settings/admin/audit')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/audit', replace: true });
  },
});
