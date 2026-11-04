import { expect, type Page } from '@playwright/test';

/** A unique organization address per test, so tests never share accounts or rate limits. */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@corremadvisory.com`;
}

/** Reads the latest OTP for `email` from the test API's in-memory outbox (via the /v1 proxy). */
export async function readOtp(page: Page, email: string): Promise<string> {
  let code = '';
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/v1/test/outbox/latest?to=${encodeURIComponent(email)}`,
        );
        if (!response.ok()) return '';
        code = /^(\d{6}) is your /.exec((await response.json()).subject)?.[1] ?? '';
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

export async function signUp(page: Page, name = 'E2E Tester'): Promise<string> {
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
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/chats$/, SLOW);
  return email;
}
