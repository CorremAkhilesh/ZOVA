import { createFileRoute } from '@tanstack/react-router';
import { InstallGuide } from '@/features/help/components/InstallGuide';

export const Route = createFileRoute('/help/install')({
  component: InstallGuide,
});
