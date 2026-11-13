import { describe, expect, it, vi } from 'vitest';
import { createUpdatePrompt, UPDATE_TOAST_ID } from './update-prompt';

type ToastOptions = {
  id: string;
  duration: number;
  action: { label: string; onClick: () => void };
};

function setup() {
  const update = vi.fn(async (_reload?: boolean) => {});
  const notify = vi.fn();
  const showPrompt = createUpdatePrompt(update, {
    notify: notify as never,
    translate: (key) =>
      ({ 'pwa.updateAvailable': 'New version available', 'pwa.reload': 'Reload' })[key] ?? key,
  });
  const options = () => notify.mock.calls[0]?.[1] as ToastOptions;
  return { update, notify, showPrompt, options };
}

describe('update prompt', () => {
  it('shows a persistent toast with a Reload action', () => {
    const { notify, showPrompt, options } = setup();
    showPrompt();
    expect(notify).toHaveBeenCalledWith('New version available', expect.any(Object));
    expect(options()).toMatchObject({ id: UPDATE_TOAST_ID, duration: Number.POSITIVE_INFINITY });
    expect(options().action.label).toBe('Reload');
  });

  it('never updates on its own — only when Reload is clicked', () => {
    const { update, showPrompt } = setup();
    showPrompt();
    expect(update).not.toHaveBeenCalled();
  });

  it('activates the new worker and reloads exactly once', () => {
    const { update, showPrompt, options } = setup();
    showPrompt();
    options().action.onClick();
    options().action.onClick();
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(true);
  });

  it('reuses one toast when an update is detected again', () => {
    const { notify, showPrompt } = setup();
    showPrompt();
    showPrompt();
    expect(
      notify.mock.calls.every(([, opts]) => (opts as ToastOptions).id === UPDATE_TOAST_ID),
    ).toBe(true);
  });
});
