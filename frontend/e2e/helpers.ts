import { expect, type Page } from '@playwright/test';

/** A unique organization address per test, so tests never share accounts or rate limits. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@corremadvisory.com`;
}

/** Reads the latest OTP for `email` from the test API's in-memory outbox (via the /v1 proxy). */
async function latestSubject(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`/v1/test/outbox/latest?to=${encodeURIComponent(email)}`);
  return response.ok() ? (await response.json()).subject : '';
}

export async function readOtp(page: Page, email: string, previousSubject = ''): Promise<string> {
  let code = '';
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/v1/test/outbox/latest?to=${encodeURIComponent(email)}`,
        );
        if (!response.ok()) return '';
        const { subject } = await response.json();
        if (subject === previousSubject) return '';
        code = /^(\d{6}) is your /.exec(subject)?.[1] ?? '';
        return code;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

/** Full sign-up through the UI: email → code → name → chats. */
/** Auth calls can be slow when many browsers run in parallel against the in-memory test API. */
const SLOW = { timeout: 20_000 };

export async function signUp(page: Page, name = 'E2E Tester', username?: string): Promise<string> {
  const email = uniqueEmail();
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible(SLOW);

  const code = await readOtp(page, email);
  // Filling the first box mimics one-time-code autofill and auto-submits.
  await page.getByRole('textbox', { name: 'Digit 1 of 6' }).fill(code);

  await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible(SLOW);
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  // The username is suggested from the email; wait for it (and its availability check).
  await expect(page.getByRole('textbox', { name: 'Username' })).not.toHaveValue('', SLOW);
  if (username) await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await expect(page.getByText('Available')).toBeVisible(SLOW);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/chats$/, SLOW);
  return email;
}

/** Signs an existing account in on another device (lifting the test API's resend cooldown). */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.request.post('/v1/test/reset-otp-limits', { data: { email } });
  const before = await latestSubject(page, email);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Work email' }).fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible(SLOW);
  const code = await readOtp(page, email, before);
  await page.getByRole('textbox', { name: 'Digit 1 of 6' }).fill(code);
  await expect(page).toHaveURL(/\/chats$/, SLOW);
}

export { SLOW };

/**
 * page.goto that survives Firefox aborting it when the app is still finishing its own navigation
 * (NS_BINDING_ABORTED or an "<unknown error>" right after sign-up). Waits for the page to settle, retries once or twice.
 */
export async function open(page: Page, path: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await page.waitForLoadState('load');
    try {
      await page.goto(path);
      return;
    } catch (error) {
      const aborted = /NS_BINDING_ABORTED|NS_ERROR_FAILURE|frame was detached|unknown error/.test(
        String(error),
      );
      if (!aborted || attempt >= 3) throw error;
    }
  }
}

/** Offline navigation needs the service worker to control the page first. */
export async function waitForActiveServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
    return registration.active?.state;
  });
}
