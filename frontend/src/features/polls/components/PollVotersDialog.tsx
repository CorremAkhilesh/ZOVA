import type { PollOption } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useSession } from '@/features/auth/session';
import { useChat } from '@/features/chats/queries';
import { useKnownPeople } from '@/features/groups/queries';

/**
 * Who voted for one option. Names come from what this device already knows: the group's members
 * (kept in the local database), the other person in a 1:1 chat, and me.
 */
export default function PollVotersDialog(props: {
  chatId: string;
  option: PollOption;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const chat = useChat(props.chatId);
  const known = useKnownPeople();
  const person = (id: string) => {
    if (id === session?.user.id) return { name: t('chats.you'), avatar: undefined };
    const profile = known.get(id) ?? (chat?.otherUser?.id === id ? chat.otherUser : undefined);
    return {
      name: profile?.displayName ?? t('chats.unknownPerson'),
      avatar: profile?.avatar?.small,
    };
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        title={props.option.text}
        description={t('polls.votes', { count: props.option.voterIds.length })}
      >
        <ul
          className="-mx-1 max-h-80 space-y-1 overflow-y-auto"
          aria-label={t('polls.votersTitle')}
        >
          {props.option.voterIds.map((id) => {
            const { name, avatar } = person(id);
            return (
              <li key={id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                <Avatar name={name} src={avatar} className="size-9 text-xs" />
                <span className="truncate font-medium">{name}</span>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
