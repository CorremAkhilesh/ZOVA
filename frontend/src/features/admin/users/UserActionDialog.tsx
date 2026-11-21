import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminBulkAction, AdminBulkResponse } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { authErrorMessage } from '@/features/auth/errors';
import { adminUsersApi } from './api';
import { type QuotaChoice, QuotaPicker, quotaMbOf } from './QuotaPicker';
import { ReasonDialog } from './ReasonDialog';
import { type SuspendChoice, SuspendPicker, suspendUntilOf } from './SuspendPicker';

export type UserActionKind = AdminBulkAction | 'promote' | 'demote';

/** Promote and demote are one person at a time; the rest also work on a selection. */
export const BULK_KINDS: AdminBulkAction[] = [
  'suspend',
  'unsuspend',
  'signOut',
  'storageQuota',
  'deactivate',
  'reactivate',
];
const DANGER: UserActionKind[] = ['deactivate', 'demote', 'signOut', 'suspend'];

export interface PendingAction {
  kind: UserActionKind;
  people: Array<{ id: string; name: string }>;
}

interface Extra {
  quotaMb: number | null;
  until: string;
}

async function runOne(kind: UserActionKind, id: string, reason: string, extra: Extra) {
  if (kind === 'deactivate' || kind === 'reactivate') {
    await adminUsersApi.setStatus(id, kind, reason);
  } else if (kind === 'promote' || kind === 'demote') {
    await adminUsersApi.setRole(id, kind === 'promote' ? 'admin' : 'user', reason);
  } else if (kind === 'signOut') {
    await adminUsersApi.signOut(id, reason);
  } else if (kind === 'suspend') {
    await adminUsersApi.suspend(id, extra.until, reason);
  } else if (kind === 'unsuspend') {
    await adminUsersApi.unsuspend(id, reason);
  } else {
    await adminUsersApi.setQuota(id, extra.quotaMb, reason);
  }
}

/**
 * Confirms an action with a reason (and a storage limit or an end date where the action needs one),
 * runs it for one person or many, and says how it went. Every change is audited on the server.
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
  const [suspend, setSuspend] = useState<SuspendChoice | null>(null);
  const kind = action?.kind ?? 'deactivate';
  const count = action?.people.length ?? 0;
  const name = count === 1 ? (action?.people[0]?.name ?? '') : '';
  const quotaMb = quotaMbOf(quota);
  const until = suspendUntilOf(suspend);
  const reset = () => {
    setQuota(null);
    setSuspend(null);
  };

  const run = useMutation({
    mutationFn: async (reason: string): Promise<AdminBulkResponse | null> => {
      if (!action) return null;
      const extra = { quotaMb: quotaMb ?? null, until: until ?? '' };
      const [only] = action.people;
      if (action.people.length === 1 && only) {
        await runOne(action.kind, only.id, reason, extra);
        return null;
      }
      return adminUsersApi.bulk({
        userIds: action.people.map((person) => person.id),
        action: action.kind as AdminBulkAction,
        ...(action.kind === 'storageQuota' ? { quotaMb: extra.quotaMb } : {}),
        ...(action.kind === 'suspend' ? { until: extra.until } : {}),
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
      reset();
      onDone?.(result);
      onClose();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  const what = count === 1 ? { name } : { count };
  const variant = count === 1 ? 'one' : 'many';
  const ready =
    (kind !== 'storageQuota' || quotaMb !== undefined) &&
    (kind !== 'suspend' || until !== undefined);
  return (
    <ReasonDialog
      key={action ? `${kind}-${action.people.map((person) => person.id).join()}` : 'closed'}
      open={action !== null}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t(`adminPanel.users.actions.${kind}.title.${variant}`, what)}
      description={t(`adminPanel.users.actions.${kind}.body`, what)}
      confirmLabel={t(`adminPanel.users.actions.${kind}.confirm`)}
      danger={DANGER.includes(kind)}
      pending={run.isPending}
      ready={ready}
      onConfirm={(reason) => run.mutate(reason)}
    >
      {kind === 'storageQuota' ? (
        <QuotaPicker value={quota} onChange={setQuota} defaultGb={defaultGb} />
      ) : null}
      {kind === 'suspend' ? <SuspendPicker value={suspend} onChange={setSuspend} /> : null}
    </ReasonDialog>
  );
}
