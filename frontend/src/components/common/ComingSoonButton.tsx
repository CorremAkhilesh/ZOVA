import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ComingSoonButtonProps {
  label: string;
  icon: LucideIcon;
  className?: string;
}

/** Visible but inactive. aria-disabled rather than disabled, so keyboards can reach the tooltip. */
export function ComingSoonButton({ label, icon: Icon, className }: ComingSoonButtonProps) {
  const { t } = useTranslation();
  return (
    <Tooltip label={t('common.comingSoon')} side="top">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-disabled="true"
        onClick={(event) => event.preventDefault()}
        className={cn('cursor-not-allowed opacity-50', className)}
      >
        <Icon className="size-5" />
      </Button>
    </Tooltip>
  );
}
