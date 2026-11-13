import { createFileRoute } from '@tanstack/react-router';
import { EmailStep } from '@/features/auth/components/EmailStep';
import { requireSignedOut } from '@/features/auth/guards';

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => requireSignedOut(context.queryClient),
  component: EmailStep,
});
