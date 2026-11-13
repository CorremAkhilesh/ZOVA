import { createFileRoute } from '@tanstack/react-router';
import { PrivacyNote } from '@/features/help/components/PrivacyNote';

export const Route = createFileRoute('/_app/help/privacy')({
  component: PrivacyNote,
});
