import { createFileRoute } from '@tanstack/react-router';
import { ContactPage } from '@/features/help/components/ContactPage';

export const Route = createFileRoute('/_app/help/contact')({
  component: ContactPage,
});
