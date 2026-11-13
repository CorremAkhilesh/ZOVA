import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const DOT_DELAYS = ['[animation-delay:-0.3s]', '[animation-delay:-0.15s]', ''];

/** "typing…" with animated dots. With reduced motion the dots simply stay still. */
export function TypingIndicator({
  className,
  label,
}: {
  className?: string;
  label?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center gap-1 text-accent-text', className)}>
      <span className="truncate">{label || t('conversation.typing')}</span>
      <span aria-hidden className="inline-flex items-center gap-0.5">
        {DOT_DELAYS.map((delay) => (
          <span
            key={delay}
            className={cn(
              'size-1 animate-bounce rounded-full bg-current motion-reduce:animate-none',
              delay,
            )}
          />
        ))}
      </span>
    </span>
  );
}
