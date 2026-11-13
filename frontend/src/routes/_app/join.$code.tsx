import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { useLocalDb } from '@/features/chats/queries';
import { groupsApi } from '@/features/groups/api';
import { applyChats } from '@/features/sync/apply';
import { ApiClientError } from '@/lib/api-client';

export const Route = createFileRoute('/_app/join/$code')({
  component: JoinGroup,
});

/** An invite link: says what the group is, and only joins when asked. */
function JoinGroup() {
  const { code } = Route.useParams();
  const { t } = useTranslation();
  const db = useLocalDb();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ['invite', code],
    queryFn: () => groupsApi.previewInvite(code),
    retry: false,
  });
  const open = (chatId: string) => navigate({ to: '/chats/$chatId', params: { chatId } });
  const join = useMutation({
    mutationFn: () => groupsApi.join(code),
    onSuccess: async (chat) => {
      if (db) await applyChats(db, [chat]);
      await open(chat.id);
    },
  });

  const invalid =
    preview.error instanceof ApiClientError && preview.error.apiError?.code === 'INVITE_INVALID';

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="glass w-full max-w-sm space-y-4 rounded-2xl border p-6 text-center">
        <h1 className="text-lg font-semibold">{t('groups.joinTitle')}</h1>
        {preview.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-2"
          >
            <Skeleton className="mx-auto size-20 rounded-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : null}
        {preview.isError ? (
          <>
            <p role="alert" className="text-sm text-danger">
              {invalid ? t('groups.inviteInvalid') : t('groups.inviteFailed')}
            </p>
            <Button asChild variant="outline">
              <Link to="/chats">{t('errors.goHome')}</Link>
            </Button>
          </>
        ) : null}
        {preview.data ? (
          <>
            <Avatar
              name={preview.data.name}
              src={preview.data.photo ?? undefined}
              className="mx-auto size-20 text-2xl"
            />
            <div>
              <p className="text-lg font-semibold">{preview.data.name}</p>
              <p className="text-sm text-text-muted">
                {t('conversation.members', { count: preview.data.memberCount })}
              </p>
            </div>
            {join.isError ? (
              <p role="alert" className="text-sm text-danger">
                {authErrorMessage(join.error, t)}
              </p>
            ) : null}
            {preview.data.alreadyMember ? (
              <Button className="w-full" onClick={() => void open(preview.data.chatId)}>
                {t('groups.openGroup')}
              </Button>
            ) : (
              <Button className="w-full" disabled={join.isPending} onClick={() => join.mutate()}>
                {t('groups.join')}
              </Button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
