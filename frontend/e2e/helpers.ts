import { expect, type Page, test } from '@playwright/test';

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
        code = /^(\d{6}) /.exec(subject)?.[1] ?? '';
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

/**
 * A new account the quick way: the same API calls the sign-up screens make (code by email, verify,
 * name, @username), then the app opens on /chats like for a returning user. For the many tests
 * that only need someone signed in; auth.spec.ts and the people tests go through the screens.
 */
export async function signUpByApi(
  page: Page,
  name: string,
  username = `${name.replace(/[^a-z]/gi, '').toLowerCase()}${Math.random().toString(36).slice(2, 12)}`,
): Promise<string> {
  const email = uniqueEmail();
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  const post = async (url: string, method: 'POST' | 'PATCH' | 'PUT', data: object) => {
    const response = await page.request.fetch(url, { method, data, headers: { origin } });
    const failure = response.ok() ? '' : `${response.status()} ${await response.text()}`;
    expect(response.ok(), `${method} ${url}: ${failure}`).toBe(true);
  };
  await post('/v1/auth/otp/request', 'POST', { email });
  const code = await readOtp(page, email);
  // The session cookie lands in this page's browser context.
  await post('/v1/auth/otp/verify', 'POST', { email, code });
  await post('/v1/me/profile', 'PATCH', { displayName: name });
  await post('/v1/me/username', 'PUT', { username });
  await page.goto('/chats');
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible(SLOW);
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
