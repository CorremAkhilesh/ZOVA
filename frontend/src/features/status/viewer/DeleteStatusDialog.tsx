import type { Status } from '@zuvo/protocol';
import { AlertDialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteMyStatus } from '../actions';
import { useStatusViewer } from './queue';

/**
 * "Delete this status?", over the viewer (z 1700: the viewer is 1600). Deleting takes it out of the
 * viewer at once (the next one shows, or the list after the last), then out of the list and off the
 * server; everyone else's list drops it on the server's `status:changed`.
 */
export function DeleteStatusDialog(props: { status: Status; onClose: () => void }) {
  const { t } = useTranslation();
  const confirm = () => {
    props.onClose();
    const id = props.status.id;
    useStatusViewer.getState().keepOnly((status) => status.id !== id);
    void deleteMyStatus(props.status)
      .then(() => toast.success(t('updates.deleted')))
      .catch(() => toast.error(t('updates.failed')));
  };
  return (
    <AlertDialog.Root open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[1700] bg-black/60 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[1700] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border bg-elevated p-5 text-text shadow-xl motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:zoom-in-95">
          <div className="space-y-1">
            <AlertDialog.Title className="text-lg font-semibold">
              {t('updates.deleteTitle')}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-text-muted">
              {t('updates.deleteBody')}
            </AlertDialog.Description>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">{t('common.cancel')}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={confirm}>
                {t('updates.deleteConfirm')}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
