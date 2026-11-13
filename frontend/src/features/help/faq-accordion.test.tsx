import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brand } from '@zuvo/config';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';

const question = (name: RegExp) => screen.getByRole('button', { name });

describe('FAQ accordion', () => {
  it('starts closed; Enter and Space open and close an answer', async () => {
    const user = userEvent.setup();
    await renderApp('/help/faq', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { level: 1, name: 'Common questions' });
    const otp = question(/didn’t get my sign-in code/);
    expect(otp).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Check your Spam or Junk folder/)).not.toBeVisible();

    otp.focus();
    await user.keyboard('{Enter}');
    expect(otp).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: /didn’t get my sign-in code/ });
    expect(otp).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent(/Spam or Junk folder/);
    expect(panel).toHaveTextContent(/60 seconds/);
    expect(panel).toHaveTextContent(`@${brand.domains.organization}`);
    expect(panel).toHaveTextContent(/10 minutes/);

    await user.keyboard(' ');
    expect(otp).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toBeVisible();
  });

  it('moves between questions with the arrow keys, Home and End (wrapping around)', async () => {
    const user = userEvent.setup();
    await renderApp('/help/faq', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { level: 1, name: 'Common questions' });
    const first = question(/sign-in code/);
    const second = question(/sign in again every 7 days/);
    const last = question(/delete my account/);

    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(last).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(last).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
  });

  it('answers link to the right screens, shows the server’s file limit, and passes axe open', async () => {
    const user = userEvent.setup();
    const { container, router } = await renderApp('/help/faq', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { level: 1, name: 'Common questions' });
    for (const button of screen.getAllByRole('button', { expanded: false })) {
      await user.click(button);
    }
    expect(await screen.findByText(/can be up to 1 GB each/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open notification settings/ })).toHaveAttribute(
      'href',
      '/settings/notifications',
    );
    expect(screen.getByRole('link', { name: /How to add to the Home Screen/ })).toHaveAttribute(
      'href',
      '/help/install',
    );
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('link', { name: /Open Devices/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/devices');
  });
});
