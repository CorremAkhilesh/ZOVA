import { MESSAGE_TEXT_MAX } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import type { RecorderProblem } from '@/features/voice/recorder-machine';
import { cn } from '@/lib/utils';

/** The counter appears this close to the limit. */
const COUNTER_FROM = 200;

/** Above the composer: why the mic did not start, and how much room the text has left. */
export function ComposerNotices({
  textLength,
  problem,
}: {
  textLength: number;
  problem: RecorderProblem | null;
}) {
  const { t } = useTranslation();
  const remaining = MESSAGE_TEXT_MAX - textLength;
  return (
    <>
      {problem && problem !== 'blocked' ? (
        <p role="status" className="mb-1 px-2 text-xs font-medium text-text-muted">
          {t(`voice.problems.${problem}`)}
        </p>
      ) : null}
      {remaining <= COUNTER_FROM ? (
        <p
          role="status"
          className={cn(
            'mb-1 px-2 text-right text-xs tabular-nums',
            remaining < 0 ? 'font-semibold text-danger' : 'text-text-muted',
          )}
        >
          {remaining < 0
            ? t('conversation.tooLong', { count: -remaining })
            : t('conversation.charsLeft', { count: remaining })}
        </p>
      ) : null}
    </>
  );
}
