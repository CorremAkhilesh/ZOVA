import { createFileRoute } from '@tanstack/react-router';
import { FaqPage } from '@/features/help/components/FaqPage';

export const Route = createFileRoute('/_app/help/faq')({
  component: FaqPage,
});
