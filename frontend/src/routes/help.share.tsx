import { createFileRoute } from '@tanstack/react-router';
import { ShareGuide } from '@/features/help/components/ShareGuide';

export const Route = createFileRoute('/help/share')({
  component: ShareGuide,
});
