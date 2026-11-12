import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLockStore } from '../store';
import { PinPrompt } from './PinPrompt';

/** The PIN (or Windows Hello) before locked chats show, for 5 minutes in this tab. */
export default function UnlockChatsDialog({ onClose }: { onClose: (unlocked: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose(false))}>
      <DialogContent
        title={t('lock.lockedChats')}
        description={t('lock.unlockChatsHint')}
        // The PIN pad takes the focus itself, so typing digits works at once.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <PinPrompt
          label={t('lock.enterPin')}
          onUnlocked={() => {
            useLockStore.getState().unlockChats();
            onClose(true);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
