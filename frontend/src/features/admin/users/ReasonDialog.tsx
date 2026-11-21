import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/**
 * Every admin change: what will happen, why (kept in the audit log), then confirm. `children` adds
 * fields of its own (a storage limit); `ready` says whether they are filled in.
 */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger = false,
  pending = false,
  ready = true,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  ready?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && ready && !pending) onConfirm(trimmed);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          onClose();
        }
      }}
    >
      <DialogContent title={title} description={description}>
        <form className="space-y-4" onSubmit={submit}>
          {children}
          <div className="space-y-1.5">
            <label htmlFor={`${id}-reason`} className="block text-sm font-medium">
              {t('adminPanel.reason.label')}
            </label>
            <textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REASON_MAX}
              rows={3}
              required
              aria-describedby={`${id}-hint`}
              className="w-full resize-y rounded-lg border bg-surface px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20"
            />
            <p id={`${id}-hint`} className="text-xs text-text-muted">
              {t('adminPanel.reason.hint')}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant={danger ? 'danger' : 'default'}
              disabled={!valid || !ready || pending}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
