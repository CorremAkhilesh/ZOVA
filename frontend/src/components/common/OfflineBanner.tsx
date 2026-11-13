import { WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/lib/hooks';

/** Shown while the browser is offline. Messages wait in the outbox meanwhile. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  return (
    <AnimatePresence>
      {online ? null : (
        <motion.div
          role="alert"
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0 }}
          className="overflow-hidden bg-warning text-text-inverse"
        >
          <p className="flex items-center justify-center gap-2 px-4 py-1.5 text-sm font-medium">
            <WifiOff className="size-4" aria-hidden />
            {t('status.offline')}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
