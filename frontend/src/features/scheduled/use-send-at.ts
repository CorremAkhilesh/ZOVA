import { useState } from 'react';
import {
  browserTimeZone,
  checkSendAt,
  fromInputs,
  nextMondayAt,
  type SendAtProblem,
  toInputs,
  tomorrowAt,
} from './time';

/** The date and time pickers, in my time zone, with the quick choices and the limits. */
export function useSendAt(initial: Date | null) {
  const [zone] = useState(browserTimeZone);
  const [value, setValue] = useState(() => toInputs(initial ?? tomorrowAt(new Date(), zone), zone));
  const [problem, setProblem] = useState<SendAtProblem | null>(null);

  const set = (next: Partial<typeof value>) => {
    setProblem(null);
    setValue((current) => ({ ...current, ...next }));
  };
  const quick = {
    tomorrow: () => tomorrowAt(new Date(), zone),
    monday: () => nextMondayAt(new Date(), zone),
  };

  return {
    zone,
    value,
    problem,
    set,
    setProblem,
    quick,
    pick: (at: Date) => set(toInputs(at, zone)),
    /** The chosen moment, or null after showing why it can't be used. */
    resolve(): Date | null {
      const at = fromInputs(value.date, value.time, zone);
      const found = checkSendAt(at, new Date());
      setProblem(found);
      return found ? null : at;
    },
  };
}
