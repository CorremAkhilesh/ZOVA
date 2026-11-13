import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LockStatus } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { LOCK_KEY, lockApi } from '../api';
import { type PinFailure, pinFailure } from '../errors';
import { PinPad } from './PinPad';

export type PinSetupMode = 'set' | 'change' | 'remove';
type Step = 'current' | 'new' | 'confirm';

const FIRST: Record<PinSetupMode, Step> = { set: 'new', change: 'current', remove: 'current' };
const TITLE: Record<PinSetupMode, string> = {
  set: 'lock.setTitle',
  change: 'lock.changeTitle',
  remove: 'lock.removeTitle',
};
const STEP_LABEL: Record<Step, string> = {
  current: 'lock.enterCurrent',
  new: 'lock.enterNew',
  confirm: 'lock.confirmNew',
};

interface Props {
  mode: PinSetupMode;
  onClose: () => void;
  /** Runs after the change was saved. */
  onDone?: (() => void) | undefined;
  /** Shown under the title, e.g. why a new PIN is needed after a reset. */
  description?: string | undefined;
}

/** Set a PIN (enter + confirm), change it (current, new, confirm) or remove it (current). */
export function PinSetupDialog({ mode, onClose, onDone, description }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(FIRST[mode]);
  const [current, setCurrent] = useState('');
  const [chosen, setChosen] = useState('');
  const [failure, setFailure] = useState<PinFailure | null>(null);

  const save = useMutation({
    mutationFn: async (pin: string) =>
      mode === 'remove' ? lockApi.removePin(pin) : lockApi.setPin(pin, current || undefined),
    onSuccess: ({ lock }: { lock?: LockStatus | undefined }) => {
      if (lock) queryClient.setQueryData(LOCK_KEY, lock);
      void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
      toast.success(
        t(mode === 'remove' ? 'lock.removed' : mode === 'set' ? 'lock.set' : 'lock.changed'),
      );
      onDone?.();
      onClose();
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
      setFailure(pinFailure(error, t));
      // A wrong current PIN: ask for it again.
      setStep(FIRST[mode]);
      setCurrent('');
      setChosen('');
    },
  });

  const submit = (pin: string) => {
    setFailure(null);
    if (step === 'current') {
      if (mode === 'remove') save.mutate(pin);
      else {
        setCurrent(pin);
        setStep('new');
      }
    } else if (step === 'new') {
      setChosen(pin);
      setStep('confirm');
    } else if (pin === chosen) {
      save.mutate(pin);
    } else {
      setFailure({ message: t('lock.mismatch'), lockedUntil: null });
      setChosen('');
      setStep('new');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={t(TITLE[mode])}
        description={description}
        // The PIN pad takes the focus itself, so typing digits works at once.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <PinPad
          key={step}
          label={t(STEP_LABEL[step])}
          submitLabel={t(step === 'new' ? 'lock.next' : 'lock.save')}
          onSubmit={submit}
          error={failure?.message}
          lockedUntil={failure?.lockedUntil}
          onLockoutEnd={() => setFailure(null)}
          busy={save.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
