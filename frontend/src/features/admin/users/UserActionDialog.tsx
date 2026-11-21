import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminBulkResponse } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { authErrorMessage } from '@/features/auth/errors';
import { adminUsersApi } from './api';
import { type QuotaChoice, QuotaPicker, quotaMbOf } from './QuotaPicker';
import { ReasonDialog } from './ReasonDialog';

export type UserActionKind =
  | 'deactivate'
  | 'reactivate'
  | 'promote'
  | 'demote'
  | 'signOut'
  | 'storageQuota';

/** Promote and demote are one person at a time; the rest also work on a selection. */
export const BULK_KINDS: UserActionKind[] = ['deactivate', 'reactivate', 'signOut', 'storageQuota'];
const DANGER: UserActionKind[] = ['deactivate', 'demote', 'signOut'];

export interface PendingAction {
  kind: UserActionKind;
  people: Array<{ id: string; name: string }>;
}

async function runOne(kind: UserActionKind, id: string, reason: string, quotaMb: number | null) {
  if (kind === 'deactivate' || kind === 'reactivate') {
    await adminUsersApi.setStatus(id, kind, reason);
  } else if (kind === 'promote' || kind === 'demote') {
    await adminUsersApi.setRole(id, kind === 'promote' ? 'admin' : 'user', reason);
  } else if (kind === 'signOut') {
    await adminUsersApi.signOut(id, reason);
  } else {
    await adminUsersApi.setQuota(id, quotaMb, reason);
  }
}

/**
 * Confirms an action with a reason (and a storage limit for that action), runs it for one person
 * or many, and says how it went. Every change lands in the audit log on the server.
 */
export function UserActionDialog({
  action,
  onClose,
  onDone,
  defaultGb,
}: {
  action: PendingAction | null;
  onClose: () => void;
  onDone?: (result: AdminBulkResponse | null) => void;
  defaultGb: number;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [quota, setQuota] = useState<QuotaChoice | null>(null);
  const kind = action?.kind ?? 'deactivate';
  const count = action?.people.length ?? 0;
  const name = count === 1 ? (action?.people[0]?.name ?? '') : '';
  const quotaMb = quotaMbOf(quota);

  const run = useMutation({
    mutationFn: async (reason: string): Promise<AdminBulkResponse | null> => {
      if (!action) return null;
      const limit = quotaMb ?? null;
      const [only] = action.people;
      if (action.people.length === 1 && only) {
        await runOne(action.kind, only.id, reason, limit);
        return null;
      }
      return adminUsersApi.bulk({
        userIds: action.people.map((person) => person.id),
        action: action.kind as 'deactivate' | 'reactivate' | 'signOut' | 'storageQuota',
        ...(action.kind === 'storageQuota' ? { quotaMb: limit } : {}),
        reason,
      });
    },
    onSuccess: (result) => {
      const refused = result?.results.filter((row) => !row.ok).length ?? 0;
      if (refused > 0) {
        toast.warning(t('adminPanel.users.bulkResult', { done: count - refused, refused }));
      } else {
        toast.success(t('admin.saved'));
      }
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      setQuota(null);
      onDone?.(result);
      onClose();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  const what = count === 1 ? { name } : { count };
  const variant = count === 1 ? 'one' : 'many';
  return (
    <ReasonDialog
      key={action ? `${kind}-${action.people.map((person) => person.id).join()}` : 'closed'}
      open={action !== null}
      onClose={() => {
        setQuota(null);
        onClose();
      }}
      title={t(`adminPanel.users.actions.${kind}.title.${variant}`, what)}
      description={t(`adminPanel.users.actions.${kind}.body`, what)}
      confirmLabel={t(`adminPanel.users.actions.${kind}.confirm`)}
      danger={DANGER.includes(kind)}
      pending={run.isPending}
      ready={kind !== 'storageQuota' || quotaMb !== undefined}
      onConfirm={(reason) => run.mutate(reason)}
    >
      {kind === 'storageQuota' ? (
        <QuotaPicker value={quota} onChange={setQuota} defaultGb={defaultGb} />
      ) : null}
    </ReasonDialog>
  );
}
