import { createFileRoute } from '@tanstack/react-router';
import { PrivacyNote } from '@/features/help/components/PrivacyNote';

export const Route = createFileRoute('/help/privacy')({
  component: PrivacyNote,
});
