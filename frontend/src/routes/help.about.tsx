import { createFileRoute } from '@tanstack/react-router';
import { AboutPage } from '@/features/help/components/AboutPage';

export const Route = createFileRoute('/help/about')({
  component: AboutPage,
});
