import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { StarredScreen } from '@/features/messages/components/StarredScreen';

export const Route = createFileRoute('/_app/starred')({
  validateSearch: z.object({ chatId: z.string().optional() }),
  component: StarredRoute,
});

function StarredRoute() {
  const { chatId } = Route.useSearch();
  return <StarredScreen chatId={chatId} />;
}
