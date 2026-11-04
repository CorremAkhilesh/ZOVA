import { OTP_LENGTH } from '@zuvo/protocol';
import { type ClipboardEvent, type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all digits are filled. */
  onComplete: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

const digitsOnly = (text: string) => text.replace(/\D/g, '').slice(0, OTP_LENGTH);

/** Six single-digit boxes. Paste and SMS/email autofill fill all boxes at once. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  describedBy,
}: OtpInputProps) {
  const { t } = useTranslation();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, index) => value[index] ?? '');

  function update(next: string, focusIndex: number) {
    const clean = digitsOnly(next);
    onChange(clean);
    refs.current[Math.min(focusIndex, OTP_LENGTH - 1)]?.focus();
    if (clean.length === OTP_LENGTH) onComplete(clean);
  }

  function handleInput(index: number, text: string) {
    const typed = digitsOnly(text);
    if (!typed) return;
    // Autofill/paste into one box puts the whole code in; typing fills one box and moves on.
    if (typed.length > 1) {
      update(typed, typed.length);
      return;
    }
    const next = value.slice(0, index) + typed + value.slice(index + 1);
    update(next, index + 1);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) onChange(value.slice(0, index) + value.slice(index + 1));
      else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        refs.current[index - 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    else if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = digitsOnly(event.clipboardData.getData('text'));
    if (pasted) update(pasted, pasted.length);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of inputs; fieldset styling is not wanted
    <div
      role="group"
      aria-label={t('auth.codeLabel')}
      className={cn('flex gap-2', invalid && 'animate-shake')}
    >
      {digits.map((digit, index) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={index === 0 ? OTP_LENGTH : 1}
          value={digit}
          disabled={disabled}
          aria-label={t('auth.digitLabel', { position: index + 1, total: OTP_LENGTH })}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className={cn(
            // Boxes share the width, so all six always fit (down to 320 px screens).
            'h-12 min-w-0 flex-1 rounded-xl border bg-surface text-center text-xl font-semibold text-text tabular-nums outline-none transition-[border-color,box-shadow]',
            'focus:border-brand focus:ring-3 focus:ring-brand/20 disabled:opacity-60 sm:h-14',
            invalid && 'border-danger',
          )}
        />
      ))}
    </div>
  );
}
