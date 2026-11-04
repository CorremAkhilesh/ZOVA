import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { ChatListSkeleton } from '@/components/common/ChatListSkeleton';
import { ChatListPane } from '@/features/chats/components/ChatListPane';
import { useIsDesktop } from '@/lib/hooks';

export const Route = createFileRoute('/_app/chats')({
  component: ChatsLayout,
  pendingComponent: () => <ChatListSkeleton />,
});

/** Desktop: resizable chat list + conversation. Mobile: one pane at a time. */
function ChatsLayout() {
  const isDesktop = useIsDesktop();
  const matchRoute = useMatchRoute();
  const chatOpen = Boolean(matchRoute({ to: '/chats/$chatId' }));

  if (!isDesktop) {
    return chatOpen ? <Outlet /> : <ChatListPane />;
  }
  return (
    <Group orientation="horizontal" id="zuvo-chats-layout" className="h-full">
      <Panel
        id="chat-list"
        defaultSize="32"
        minSize="300px"
        maxSize="50"
        className="glass border-r"
      >
        <ChatListPane />
      </Panel>
      <Separator className="w-1 bg-transparent transition-colors hover:bg-brand/30 data-[separator=active]:bg-brand/50" />
      <Panel id="conversation" minSize="40">
        <Outlet />
      </Panel>
    </Group>
  );
}
