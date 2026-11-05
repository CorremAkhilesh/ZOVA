import { Loader2, Pause, Play, SendHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/features/media/process';
import { isNearLimit, type RecorderStatus } from '../recorder-machine';

interface RecordingBarProps {
  status: RecorderStatus;
  locked: boolean;
  elapsedMs: number;
  maxMs: number;
  levels: readonly number[];
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onSend: () => void;
}

/** Speech rarely gets near full scale, so quiet levels are lifted to be visible. */
const barHeight = (level: number) => `${Math.max(8, Math.min(100, Math.sqrt(level) * 180))}%`;

export function RecordingBar(props: RecordingBarProps) {
  const { status, locked, elapsedMs, maxMs, levels, onCancel, onPause, onResume, onSend } = props;
  const { t } = useTranslation();
  const asking = status === 'asking';
  const remaining = Math.max(0, Math.ceil((maxMs - elapsedMs) / 1000));
  return (
    <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border bg-surface px-2 py-1">
      {locked ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label={t('voice.cancel')}
        >
          <Trash2 className="size-5 text-danger" />
        </Button>
      ) : null}
      {asking ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full bg-danger motion-safe:animate-pulse"
        />
      )}
      <span role="timer" className="shrink-0 text-sm font-medium tabular-nums">
        {formatDuration(elapsedMs / 1000)}
      </span>
      {locked ? (
        <span
          aria-hidden
          className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden"
        >
          {levels.map((level, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: bars only ever scroll by
              key={index}
              style={{ height: barHeight(level) }}
              className="w-[3px] shrink-0 rounded-full bg-brand"
            />
          ))}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-text-muted">
          {t('voice.slideHint')}
        </span>
      )}
      {status === 'atLimit' ? (
        <p role="status" className="shrink-0 text-xs font-semibold text-danger">
          {t('voice.limitReached', { limit: formatDuration(maxMs / 1000) })}
        </p>
      ) : isNearLimit(elapsedMs, maxMs) && !asking ? (
        <p role="status" className="shrink-0 text-xs font-semibold text-danger">
          {t('voice.timeLeft', { count: remaining })}
        </p>
      ) : null}
      {locked && status === 'recording' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onPause}
          aria-label={t('voice.pauseRecording')}
        >
          <Pause className="size-5" />
        </Button>
      ) : null}
      {status === 'paused' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onResume}
          aria-label={t('voice.resumeRecording')}
        >
          <Play className="size-5" />
        </Button>
      ) : null}
      {locked ? (
        <Button
          type="button"
          size="icon"
          className="rounded-full"
          disabled={asking}
          onClick={onSend}
          aria-label={t('voice.send')}
        >
          <SendHorizontal className="size-5" />
        </Button>
      ) : null}
    </div>
  );
}
