import { Check, Delete } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatCountdown, useCountdown } from '../use-countdown';

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export interface PinPadProps {
  /** What to enter: "Enter your PIN", "Confirm your new PIN"… Names the group. */
  label: string;
  /** The ✓ key's name: "Unlock", "Next", "Save". */
  submitLabel: string;
  onSubmit: (pin: string) => void;
  error?: string | null | undefined;
  /** Too many wrong PINs: the pad waits, counting down, until then. */
  lockedUntil?: string | null | undefined;
  onLockoutEnd?: (() => void) | undefined;
  busy?: boolean | undefined;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const KEY =
  'flex h-14 items-center justify-center rounded-2xl bg-background text-xl font-semibold tabular-nums outline-none transition-colors hover:bg-brand-subtle focus-visible:ring-3 focus-visible:ring-brand/40 disabled:opacity-50';

/**
 * 4 to 6 digits, from the on-screen keys or the keyboard (digits, Backspace, Enter). The digits
 * never show: only dots, and a spoken count.
 */
export function PinPad(props: PinPadProps) {
  const { t } = useTranslation();
  const { label, submitLabel, onSubmit, error, lockedUntil, onLockoutEnd, busy } = props;
  const [value, setValue] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const statusId = useId();
  const errorId = useId();
  const left = useCountdown(lockedUntil ?? null, onLockoutEnd);
  const waiting = left > 0;
  const disabled = waiting || busy === true;

  useEffect(() => group.current?.focus(), []);
  // A wrong PIN starts over, with the keyboard still on the pad.
  useEffect(() => {
    if (!error) return;
    setValue('');
    group.current?.focus();
  }, [error]);

  const add = (digit: string) => {
    setTooShort(false);
    setValue((current) => (current.length < PIN_MAX ? current + digit : current));
  };
  const back = () => setValue((current) => current.slice(0, -1));
  const submit = () => {
    if (value.length < PIN_MIN) {
      setTooShort(true);
      return;
    }
    onSubmit(value);
    setValue('');
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const onButton = event.target instanceof HTMLButtonElement;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      add(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      back();
    } else if (event.key === 'Enter' && !onButton) {
      event.preventDefault();
      submit();
    }
  }

  const message = waiting
    ? t('lock.tryAgainIn', { time: formatCountdown(left) })
    : tooShort
      ? t('lock.pinLength')
      : (error ?? null);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a keypad with its own keyboard handling, not a form
    <div
      ref={group}
      role="group"
      aria-label={label}
      aria-describedby={message ? `${statusId} ${errorId}` : statusId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mx-auto flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-brand/40"
    >
      <p className="text-center font-medium">{label}</p>
      <div className={cn('flex gap-3', message && !waiting && 'animate-shake')} aria-hidden>
        {Array.from({ length: PIN_MAX }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
            key={index}
            data-testid="pin-dot"
            data-filled={index < value.length}
            className={cn(
              'size-3.5 rounded-full border-2 border-brand transition-colors',
              index < value.length ? 'bg-brand' : 'bg-transparent',
              index >= PIN_MIN && index >= value.length && 'opacity-40',
            )}
          />
        ))}
      </div>
      <p id={statusId} role="status" className="sr-only">
        {t('lock.digitsEntered', { count: value.length })}
      </p>
      <p
        id={errorId}
        role={message ? 'alert' : undefined}
        className="min-h-5 text-center text-sm text-danger tabular-nums"
      >
        {message}
      </p>
      <div className="grid w-full grid-cols-3 gap-2">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={KEY}
            disabled={disabled}
            onClick={() => add(digit)}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className={KEY}
          aria-label={t('lock.deleteDigit')}
          disabled={disabled || value.length === 0}
          onClick={back}
        >
          <Delete className="size-5" aria-hidden />
        </button>
        <button type="button" className={KEY} disabled={disabled} onClick={() => add('0')}>
          0
        </button>
        <button
          type="button"
          className={cn(KEY, 'bg-brand text-brand-foreground hover:bg-brand-hover')}
          aria-label={submitLabel}
          disabled={disabled}
          onClick={submit}
        >
          <Check className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
