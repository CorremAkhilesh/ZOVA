import { createFileRoute } from '@tanstack/react-router';
import { AdminLayout } from '@/features/admin/components/AdminLayout';
import { requireAdmin } from '@/features/auth/guards';

/** The admin panel: admins only (the server checks every admin request as well). */
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => requireAdmin(context.queryClient),
  component: AdminLayout,
});
