import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminUserRow } from '@zuvo/protocol';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { authErrorMessage } from '@/features/auth/errors';
import { formatBytes } from '@/features/media/process';
import { storageApi } from './api';

const MB = 1024 * 1024;
const MIN_GB = 0.1;
const MAX_GB = 1024;

/** Admin → Users: one person's storage limit, in GB, or back to the default. Audited on the server. */
export function StorageQuotaDialog({
  user,
  onClose,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [gb, setGb] = useState('');
  const save = useMutation({
    mutationFn: (quotaMb: number | null) => storageApi.setQuota(user?.id ?? '', quotaMb),
    onSuccess: () => {
      toast.success(t('admin.saved'));
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  const value = Number(gb.replace(',', '.'));
  const valid = gb.trim() !== '' && Number.isFinite(value) && value >= MIN_GB && value <= MAX_GB;
  const name = user ? (user.displayName ?? user.email) : '';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate(Math.round(value * 1024));
  }

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t('storage.admin.title', { name })}
        description={
          user
            ? t('storage.admin.current', {
                used: formatBytes(user.storageBytes, i18n.language),
                limit: formatBytes(user.quotaBytes, i18n.language),
              })
            : ''
        }
      >
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5 text-sm font-medium" htmlFor="storage-quota-gb">
            <span>{t('storage.admin.label')}</span>
            <Input
              id="storage-quota-gb"
              inputMode="decimal"
              value={gb}
              onChange={(event) => setGb(event.target.value)}
              placeholder={String(Math.round((user?.quotaBytes ?? 0) / MB / 1024))}
              aria-invalid={gb.trim() !== '' && !valid}
              aria-describedby="storage-quota-hint"
            />
          </label>
          <p id="storage-quota-hint" className="text-xs text-text-muted">
            {t('storage.admin.hint', { min: MIN_GB, max: MAX_GB })}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              {t('storage.admin.useDefault')}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
