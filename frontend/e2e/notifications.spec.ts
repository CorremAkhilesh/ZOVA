import { type Browser, expect, type Page, test } from '@playwright/test';
import { signInAdmin } from './admin-helpers';
import { newPerson, type Person, thread } from './chat-helpers';
import { allowNotificationNudge, SLOW, signUpByApi } from './helpers';

// Notifications are mandatory for the team: after sign-in a full-screen step asks to turn them on
// ("Later" leaves a banner that stays until they are on); Settings has the sounds; Admin →
// Notifications shows who would miss messages and reminds them. NOTIFY_SHOTS=<folder> keeps
// screenshots (light and dark).

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

const PHONE = { width: 375, height: 812 };

async function shot(page: Page, name: string) {
  const folder = process.env.NOTIFY_SHOTS;
  if (!folder) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${folder}/notify-${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** A new account that sees the step, as a real person would (no E2E quieting). */
async function freshPerson(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  allowNotificationNudge(page);
  await signUpByApi(page, 'Nisha');
  return { context, page };
}

/** What the step offers depends on the browser: ask, blocked (some headless ones) or iPhone. */
const STEP = /^(Turn on notifications|Notifications are blocked|Add .* to your Home Screen first)$/;

test('the step after sign-in, "Later", then a banner that stays until notifications are on', async ({
  browser,
}) => {
  const { context, page } = await freshPerson(browser);
  await page.goto('/chats');
  const step = page.getByRole('dialog', { name: STEP });
  await expect(step).toBeVisible(SLOW);
  await shot(page, 'step-desktop');
  await step.getByRole('button', { name: 'Later' }).click();
  const banner = page.getByRole('region', { name: 'Notifications' });
  await expect(banner).toBeVisible(SLOW);
  await expect(banner.getByRole('button', { name: /^(Turn on|How to)$/ })).toBeVisible();
  await shot(page, 'banner-desktop');
  // Still there after a reload, and the full-screen step does not come back.
  await page.reload();
  await expect(banner).toBeVisible(SLOW);
  await expect(page.getByRole('dialog', { name: STEP })).toHaveCount(0);
  await context.close();
});

test('on a phone: the same step, full screen', async ({ browser }) => {
  const { context, page } = await freshPerson(browser, PHONE);
  await page.goto('/chats');
  await expect(page.getByRole('dialog', { name: STEP })).toBeVisible(SLOW);
  await shot(page, 'step-phone');
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible(SLOW);
  await shot(page, 'banner-phone');
  await page.goto('/settings/notifications');
  await expect(page.getByRole('heading', { name: 'Sounds' })).toBeVisible(SLOW);
  await page.getByRole('radio', { name: 'Marimba' }).check();
  await expect(page.getByRole('radio', { name: 'Marimba' })).toBeChecked();
  await shot(page, 'sounds-phone');
  await context.close();
});

/** This device gets pushes through the E2E server's stub push service. */
async function stubPush(person: Person) {
  const response = await person.page.request.put('/v1/me/push/subscription', {
    data: {
      endpoint: `https://push.example.test/send/${crypto.randomUUID()}`,
      expirationTime: null,
      keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
    },
  });
  expect(response.ok()).toBe(true);
}

test('admin: who has notifications off, and a reminder they receive', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const ravi = await newPerson(browser, 'Ravi');
  await stubPush(asha);

  const context = await browser.newContext();
  const admin = await context.newPage();
  await signInAdmin(admin);
  await admin.goto('/settings/admin/notifications');
  const list = admin.getByRole('list', { name: 'People and their devices' });
  await expect(list.getByText(ravi.email)).toBeVisible(SLOW);
  await expect(list.getByText(asha.email)).toBeVisible();
  await shot(admin, 'admin-desktop');

  await admin.getByRole('switch', { name: /Notifications OFF only/ }).check();
  await expect(list.getByText(asha.email)).toHaveCount(0);
  await expect(list.getByText(ravi.email)).toBeVisible();
  await admin.getByRole('checkbox', { name: `Select ${ravi.name}` }).check();
  await admin.getByRole('button', { name: 'Remind (1)' }).click();
  await expect(admin.getByText('Reminder sent to 1 person.')).toBeVisible(SLOW);

  // Ravi finds the admin's message with the steps, in a chat the admin started.
  const me = (await (await admin.request.get('/v1/auth/me')).json()).user as {
    displayName: string;
  };
  await ravi.page.goto('/chats');
  await ravi.page.getByRole('link', { name: new RegExp(me.displayName) }).click();
  await expect(thread(ravi.page, me.displayName).getByText(/turn on notifications/)).toBeVisible(
    SLOW,
  );

  await context.close();
  await asha.context.close();
  await ravi.context.close();
});
