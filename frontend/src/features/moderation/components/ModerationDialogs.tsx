import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReportReason, reportReasonSchema } from '@zuvo/protocol';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { authErrorMessage } from '@/features/auth/errors';
import { moderationApi } from '../api';
import { blocksQuery, useBlockToggle } from '../blocks';
import { type ReportRequest, useModeration } from '../store';

const REASONS = reportReasonSchema.options;
const NOTE_MAX = 500;

function ReportDialog({ request, onClose }: { request: ReportRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const { person } = request;
  const send = useMutation({
    mutationFn: () =>
      moderationApi.report({
        target: request.target,
        reason: reason ?? 'other',
        ...(note.trim() ? { note: note.trim() } : {}),
        block: alsoBlock && person !== null,
      }),
    onSuccess: ({ blocked }) => {
      toast.success(t(blocked ? 'report.sentBlocked' : 'report.sent'));
      if (blocked) void queryClient.invalidateQueries({ queryKey: blocksQuery.queryKey });
      onClose();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const title =
    request.target.kind === 'group'
      ? t('report.titleGroup', { name: request.groupName ?? '' })
      : request.target.kind === 'message'
        ? t('report.titleMessage', { name: person?.displayName ?? '' })
        : t('report.titleUser', { name: person?.displayName ?? '' });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={title} description={t('report.explain')} className="max-w-md">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason) send.mutate();
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium">{t('report.reason')}</legend>
            {REASONS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reason"
                  value={value}
                  checked={reason === value}
                  onChange={() => setReason(value)}
                  className="accent-brand"
                />
                {t(`report.reasons.${value}`)}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <label htmlFor={noteId} className="text-sm font-medium">
              {t('report.note')}
            </label>
            <textarea
              id={noteId}
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              className="w-full resize-none rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand"
            />
          </div>
          {person ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={alsoBlock}
                onChange={(event) => setAlsoBlock(event.target.checked)}
                className="accent-brand"
              />
              {t('report.alsoBlock', { name: person.displayName })}
            </label>
          ) : null}
          <p className="text-xs text-text-muted">{t('report.evidence')}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={!reason || send.isPending}>
              {t(alsoBlock && person ? 'report.sendAndBlock' : 'report.send')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Block X?", with what it means. */
function BlockDialog({
  person,
  onClose,
}: {
  person: NonNullable<ReturnType<typeof useModeration.getState>['confirmBlock']>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toggle = useBlockToggle();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={t('blocks.confirmTitle', { name: person.displayName })}
        description={t('blocks.confirmText')}
        className="max-w-sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              toggle.mutate({ user: person, block: true });
              onClose();
            }}
          >
            {t('blocks.block')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The report and block dialogs, wherever they were asked for. Loaded only when needed. */
export default function ModerationDialogs() {
  const report = useModeration((state) => state.report);
  const confirmBlock = useModeration((state) => state.confirmBlock);
  const close = useModeration((state) => state.close);
  if (report) return <ReportDialog request={report} onClose={close} />;
  if (confirmBlock) return <BlockDialog person={confirmBlock} onClose={close} />;
  return null;
}
