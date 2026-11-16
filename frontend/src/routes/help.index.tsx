import { createFileRoute } from '@tanstack/react-router';
import { HelpHome } from '@/features/help/components/HelpHome';

export const Route = createFileRoute('/help/')({
  component: HelpHome,
});
