/**
 * Captures the manifest screenshots (shown in the browser's install dialog) from a real conversation
 * between demo accounts. Runs against the E2E stack only, which has the test outbox and throwaway data:
 *   pnpm --filter @zuvo/backend e2e:server
 *   ZUVO_API_TARGET=http://127.0.0.1:4197 pnpm --filter @zuvo/frontend exec vite preview
 *   pnpm --filter @zuvo/frontend pwa:screenshots [folder for extra light + dark screenshots]
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from '@playwright/test';
import { signIn, signUp } from '../e2e/helpers.ts';

const BASE = 'http://127.0.0.1:5194';
const outDir = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const extraDir = process.argv[2];
mkdirSync(outDir, { recursive: true });
if (extraDir) mkdirSync(extraDir, { recursive: true });

interface Person {
  page: Page;
  name: string;
  username: string;
  email: string;
}

const suffix = Date.now().toString(36).slice(-5);

async function person(browser: Browser, name: string): Promise<Person> {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const username = `${name.split(' ')[0]?.toLowerCase()}${suffix}`;
  return { page, name, username, email: await signUp(page, name, username) };
}

async function openChat(page: Page, other: Person) {
  await page.getByRole('button', { name: 'New chat' }).click();
  const picker = page.getByRole('dialog', { name: 'New chat' });
  await picker.getByRole('combobox').fill(other.username);
  await picker.getByRole('option', { name: new RegExp(other.name) }).click();
  await page.getByRole('textbox', { name: 'Write a message' }).waitFor();
}

async function say(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Write a message' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('img', { name: 'Sending' }).first().waitFor({ state: 'detached' });
}

const browser = await chromium.launch();
const kiran = await person(browser, 'Kiran Rao');
const asha = await person(browser, 'Asha Verma');
const rahul = await person(browser, 'Rahul Menon');
const meera = await person(browser, 'Meera Nair');

await openChat(rahul.page, kiran);
await say(rahul.page, 'The client call moved to 4 pm.');
await openChat(meera.page, kiran);
await say(meera.page, 'Invoices are ready for review.');
await say(meera.page, 'No rush, end of day is fine.');

await openChat(asha.page, kiran);
await say(asha.page, 'Good morning! Did you get a chance to look at the Q3 deck?');
await kiran.page.getByRole('link', { name: /Asha Verma/ }).click();
await say(kiran.page, 'Yes, just finished. The numbers look great.');
await say(kiran.page, 'One question on slide 12: are those figures before tax?');
await say(asha.page, 'Before tax, yes. I’ll add a footnote.');
await say(asha.page, 'नमस्ते! I’ll send the final version after lunch 🙂');
await say(kiran.page, 'Perfect, thank you!');
await kiran.page.getByText('Perfect, thank you!').last().waitFor();

async function shot(page: Page, path: string) {
  // Let fonts and the last sync settle.
  await page.waitForTimeout(600);
  await page.screenshot({ path });
}

for (const colorScheme of ['light', 'dark'] as const) {
  await kiran.page.emulateMedia({ colorScheme });
  await kiran.page.setViewportSize({ width: 1280, height: 800 });
  await shot(kiran.page, extraDir ? `${extraDir}/desktop-${colorScheme}.png` : `${outDir}wide.png`);
  if (colorScheme === 'light') await shot(kiran.page, `${outDir}wide.png`);
  if (extraDir) {
    await kiran.page.setViewportSize({ width: 390, height: 844 });
    await shot(kiran.page, `${extraDir}/mobile-chat-${colorScheme}.png`);
    await kiran.page.getByRole('link', { name: 'Back to chats' }).click();
    await kiran.page.getByRole('heading', { name: 'Chats' }).waitFor();
    await shot(kiran.page, `${extraDir}/mobile-list-${colorScheme}.png`);
    await kiran.page.getByRole('link', { name: /Asha Verma/ }).click();
  }
}

if (extraDir) {
  await kiran.page.emulateMedia({ colorScheme: 'light' });
  await kiran.page.setViewportSize({ width: 1280, height: 800 });
  // Someone typing, then someone who has left.
  await asha.page.getByRole('textbox', { name: 'Write a message' }).pressSequentially('Sure');
  await kiran.page.getByText('typing…').first().waitFor();
  await kiran.page.screenshot({ path: `${extraDir}/typing-light.png` });
  await asha.page.getByRole('textbox', { name: 'Write a message' }).fill('');
  await kiran.page.getByRole('link', { name: /Rahul Menon/ }).click();
  await rahul.page.context().close();
  await kiran.page.getByText(/^last seen today/).waitFor();
  await shot(kiran.page, `${extraDir}/last-seen-light.png`);
}

if (extraDir) {
  // Media: a real album and a document, from someone else.
  const picture = (from: string, to: string) =>
    asha.page.evaluate(
      ([start, end]) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 800;
        const context = canvas.getContext('2d');
        if (!context) return '';
        const fill = context.createLinearGradient(0, 0, 1200, 800);
        fill.addColorStop(0, start ?? '');
        fill.addColorStop(1, end ?? '');
        context.fillStyle = fill;
        context.fillRect(0, 0, 1200, 800);
        return canvas.toDataURL('image/png').split(',')[1] ?? '';
      },
      [from, to],
    );
  const image = async (name: string, from: string, to: string) => ({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(await picture(from, to), 'base64'),
  });
  await asha.page.getByRole('link', { name: /Kiran Rao/ }).click();
  await asha.page.getByRole('button', { name: 'Attach a file' }).click();
  await asha.page
    .getByTestId('pick-media')
    .setInputFiles([
      await image('site-1.png', '#4F46E5', '#14B8A6'),
      await image('site-2.png', '#F59E0B', '#EF4444'),
      await image('site-3.png', '#0EA5E9', '#22C55E'),
    ]);
  const sheet = asha.page.getByRole('dialog', { name: 'Send 3 files' });
  await sheet.getByRole('textbox', { name: 'Caption for site-1.png' }).fill('Site visit photos');
  await asha.page.setViewportSize({ width: 1280, height: 800 });
  await asha.page.waitForTimeout(400);
  await asha.page.screenshot({ path: `${extraDir}/preview-sheet-light.png` });
  await sheet.getByRole('button', { name: 'Send 3' }).click();
  await sheet.waitFor({ state: 'hidden' });
  await asha.page.getByRole('button', { name: 'Attach a file' }).click();
  await asha.page.getByTestId('pick-document').setInputFiles({
    name: 'Q3-report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(180_000, 32)]),
  });
  const docSheet = asha.page.getByRole('dialog', { name: 'Send 1 file' });
  await docSheet.getByRole('button', { name: 'Send', exact: true }).click();
  await docSheet.waitFor({ state: 'hidden' });

  await kiran.page.getByRole('link', { name: /Asha Verma/ }).click();
  await kiran.page.getByRole('button', { name: 'Download Q3-report.pdf' }).waitFor();
  await shot(kiran.page, `${extraDir}/media-chat-light.png`);
  await kiran.page.emulateMedia({ colorScheme: 'dark' });
  await shot(kiran.page, `${extraDir}/media-chat-dark.png`);
  await kiran.page.emulateMedia({ colorScheme: 'light' });
  await kiran.page.getByRole('button', { name: 'Chat info' }).first().click();
  await kiran.page.getByRole('tab', { name: 'Media' }).waitFor();
  await shot(kiran.page, `${extraDir}/chat-info-media-light.png`);
  await kiran.page
    .getByRole('complementary')
    .getByRole('button', { name: /Open photo/ })
    .first()
    .click();
  await kiran.page.getByRole('button', { name: 'Zoom in' }).waitFor();
  await shot(kiran.page, `${extraDir}/viewer.png`);
}

// The narrow manifest screenshot is a real phone-sized device: its own context at 2× scale.
const phone = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  colorScheme: 'light',
});
const phonePage = await phone.newPage();
await signIn(phonePage, kiran.email);
await phonePage.getByRole('link', { name: /Asha Verma/ }).waitFor();
await shot(phonePage, `${outDir}narrow.png`);

await browser.close();
process.stdout.write(`Saved screenshots to ${outDir}${extraDir ? ` and ${extraDir}` : ''}\n`);
