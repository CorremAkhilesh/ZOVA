import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { PinPad, type PinPadProps } from './components/PinPad';
import { formatCountdown } from './use-countdown';

const filled = () =>
  screen.getAllByTestId('pin-dot').filter((dot) => dot.dataset.filled === 'true').length;

function renderPad(props: Partial<PinPadProps> = {}) {
  const onSubmit = vi.fn();
  const result = render(
    <PinPad label="Enter your PIN" submitLabel="Unlock" onSubmit={onSubmit} {...props} />,
  );
  return { ...result, onSubmit, pad: screen.getByRole('group', { name: 'Enter your PIN' }) };
}

afterEach(() => vi.useRealTimers());

describe('PinPad', () => {
  it('takes digits from the keyboard: Backspace deletes, Enter submits', async () => {
    const user = userEvent.setup();
    const { pad, onSubmit } = renderPad();
    expect(pad).toHaveFocus();
    pad.focus();
    await user.keyboard('12345');
    expect(filled()).toBe(5);
    expect(screen.getByRole('status')).toHaveTextContent('5 digits entered');
    await user.keyboard('{Backspace}');
    expect(filled()).toBe(4);
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('1234');
    expect(filled()).toBe(0);
  });

  it('takes digits from the on-screen keys, and never more than 6', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPad();
    for (const digit of ['9', '8', '7', '6', '5', '4', '3']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }
    expect(filled()).toBe(6);
    await user.click(screen.getByRole('button', { name: 'Delete last digit' }));
    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onSubmit).toHaveBeenCalledWith('987650');
  });

  it('asks for at least 4 digits', async () => {
    const user = userEvent.setup();
    const { pad, onSubmit } = renderPad();
    pad.focus();
    await user.keyboard('12{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use 4 to 6 digits.');
  });

  it('shows an error with the tries left, describing the pad', () => {
    const { pad } = renderPad({ error: 'Wrong PIN. 2 tries left.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong PIN. 2 tries left.');
    expect(pad).toHaveAccessibleDescription(/Wrong PIN\. 2 tries left\./);
  });

  it('counts down a lockout, with the keys disabled, then lets me try again', () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00.000Z') });
    const onLockoutEnd = vi.fn();
    renderPad({ lockedUntil: '2026-11-12T10:05:00.000Z', onLockoutEnd });
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 5:00.');
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('group'), { key: '1' });
    expect(filled()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('alert')).toHaveTextContent('Try again in 4:59.');
    act(() => vi.advanceTimersByTime(299_000));
    expect(onLockoutEnd).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
  });

  it('formats the countdown', () => {
    expect(formatCountdown(299)).toBe('4:59');
    expect(formatCountdown(7)).toBe('0:07');
    expect(formatCountdown(3600)).toBe('60:00');
  });

  it('has no axe violations', async () => {
    const { container } = renderPad({ error: 'Wrong PIN. 4 tries left.' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
