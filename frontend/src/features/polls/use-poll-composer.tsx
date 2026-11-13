import { lazy, Suspense, useState } from 'react';
import { useChat } from '@/features/chats/queries';
import { groupAbilities } from '@/features/groups/rules';
import { useSyncStore } from '@/features/sync/store';
import { sendPoll } from './send-poll';

const CreatePollDialog = lazy(() => import('./components/CreatePollDialog'));

/**
 * "Poll" in the composer's attach menu: groups I can still write in and 1:1 chats, never Saved
 * Messages. `open` is undefined where a poll can't go, so the menu leaves the entry out.
 */
export function usePollComposer(chatId: string, onSent: () => void) {
  const chat = useChat(chatId);
  const client = useSyncStore((state) => state.client);
  const [open, setOpen] = useState(false);
  const allowed =
    client !== null &&
    (chat?.type === 'direct' ||
      (chat?.type === 'group' && chat.group ? groupAbilities(chat.group).send : false));
  return {
    open: allowed ? () => setOpen(true) : undefined,
    dialog: open ? (
      <Suspense fallback={null}>
        <CreatePollDialog
          onClose={() => setOpen(false)}
          onSend={(poll) => {
            setOpen(false);
            if (client) void sendPoll(client, chatId, poll);
            onSent();
          }}
        />
      </Suspense>
    ) : null,
  };
}
