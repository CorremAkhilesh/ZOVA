import { createFileRoute } from '@tanstack/react-router';
import { NotificationsGuide } from '@/features/help/components/NotificationsGuide';

export const Route = createFileRoute('/help/notifications')({
  component: NotificationsGuide,
});
