import { CalendarClock } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { formatSendAt, zoneOffsetName } from '../time';
import type { useSendAt } from '../use-send-at';

const QUICK =
  'flex flex-1 flex-col items-start rounded-xl border bg-surface px-3 py-2 text-left text-sm hover:bg-background focus-visible:ring-2 focus-visible:ring-brand/40 outline-none';

/** "Tomorrow 9 AM", "Monday 9 AM", or a date and time of my own, labelled with my time zone. */
export function SendAtFields({ sendAt }: { sendAt: ReturnType<typeof useSendAt> }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { zone, value, problem } = sendAt;
  const choices = [
    { key: 'tomorrow', at: sendAt.quick.tomorrow() },
    { key: 'monday', at: sendAt.quick.monday() },
  ] as const;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            className={QUICK}
            onClick={() => sendAt.pick(choice.at)}
          >
            <span className="font-medium">{t(`scheduled.quick.${choice.key}`)}</span>
            <span className="text-xs text-text-muted">
              {formatSendAt(choice.at, i18n.language, zone)}
            </span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <label htmlFor={`${id}-date`} className="text-sm font-medium">
            {t('scheduled.date')}
          </label>
          <Input
            id={`${id}-date`}
            type="date"
            value={value.date}
            aria-invalid={problem !== null}
            aria-describedby={`${id}-zone${problem ? ` ${id}-problem` : ''}`}
            onChange={(event) => sendAt.set({ date: event.target.value })}
          />
        </div>
        <div className="w-32 space-y-1">
          <label htmlFor={`${id}-time`} className="text-sm font-medium">
            {t('scheduled.time')}
          </label>
          <Input
            id={`${id}-time`}
            type="time"
            value={value.time}
            aria-invalid={problem !== null}
            aria-describedby={`${id}-zone${problem ? ` ${id}-problem` : ''}`}
            onChange={(event) => sendAt.set({ time: event.target.value })}
          />
        </div>
      </div>
      <p id={`${id}-zone`} className="flex items-center gap-1.5 text-xs text-text-muted">
        <CalendarClock className="size-3.5" aria-hidden />
        {t('scheduled.zone', { zone, offset: zoneOffsetName(zone) })}
      </p>
      {problem ? (
        <p id={`${id}-problem`} role="alert" className="text-sm font-medium text-danger">
          {t(`scheduled.problems.${problem}`)}
        </p>
      ) : null}
    </div>
  );
}
