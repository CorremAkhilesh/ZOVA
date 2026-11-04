import { createFileRoute, notFound } from '@tanstack/react-router';
import { Conversation } from '@/features/chats/components/Conversation';
import { findMockChat } from '@/features/chats/mock-data';

export const Route = createFileRoute('/_app/chats/$chatId')({
  // MOCK: looks the chat up in sample data until the chats API exists.
  loader: ({ params }) => {
    const chat = findMockChat(params.chatId);
    if (!chat) throw notFound();
    return { chat };
  },
  component: ChatRoute,
});

function ChatRoute() {
  const { chat } = Route.useLoaderData();
  return <Conversation key={chat.id} chat={chat} />;
}
