import { createFileRoute } from '@tanstack/react-router';
import { AboutPage } from '@/features/help/components/AboutPage';

export const Route = createFileRoute('/_app/help/about')({
  component: AboutPage,
});
