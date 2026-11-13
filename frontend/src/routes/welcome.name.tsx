import { createFileRoute } from '@tanstack/react-router';
import { NameStep } from '@/features/auth/components/NameStep';
import { requireNeedsProfile } from '@/features/auth/guards';

export const Route = createFileRoute('/welcome/name')({
  beforeLoad: ({ context }) => requireNeedsProfile(context.queryClient),
  component: NameStep,
});
