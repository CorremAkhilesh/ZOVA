import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  GROUP_MEMBERS_MAX,
  type GroupInfo,
  type GroupMember,
  type PublicProfile,
} from '@zuvo/protocol';
import { MoreVertical, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { authErrorMessage } from '@/features/auth/errors';
import { chatsApi } from '@/features/chats/api';
import { useLocalDb } from '@/features/chats/queries';
import { applyChats } from '@/features/sync/apply';
import { groupsApi } from '../api';
import { membersKey } from '../queries';
import { groupAbilities } from '../rules';
import { PeopleSelect } from './PeopleSelect';

const ACTION = 'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-background';

function MemberActions(props: {
  chatId: string;
  member: GroupMember;
  group: GroupInfo;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { chatId, member, group, onDone } = props;
  const { id } = member.user;
  const abilities = groupAbilities(group);
  const queryClient = useQueryClient();
  const db = useLocalDb();
  const navigate = useNavigate();
  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(chatId) });
      onDone();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const message = async () => {
    const chat = await chatsApi.createDirect(id);
    if (db) await applyChats(db, [chat]);
    await navigate({ to: '/chats/$chatId', params: { chatId: chat.id } });
  };
  return (
    <fieldset className="mt-1 rounded-lg border p-1">
      <legend className="sr-only">{member.user.displayName}</legend>
      {member.user.deactivated ? null : (
        <button type="button" className={ACTION} onClick={() => run.mutate(message)}>
          {t('groups.messagePrivately', { name: member.user.displayName })}
        </button>
      )}
      {abilities.changeRoles && member.role !== 'owner' ? (
        <button
          type="button"
          className={ACTION}
          onClick={() =>
            run.mutate(() =>
              groupsApi.setRole(chatId, id, member.role === 'admin' ? 'member' : 'admin'),
            )
          }
        >
          {member.role === 'admin' ? t('groups.removeAdmin') : t('groups.makeAdmin')}
        </button>
      ) : null}
      {abilities.transfer && member.role !== 'owner' ? (
        <button
          type="button"
          className={ACTION}
          onClick={() => run.mutate(() => groupsApi.transfer(chatId, id))}
        >
          {t('groups.makeOwner')}
        </button>
      ) : null}
      {abilities.canRemove(member.role) ? (
        <button
          type="button"
          className={`${ACTION} text-danger`}
          onClick={() => run.mutate(() => groupsApi.removeMember(chatId, id))}
        >
          {t('groups.remove')}
        </button>
      ) : null}
    </fieldset>
  );
}

function AddMembers(props: { chatId: string; members: GroupMember[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { chatId, members, onClose } = props;
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: () =>
      groupsApi.addMembers(
        chatId,
        people.map((person) => person.id),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(chatId) });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t('groups.addMembers')} className="max-w-lg">
        <PeopleSelect
          selected={people}
          onChange={setPeople}
          excludeIds={new Set(members.map((member) => member.user.id))}
          max={GROUP_MEMBERS_MAX - members.length}
        />
        {add.isError ? (
          <p role="alert" className="text-sm text-danger">
            {authErrorMessage(add.error, t)}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={people.length === 0 || add.isPending} onClick={() => add.mutate()}>
            {t('groups.add')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Who is in the group, and what I can do about each of them. */
export function GroupMembersSection(props: {
  chatId: string;
  group: GroupInfo;
  members: GroupMember[] | undefined;
  me: string;
}) {
  const { t } = useTranslation();
  const { chatId, group, members, me } = props;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const abilities = groupAbilities(group);
  const shown = (members ?? []).filter((member) =>
    (member.user.displayName ?? '').toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section aria-label={t('groups.membersTitle')} className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t('conversation.members', { count: group.memberCount })}
        </h3>
        {abilities.addMembers ? (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden />
            {t('groups.add')}
          </Button>
        ) : null}
      </div>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('groups.searchMembers')}
        aria-label={t('groups.searchMembers')}
      />
      <ul className="space-y-1">
        {shown.map((member) => (
          <li key={member.user.id}>
            <div className="flex items-center gap-2">
              <Avatar
                name={member.user.displayName ?? ''}
                src={member.user.avatar?.small}
                className="size-8 text-xs"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {member.user.id === me ? t('groups.you') : member.user.displayName}
              </span>
              {member.role === 'member' ? null : <Badge>{t(`groups.role.${member.role}`)}</Badge>}
              {member.user.id === me ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('groups.actionsFor', { name: member.user.displayName })}
                  aria-expanded={open === member.user.id}
                  onClick={() => setOpen(open === member.user.id ? null : member.user.id)}
                >
                  <MoreVertical className="size-4" />
                </Button>
              )}
            </div>
            {open === member.user.id ? (
              <MemberActions
                chatId={chatId}
                member={member}
                group={group}
                onDone={() => setOpen(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {adding && members ? (
        <AddMembers chatId={chatId} members={members} onClose={() => setAdding(false)} />
      ) : null}
    </section>
  );
}
