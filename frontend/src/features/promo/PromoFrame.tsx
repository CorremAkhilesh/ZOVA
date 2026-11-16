import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface PromoFrameProps {
  titleId: string;
  icon: ReactNode;
  title: string;
  /** The one action: Enable, Install, How to install… */
  action: ReactNode;
  onNotNow: () => void;
}

/**
 * A compact bar laid over the bottom of the chat list. It is out of the page flow (absolute), so
 * nothing in the list moves when it appears, and it slides in with transform/opacity only.
 */
export function PromoFrame({ titleId, icon, title, action, onNotNow }: PromoFrameProps) {
  const { t } = useTranslation();
  return (
    <aside
      aria-labelledby={titleId}
      data-testid="promo-bar"
      className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-2 rounded-2xl border border-brand/20 bg-elevated py-1.5 pr-1.5 pl-3 shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
    >
      <span className="shrink-0 text-brand-text" aria-hidden>
        {icon}
      </span>
      <p id={titleId} className="line-clamp-2 min-w-0 flex-1 text-xs font-medium">
        {title}
      </p>
      {action}
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={onNotNow}
        aria-label={t('promo.notNow')}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </aside>
  );
}
