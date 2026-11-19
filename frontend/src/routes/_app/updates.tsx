import { createFileRoute } from '@tanstack/react-router';
import { StatusScreen } from '@/features/status/components/StatusScreen';

/** The Status tab (the dotted circle in the sidebar): 24-hour updates from colleagues. */
export const Route = createFileRoute('/_app/updates')({
  component: StatusScreen,
});
