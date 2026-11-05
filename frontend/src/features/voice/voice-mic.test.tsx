import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { MicButton } from './components/MicButton';
import { MicBlockedDialog, MicExplainDialog } from './components/MicDialogs';

describe('the mic button', () => {
  const setup = () => {
    const handlers = {
      onClick: vi.fn(),
      onHoldStart: vi.fn(),
      onHoldEnd: vi.fn(),
      onSlideCancel: vi.fn(),
      onSlideLock: vi.fn(),
    };
    render(<MicButton {...handlers} />);
    return { button: screen.getByRole('button', { name: 'Record a voice note' }), ...handlers };
  };
  const touch = { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 };

  it('a click or key press starts a recording that stays on', async () => {
    const user = userEvent.setup();
    const { button, onClick, onHoldStart } = setup();
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('holding records, and letting go sends, without also clicking', () => {
    const { button, onClick, onHoldStart, onHoldEnd } = setup();
    fireEvent.pointerDown(button, touch);
    expect(onHoldStart).toHaveBeenCalled();
    fireEvent.pointerUp(button, touch);
    expect(onHoldEnd).toHaveBeenCalled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sliding left cancels, and letting go after that sends nothing', () => {
    const { button, onSlideCancel, onHoldEnd } = setup();
    fireEvent.pointerDown(button, touch);
    fireEvent.pointerMove(button, { ...touch, clientX: 10 });
    expect(onSlideCancel).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button, touch);
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it('sliding up locks, and letting go keeps recording', () => {
    const { button, onSlideLock, onHoldEnd } = setup();
    fireEvent.pointerDown(button, touch);
    fireEvent.pointerMove(button, { ...touch, clientY: 10 });
    expect(onSlideLock).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button, touch);
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it('keeps what was said if the system takes the finger away', () => {
    const { button, onSlideLock } = setup();
    fireEvent.pointerDown(button, touch);
    fireEvent.pointerCancel(button, touch);
    expect(onSlideLock).toHaveBeenCalled();
  });
});

describe('microphone dialogs', () => {
  it('explains before the browser asks', async () => {
    const user = userEvent.setup();
    const onAllow = vi.fn();
    render(<MicExplainDialog open onAllow={onAllow} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Use your microphone?' })).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAllow).toHaveBeenCalled();
  });

  it('says how to unblock it, for each browser', async () => {
    const user = userEvent.setup();
    render(<MicBlockedDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Microphone blocked' })).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'iPhone' }));
    expect(screen.getByText(/Open the Settings app/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edge' }));
    expect(screen.getByText(/Permissions for this site/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chrome' }));
    expect(screen.getByText(/Set Microphone to Allow/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Safari' }));
    expect(screen.getByText(/Settings for this website/)).toBeInTheDocument();
  });
});
