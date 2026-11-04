import { createFileRoute } from '@tanstack/react-router';
import { ChatScreen } from '@/features/chats/components/ChatScreen';

export const Route = createFileRoute('/_app/chats/$chatId')({
  component: ChatRoute,
});

function ChatRoute() {
  const { chatId } = Route.useParams();
  return <ChatScreen key={chatId} chatId={chatId} />;
}
