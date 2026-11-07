import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface FormattingHintProps {
  /** Lets the composer point `aria-describedby` at the hint. */
  id?: string | undefined;
  className?: string | undefined;
}

/**
 * "*bold* _italic_ ~strike~ `code`" in muted text, each sample shown in its own style. Screen
 * readers get one plain sentence instead of the marker characters.
 */
export function FormattingHint({ id, className }: FormattingHintProps) {
  const { t } = useTranslation();
  const marker = 'text-text-muted/70';
  return (
    <p id={id} className={cn('select-none text-xs text-text-muted', className)}>
      <span className="sr-only">{t('formatting.hint')}</span>
      <span aria-hidden className="inline-flex flex-wrap gap-x-2">
        <span>
          <span className={marker}>*</span>
          <strong className="font-semibold">{t('formatting.bold')}</strong>
          <span className={marker}>*</span>
        </span>
        <span>
          <span className={marker}>_</span>
          <em>{t('formatting.italic')}</em>
          <span className={marker}>_</span>
        </span>
        <span>
          <span className={marker}>~</span>
          <s>{t('formatting.strike')}</s>
          <span className={marker}>~</span>
        </span>
        <span>
          <span className={marker}>`</span>
          <code className="font-mono">{t('formatting.codeSample')}</code>
          <span className={marker}>`</span>
        </span>
      </span>
    </p>
  );
}
