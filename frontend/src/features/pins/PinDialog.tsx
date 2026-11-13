import { type PinDuration, pinDurationSchema } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { authErrorMessage } from '@/features/auth/errors';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatRow } from '@/features/sync/local-db';
import { pinsApi, replacesOldest, storePins, usePinDialog } from './pins';

/** "Pin for 24 hours, 7 days or 30 days", and a warning when it replaces the oldest pin. */
export function PinDialog({ chat }: { chat: ChatRow }) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const request = usePinDialog((state) =>
    state.request?.chatId === chat.id ? state.request : null,
  );
  const close = usePinDialog((state) => state.close);
  const [duration, setDuration] = useState<PinDuration>('7d');
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  const pin = async () => {
    setBusy(true);
    try {
      const { pins } = await pinsApi.pin(chat.id, request.messageId, duration);
      await storePins(db, chat.id, pins);
      close();
    } catch (error) {
      toast.error(authErrorMessage(error, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent
        title={t('pins.dialogTitle')}
        description={
          replacesOldest(chat.pins, request.messageId) ? t('pins.replacesOldest') : undefined
        }
        className="max-w-sm"
      >
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{t('pins.howLong')}</legend>
          {pinDurationSchema.options.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="pin-duration"
                value={value}
                checked={duration === value}
                onChange={() => setDuration(value)}
                className="accent-brand"
              />
              {t(`pins.durations.${value}`)}
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void pin()} disabled={busy}>
            {t('pins.pin')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
