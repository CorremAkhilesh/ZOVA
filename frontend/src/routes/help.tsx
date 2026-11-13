import { createFileRoute } from '@tanstack/react-router';
import { HelpLayout } from '@/features/help/components/HelpLayout';

// Public: no session needed (Step 19). The pages show only static text.
export const Route = createFileRoute('/help')({
  component: HelpLayout,
});
