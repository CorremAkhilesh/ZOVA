import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { appCsp } from '@zuvo/config';
import { newPerson, openChatWith, send } from './chat-helpers';
import { open, SLOW, signUp } from './helpers';

/**
 * The built app (vite preview sends the production CSP from @zuvo/config) must run with zero CSP
 * violations on its main screens: sign-in, chat list, a conversation with a photo, settings, help.
 */
test.describe.configure({ timeout: 240_000 });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=',
  'base64',
);

/** Collects every CSP violation (event and console message) in every page of the context. */
async function watchCsp(context: BrowserContext): Promise<string[]> {
  const violations: string[] = [];
  await context.exposeBinding('__zuvoCspViolation', (_source, text: string) => {
    violations.push(text);
  });
  await context.addInitScript(() => {
    const report = (window as unknown as { __zuvoCspViolation: (text: string) => void })
      .__zuvoCspViolation;
    document.addEventListener('securitypolicyviolation', (event) => {
      report(
        `${event.effectiveDirective} blocked ${event.blockedURI || 'inline'} (${event.sourceFile}:${event.lineNumber})`,
      );
    });
  });
  context.on('console', (message) => {
    if (/Content[- ]Security[- ]Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function visit(page: Page, path: string, heading: RegExp | string) {
  // Chromium aborts a goto that lands while the app is still changing its own URL: try once more.
  await open(page, path).catch(async (error: unknown) => {
    if (!/ERR_ABORTED/.test(String(error))) throw error;
    await open(page, path);
  });
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible(SLOW);
}

test('the app runs under its strict CSP with no violations', async ({ browser }) => {
  const context = await browser.newContext();
  const violations = await watchCsp(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // The document carries the policy, and the pre-paint theme script (a file now) still ran.
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toBe(appCsp({ production: false }));
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  expect(response?.headers()['permissions-policy']).toContain('microphone=(self)');
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  // If the app cannot start, say why: a CSP violation or a script error.
  await expect(page.getByRole('textbox', { name: 'Work email' }))
    .toBeVisible(SLOW)
    .catch((error: unknown) => {
      throw new Error(
        `The sign-in screen did not appear. CSP: ${JSON.stringify(violations)}; errors: ${JSON.stringify(errors)}; ${String(error)}`,
      );
    });

  // Sign-in screens → chat list.
  await signUp(page, 'Csp Tester');

  // A conversation with a photo: blob: preview, upload, thumbnail and the full picture.
  const other = await newPerson(browser, 'Bharat');
  await openChatWith(page, other);
  await send(page, 'hello');
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page.getByTestId('pick-media').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const sheet = page.getByRole('dialog', { name: 'Send 1 file' });
  await expect(sheet.locator('img').first()).toBeVisible(SLOW);
  await sheet.getByRole('button', { name: /^Send/ }).click();
  await expect(sheet).toBeHidden(SLOW);
  const photo = page.getByRole('button', { name: /Open photo/ }).first();
  await expect(photo).toBeVisible(SLOW);
  await photo.click();
  await expect
    .poll(
      () =>
        page
          .getByRole('dialog')
          .locator('img')
          .last()
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      SLOW,
    )
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');

  // Settings (appearance uses data: wallpaper patterns) and help.
  await visit(page, '/settings', /Settings/);
  await visit(page, '/settings/appearance', /Appearance/);
  await visit(page, '/help', /Help/);

  expect(violations).toEqual([]);
  await other.context.close();
  await context.close();
});
