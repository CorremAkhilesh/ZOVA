import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import { axe } from '@/test/axe';
import { HttpResponse, http, profileFixture, server, sessionFixture, signedOut } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { useAuthFlow } from './flow-store';

const otpSent = () =>
  http.post('*/v1/auth/otp/request', () =>
    HttpResponse.json({ status: 'sent', expiresInSeconds: 600, resendAfterSeconds: 60 }),
  );
const apiError = (code: string, status: number, details?: Record<string, unknown>) =>
  HttpResponse.json(
    { code, message: code, requestId: 'r', ...(details ? { details } : {}) },
    { status },
  );

afterEach(() => {
  useAuthFlow.setState({ pendingEmail: '', resendAvailableAt: 0, signedOutReason: null });
});

async function startAtEmail() {
  server.use(signedOut());
  const result = await renderApp('/');
  return {
    ...result,
    user: userEvent.setup(),
    email: screen.getByRole('textbox', { name: 'Work email' }),
  };
}

async function startAtCode(resendAvailableAt = Date.now() + 60_000) {
  server.use(signedOut());
  useAuthFlow.setState({ pendingEmail: 'asha@corremadvisory.com', resendAvailableAt });
  const result = await renderApp('/verify');
  return { ...result, user: userEvent.setup() };
}

describe('email step', () => {
  it('shows the organization hint and has no axe violations', async () => {
    const { container } = await startAtEmail();
    expect(screen.getByText('Use your @corremadvisory.com email')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('rejects other domains in the browser without calling the API', async () => {
    let called = false;
    const { user, email } = await startAtEmail();
    server.use(
      http.post('*/v1/auth/otp/request', () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    await user.type(email, 'someone@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only @corremadvisory.com email addresses can use Zuvo',
    );
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(called).toBe(false);
  });

  it('sends the code, shows a loading state and moves to the code step', async () => {
    const { user, email, router } = await startAtEmail();
    let release: () => void = () => {};
    server.use(
      http.post('*/v1/auth/otp/request', async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return HttpResponse.json({ status: 'sent', expiresInSeconds: 600, resendAfterSeconds: 60 });
      }),
    );
    await user.type(email, ' Asha@CorremAdvisory.com ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('button', { name: 'Sending code…' })).toBeDisabled();
    act(() => release());
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify'));
    expect(useAuthFlow.getState().pendingEmail).toBe('asha@corremadvisory.com');
  });

  it('shows the wait time when rate limited', async () => {
    const { user, email } = await startAtEmail();
    server.use(
      http.post('*/v1/auth/otp/request', () =>
        apiError('RATE_LIMITED', 429, { retryAfterSeconds: 42 }),
      ),
    );
    await user.type(email, 'asha@corremadvisory.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 42 seconds.',
    );
  });

  it('explains a deactivated account', async () => {
    const { user, email } = await startAtEmail();
    server.use(http.post('*/v1/auth/otp/request', () => apiError('ACCOUNT_DEACTIVATED', 403)));
    await user.type(email, 'asha@corremadvisory.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('deactivated');
  });

  it('greets users whose session ended', async () => {
    useAuthFlow.setState({ signedOutReason: 'expired' });
    await startAtEmail();
    expect(screen.getByText('Your session ended. Sign in again to continue.')).toBeInTheDocument();
  });
});

describe('code step', () => {
  const boxes = () => screen.getAllByRole('textbox', { name: /Digit \d of 6/ });

  it('has 6 numeric boxes with one-time-code autofill and no axe violations', async () => {
    const { container } = await startAtCode();
    expect(screen.getByText('asha@corremadvisory.com')).toBeInTheDocument();
    expect(boxes()).toHaveLength(6);
    expect(boxes()[0]).toHaveAttribute('autocomplete', 'one-time-code');
    for (const box of boxes()) expect(box).toHaveAttribute('inputmode', 'numeric');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('auto-submits a pasted code and continues to the name step for new users', async () => {
    const { router } = await startAtCode();
    let received: unknown;
    server.use(
      http.post('*/v1/auth/otp/verify', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(sessionFixture({ needsProfile: true }));
      }),
    );
    fireEvent.paste(boxes()[0] as HTMLElement, { clipboardData: { getData: () => '12 34 56' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome/name'));
    expect(received).toEqual({ email: 'asha@corremadvisory.com', code: '123456' });
  });

  it('moves focus while typing and back on backspace', async () => {
    const { user } = await startAtCode();
    server.use(
      http.post('*/v1/auth/otp/verify', () =>
        apiError('OTP_INVALID', 400, { attemptsRemaining: 4 }),
      ),
    );
    await user.click(boxes()[0] as HTMLElement);
    await user.keyboard('12');
    expect(boxes()[2]).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(boxes()[1]).toHaveFocus();
  });

  it('shakes and shows attempts remaining for a wrong code', async () => {
    const { user } = await startAtCode();
    server.use(
      http.post('*/v1/auth/otp/verify', () =>
        apiError('OTP_INVALID', 400, { attemptsRemaining: 3 }),
      ),
    );
    await user.click(boxes()[0] as HTMLElement);
    await user.keyboard('999999');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not right. 3 attempts left.',
    );
    expect(screen.getByRole('group', { name: 'Verification code' })).toHaveClass('animate-shake');
    expect(boxes()[0]).toHaveValue('');
  });

  it('asks for a new code after too many attempts', async () => {
    const { user } = await startAtCode();
    server.use(
      http.post('*/v1/auth/otp/verify', () =>
        apiError('OTP_ATTEMPTS_EXCEEDED', 429, { attemptsRemaining: 0 }),
      ),
    );
    await user.click(boxes()[0] as HTMLElement);
    await user.keyboard('999999');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many wrong codes. Request a new code.',
    );
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  it('counts down before allowing a resend', async () => {
    await startAtCode(Date.now() + 45_000);
    expect(screen.getByRole('button', { name: /Resend in 4[45]s/ })).toBeDisabled();
  });

  it('explains that only the most recent code works', async () => {
    await startAtCode();
    expect(screen.getByText('Only the most recent code works.')).toBeInTheDocument();
    expect(boxes()[0]).toHaveAttribute('aria-describedby', 'otp-hint');
  });

  it('resends a code: clears the boxes and says older codes no longer work', async () => {
    const { user } = await startAtCode(Date.now() - 1000);
    server.use(otpSent());
    await user.click(boxes()[0] as HTMLElement);
    await user.keyboard('123');
    expect(boxes()[2]).toHaveValue('3');

    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(
      await screen.findByText('New code sent — older codes no longer work.'),
    ).toBeInTheDocument();
    for (const box of boxes()) expect(box).toHaveValue('');
    expect(screen.queryByText('Only the most recent code works.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Resend in/ })).toBeDisabled());
  });

  it('shows the hint in Hindi', async () => {
    await startAtCode();
    await act(() => i18n.changeLanguage('hi'));
    expect(screen.getByText('सिर्फ़ सबसे नया कोड काम करेगा।')).toBeInTheDocument();
  });

  it('goes back to change the email', async () => {
    const { user, router } = await startAtCode();
    await user.click(screen.getByRole('link', { name: 'Change email' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.getByRole('textbox', { name: 'Work email' })).toHaveValue(
      'asha@corremadvisory.com',
    );
  });
});

describe('name step', () => {
  async function startAtName() {
    server.use(
      http.get('*/v1/auth/me', () => {
        const base = sessionFixture();
        return HttpResponse.json({
          ...base,
          user: { ...base.user, displayName: null, username: null },
          needsProfile: true,
        });
      }),
    );
    const result = await renderApp('/welcome/name');
    return { ...result, user: userEvent.setup() };
  }

  it('requires a name and has no axe violations', async () => {
    const { user, container } = await startAtName();
    expect(screen.getByRole('heading', { name: 'What should we call you?' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
  });

  it('suggests a username from the email and checks it live', async () => {
    const { user } = await startAtName();
    const field = screen.getByRole('textbox', { name: 'Username' });
    await waitFor(() => expect(field).toHaveValue('kiran'));
    await user.clear(field);
    await user.type(field, 'ab');
    expect(screen.getByText('At least 3 characters.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'taken');
    expect(await screen.findByText('This username is taken.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'Asha.V');
    expect(await screen.findByText('Available')).toBeInTheDocument();
  });

  it('saves the name and username, then opens the chats', async () => {
    const { user, router } = await startAtName();
    const sent: Record<string, unknown> = {};
    server.use(
      http.patch('*/v1/me/profile', async ({ request }) => {
        Object.assign(sent, await request.json());
        return HttpResponse.json({ profile: profileFixture({ username: null }) });
      }),
      http.put('*/v1/me/username', async ({ request }) => {
        Object.assign(sent, await request.json());
        return HttpResponse.json({ profile: profileFixture({ displayName: 'Asha Verma' }) });
      }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Asha Verma');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('kiran'),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(sent).toEqual({ displayName: 'Asha Verma', username: 'kiran' });
  });

  it('shows server errors', async () => {
    const { user } = await startAtName();
    server.use(http.patch('*/v1/me/profile', () => HttpResponse.error()));
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Asha');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('kiran'),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach the server');
  });
});
