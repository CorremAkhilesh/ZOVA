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
import { useGroupMax } from '@/components/common/use-nav-items';
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
  const groupMax = useGroupMax(GROUP_MEMBERS_MAX);
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
          max={groupMax - members.length}
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

/** Me first, then the owner, admins, and everyone else by name. */
export function orderMembers(members: GroupMember[], me: string): GroupMember[] {
  const rank = (member: GroupMember) =>
    member.user.id === me ? 0 : member.role === 'owner' ? 1 : member.role === 'admin' ? 2 : 3;
  return [...members].sort(
    (a, b) =>
      rank(a) - rank(b) || (a.user.displayName ?? '').localeCompare(b.user.displayName ?? ''),
  );
}

/** Under a member's name: their about, else their @username. */
const memberLine = (user: PublicProfile) =>
  user.about || (user.username ? `@${user.username}` : '');

/** Who is in the group, and what I can do about each of them. */
export function GroupMembersSection(props: {
  chatId: string;
  group: GroupInfo;
  members: GroupMember[] | undefined;
  me: string;
  adding: boolean;
  onAdding: (adding: boolean) => void;
}) {
  const { t } = useTranslation();
  const { chatId, group, members, me, adding, onAdding } = props;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const abilities = groupAbilities(group);
  const needle = query.trim().toLowerCase();
  const shown = orderMembers(members ?? [], me).filter((member) =>
    (member.user.displayName ?? '').toLowerCase().includes(needle),
  );
  return (
    <section aria-label={t('groups.membersTitle')} className="space-y-1 py-2">
      <div className="flex items-center justify-between px-5">
        <h3 className="text-sm text-text-muted">
          {t('conversation.members', { count: group.memberCount })}
        </h3>
      </div>
      <div className="px-5 py-1">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('groups.searchMembers')}
          aria-label={t('groups.searchMembers')}
        />
      </div>
      {abilities.addMembers ? (
        <button
          type="button"
          onClick={() => onAdding(true)}
          className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-left hover:bg-background"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-brand text-brand-foreground">
            <UserPlus className="size-5" aria-hidden />
          </span>
          {t('groups.addMembers')}
        </button>
      ) : null}
      <ul aria-label={t('groups.membersTitle')}>
        {shown.map((member) => (
          <li key={member.user.id} className="px-5">
            <div className="flex min-h-14 items-center gap-3 py-1.5">
              <Avatar
                name={member.user.displayName ?? ''}
                src={member.user.avatar?.small}
                className="size-10 text-sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {member.user.id === me ? t('groups.you') : member.user.displayName}
                </span>
                {memberLine(member.user) ? (
                  <span className="block truncate text-xs text-text-muted">
                    {memberLine(member.user)}
                  </span>
                ) : null}
              </span>
              {member.role === 'member' ? null : (
                <Badge variant="muted" className="shrink-0 text-accent-text">
                  {t(`groups.roleBadge.${member.role}`)}
                </Badge>
              )}
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
        <AddMembers chatId={chatId} members={members} onClose={() => onAdding(false)} />
      ) : null}
    </section>
  );
}
