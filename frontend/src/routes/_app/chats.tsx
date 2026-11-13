import { createFileRoute, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { ChatListSkeleton } from '@/components/common/ChatListSkeleton';
import { ChatListPane } from '@/features/chats/components/ChatListPane';
import { useNewChat } from '@/features/chats/new-chat-store';
import { useChatShortcuts } from '@/features/chats/use-chat-shortcuts';
import { NewGroupDialog } from '@/features/groups/components/NewGroupDialog';
import { takeJoinPath } from '@/features/groups/rules';
import { PeoplePicker } from '@/features/people/components/PeoplePicker';
import { useIsDesktop } from '@/lib/hooks';

export const Route = createFileRoute('/_app/chats')({
  component: ChatsLayout,
  pendingComponent: () => <ChatListSkeleton />,
});

/**
 * The first frame, before the panels measure the window. Without it both panels start at half
 * the width and then jump to 32/68: a layout shift Lighthouse scored at 0.27 on desktop.
 */
const FIRST_LAYOUT = { 'chat-list': 32, conversation: 68 };

/** Desktop: resizable chat list + conversation. Mobile: one pane at a time. */
function ChatsLayout() {
  const isDesktop = useIsDesktop();
  const matchRoute = useMatchRoute();
  const match = matchRoute({ to: '/chats/$chatId' });
  const chatOpen = Boolean(match);
  const pickerOpen = useNewChat((state) => state.isOpen);
  const setPickerOpen = useNewChat((state) => state.setOpen);
  useChatShortcuts(match ? match.chatId : undefined);
  const navigate = useNavigate();
  // Signed in from an invite link: carry on to it.
  useEffect(() => {
    const path = takeJoinPath();
    if (path) void navigate({ to: path });
  }, [navigate]);

  return (
    <>
      <PeoplePicker open={pickerOpen} onOpenChange={setPickerOpen} />
      <NewGroupDialog />
      {isDesktop ? (
        <Group
          orientation="horizontal"
          id="zuvo-chats-layout"
          className="h-full"
          defaultLayout={FIRST_LAYOUT}
        >
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
      ) : chatOpen ? (
        <Outlet />
      ) : (
        <ChatListPane />
      )}
    </>
  );
}
