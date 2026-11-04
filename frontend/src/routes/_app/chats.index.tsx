import { createFileRoute } from '@tanstack/react-router';
import { EmptyConversation } from '@/components/common/StatusScreens';

export const Route = createFileRoute('/_app/chats/')({
  component: EmptyConversation,
});
