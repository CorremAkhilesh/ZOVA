import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportEvidence } from '@zuvo/protocol';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { authErrorMessage } from '@/features/auth/errors';
import { cn } from '@/lib/utils';
import { adminReportsApi } from '../api';

function Evidence({ items }: { items: ReportEvidence[] }) {
  const { t, i18n } = useTranslation();
  if (items.length === 0)
    return <p className="text-sm text-text-muted">{t('adminReports.noEvidence')}</p>;
  return (
    <ol aria-label={t('adminReports.evidence')} className="max-h-64 space-y-2 overflow-y-auto">
      {items.map((item) => (
        <li
          key={item.messageId}
          className={cn(
            'rounded-lg border p-2 text-sm',
            item.selected && 'border-danger bg-danger/5',
          )}
        >
          <p className="text-xs text-text-muted">
            {item.senderName} · {new Date(item.createdAt).toLocaleString(i18n.language)}
            {item.selected ? ` · ${t('adminReports.picked')}` : ''}
          </p>
          {/* Plain text on purpose: evidence is shown exactly as typed, never formatted. */}
          <p className="whitespace-pre-wrap break-words">
            {item.text ?? item.fileName ?? t('adminReports.noText', { type: item.type })}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** One report: who, why, the copied messages, and Resolve / Deactivate. Opening it is audited. */
export function ReportDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [note, setNote] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'report', id],
    queryFn: async () => (await adminReportsApi.get(id)).report,
  });
  const resolve = useMutation({
    mutationFn: (action: 'none' | 'deactivate') => adminReportsApi.resolve(id, action, note),
    onSuccess: () => {
      toast.success(t('adminReports.resolved'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
      onClose();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const report = query.data;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={t('adminReports.detailTitle')} className="max-w-lg">
        {query.isPending ? (
          <p role="status" className="text-sm text-text-muted">
            {t('common.loading')}
          </p>
        ) : !report ? (
          <p role="alert" className="text-sm text-danger">
            {t('adminReports.loadFailed')}
          </p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-text-muted">{t('adminReports.reporter')}</dt>
              <dd>{`${report.reporter.displayName} (${report.reporter.email})`}</dd>
              <dt className="text-text-muted">{t('adminReports.reported')}</dt>
              <dd>
                {report.reported
                  ? `${report.reported.displayName} (${report.reported.email})${
                      report.reported.status === 'deactivated'
                        ? ` · ${t('adminReports.deactivated')}`
                        : ''
                    }`
                  : (report.group?.name ?? '')}
              </dd>
              <dt className="text-text-muted">{t('report.reason')}</dt>
              <dd>{t(`report.reasons.${report.reason}`)}</dd>
              {report.note ? (
                <>
                  <dt className="text-text-muted">{t('report.note')}</dt>
                  <dd className="whitespace-pre-wrap">{report.note}</dd>
                </>
              ) : null}
              {report.blocked ? (
                <>
                  <dt className="text-text-muted">{t('adminReports.blockedLabel')}</dt>
                  <dd>{t('adminReports.blockedYes')}</dd>
                </>
              ) : null}
            </dl>
            <Evidence items={report.evidence} />
            {report.status === 'open' ? (
              <>
                <div className="space-y-1">
                  <label htmlFor={noteId} className="text-sm font-medium">
                    {t('adminReports.resolutionNote')}
                  </label>
                  <textarea
                    id={noteId}
                    rows={2}
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="w-full resize-none rounded-lg border bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {report.reported && report.reported.status === 'active' ? (
                    <Button
                      variant="danger"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate('deactivate')}
                    >
                      {t('adminReports.deactivate', { name: report.reported.displayName })}
                    </Button>
                  ) : null}
                  <Button disabled={resolve.isPending} onClick={() => resolve.mutate('none')}>
                    {t('adminReports.resolve')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-text-muted">
                {t(`adminReports.resolution.${report.resolution?.action ?? 'none'}`)}
                {report.resolution?.note ? ` · ${report.resolution.note}` : ''}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
