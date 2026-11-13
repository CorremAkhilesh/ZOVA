import { createFileRoute } from '@tanstack/react-router';
import { ChatScreen } from '@/features/chats/components/ChatScreen';
import { ChatLockGuard } from '@/features/lock/components/ChatLockGuard';

export const Route = createFileRoute('/_app/chats/$chatId')({
  component: ChatRoute,
});

function ChatRoute() {
  const { chatId } = Route.useParams();
  return (
    <ChatLockGuard chatId={chatId}>
      <ChatScreen key={chatId} chatId={chatId} />
    </ChatLockGuard>
  );
}
