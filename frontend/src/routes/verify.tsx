import { createFileRoute, redirect } from '@tanstack/react-router';
import { OtpStep } from '@/features/auth/components/OtpStep';
import { useAuthFlow } from '@/features/auth/flow-store';
import { requireSignedOut } from '@/features/auth/guards';

export const Route = createFileRoute('/verify')({
  beforeLoad: async ({ context }) => {
    await requireSignedOut(context.queryClient);
    // The code step needs an email from step 1.
    if (!useAuthFlow.getState().pendingEmail) throw redirect({ to: '/' });
  },
  component: OtpStep,
});
