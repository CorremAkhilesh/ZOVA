import { createFileRoute } from '@tanstack/react-router';
import { CallsScreen } from '@/features/calls/components/CallsScreen';

/** The Calls tab (📞 in the sidebar): my call history, and calling back from it. */
export const Route = createFileRoute('/_app/calls')({
  component: CallsScreen,
});
