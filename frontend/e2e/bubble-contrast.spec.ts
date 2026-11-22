import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';
import {
  createGroup,
  expectSent,
  newPerson,
  openFromList,
  type Person,
  send,
} from './chat-helpers';
import { SLOW } from './helpers';
import { createPoll, pollCard } from './poll-helpers';

// Everything inside a chat bubble must be readable (WCAG AA) on both sides of the conversation, in
// light and dark, with every accent: mentions, links, "Read more", `code`, bold and italic, replies,
// "edited", times, file cards, polls and voice notes. Live bug (Nov 2026): a mention in my own
// (indigo) bubble was indigo on indigo. In the light theme my bubble is a soft tint of the accent
// with dark text (as easy on the eye as an incoming one); in the dark theme a muted accent.

test.describe.configure({ timeout: 300_000 });

/** Run through the DevTools protocol: the app's CSP (script-src 'self') blocks script tags. */
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const GROUP = 'Contrast';
const ACCENTS = ['indigo', 'teal', 'violet', 'rose', 'amber', 'sky'] as const;
const THEMES = ['light', 'dark'] as const;

const composer = (page: Page) => page.getByRole('textbox', { name: 'Write a message' });
const thread = (page: Page) => page.getByRole('list', { name: GROUP, exact: true });

async function mention(page: Page, before: string, person: Person) {
  const box = composer(page);
  await box.click();
  await box.pressSequentially(`${before} @${person.name.slice(0, 3)}`);
  const picker = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(picker.getByRole('option', { name: person.name })).toBeVisible(SLOW);
  await box.press('Enter');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function replyTo(page: Page, text: string, answer: string) {
  await expect(thread(page).getByText(text, { exact: true })).toBeVisible(SLOW);
  await thread(page).getByText(text, { exact: true }).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Message actions' })
    .getByRole('menuitem', { name: 'Reply', exact: true })
    .click();
  await send(page, answer);
}

/** Both sides of a group chat with every kind of styled text in it. */
async function conversation(page: Page, me: string, them: Person) {
  await mention(page, `${me}: share today standup`, them);
  await send(
    page,
    `${me}: see https://example.com/docs and \`npm run build\` with *bold* and _italic_`,
  );
  // Long enough to be cut: "Read more" is a link-coloured button in the bubble.
  await send(page, `${me}'s long note: ${'the plan for the week, step by step. '.repeat(30)}`);
  await send(page, `${me} wrote this, then edited it`);
  await expectSent(page, GROUP, `${me} wrote this, then edited it`);
  await thread(page).getByText(`${me} wrote this, then edited it`).click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Message actions' })
    .getByRole('menuitem', { name: 'Edit' })
    .click();
  await composer(page).fill(`${me} edited this message`);
  await composer(page).press('Enter');
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page.getByTestId('pick-document').setInputFiles({
    name: 'standup-notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nnotes\n'),
  });
  await page
    .getByRole('dialog', { name: 'Send 1 file' })
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  // A poll with a vote on it (a filled bar, a ✓, a face) and an option at 0 (the bare track).
  const question = `${me}'s lunch poll`;
  await createPoll(page, question, ['Dosa', 'Pizza']);
  await pollCard(page, question).getByText('Dosa', { exact: true }).click();
  await expect(pollCard(page, question).getByRole('radio', { name: /^Dosa, 1 vote/ })).toBeChecked(
    SLOW,
  );
  // A voice note: the play button and waveform take the bubble's accent.
  await page.getByRole('button', { name: 'Record a voice note' }).click();
  const allow = page.getByRole('button', { name: 'Continue' });
  await expect(allow.or(page.getByRole('timer'))).toBeVisible(SLOW);
  if (await allow.isVisible()) await allow.click();
  await expect(page.getByRole('timer')).toHaveText('0:02', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Send voice message' }).click();
}

/** Relative luminance (WCAG) of a computed `rgb(r, g, b)` colour. */
function luminance(rgb: string): number {
  const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map((part) => {
    const c = Number(part) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** My bubble per theme and accent: its background, its text, and a mention in it. */
async function outgoingLook(page: Page) {
  // The list is virtual: scroll to the start, where my first message (with a mention) is.
  await thread(page).evaluate((list) => {
    let box: Element | null = list;
    while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    box?.scrollTo({ top: 0 });
  });
  await expect(thread(page).locator('[data-bubble="out"] .mention').first()).toBeVisible(SLOW);
  const looks: {
    theme: string;
    accent: string;
    bubble: number;
    text: number;
    underline: string;
  }[] = [];
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      const look = await thread(page).evaluate(
        async (list, { theme, accent }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.accent = accent;
          await new Promise((resolve) => setTimeout(resolve, 150));
          const bubble = list.querySelector('[data-bubble="out"]') as HTMLElement;
          const mention = list.querySelector('[data-bubble="out"] .mention') as HTMLElement;
          return {
            bubble: getComputedStyle(bubble).backgroundColor,
            text: getComputedStyle(bubble).color,
            underline: getComputedStyle(mention).textDecorationLine,
          };
        },
        { theme, accent },
      );
      looks.push({
        theme,
        accent,
        bubble: luminance(look.bubble),
        text: luminance(look.text),
        underline: look.underline,
      });
    }
  }
  return looks;
}

interface Problem {
  accent: string;
  theme: string;
  target: string;
  summary: string;
}

/** axe's color-contrast rule on the message list only, for each theme and accent. */
async function contrastProblems(page: Page): Promise<Problem[]> {
  await page.evaluate(AXE);
  const problems: Problem[] = [];
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      const found = await thread(page).evaluate(
        async (list, { theme, accent }) => {
          const root = document.documentElement;
          root.dataset.theme = theme;
          root.dataset.accent = accent;
          await new Promise((resolve) => setTimeout(resolve, 150));
          // biome-ignore lint/suspicious/noExplicitAny: axe is injected as a global script
          const axe = (window as any).axe;
          const result = await axe.run(list, {
            runOnly: { type: 'rule', values: ['color-contrast'] },
            resultTypes: ['violations'],
          });
          return result.violations.flatMap(
            (violation: { nodes: { target: string[]; failureSummary: string }[] }) =>
              violation.nodes.map((node) => ({
                target: node.target.join(' '),
                summary: node.failureSummary
                  .split(String.fromCharCode(10))
                  .slice(1)
                  .join(' ')
                  .slice(0, 200),
              })),
          );
        },
        { theme, accent },
      );
      for (const item of found as { target: string; summary: string }[]) {
        problems.push({ accent, theme, ...item });
      }
    }
  }
  return problems;
}

test('every bubble is readable in light and dark with every accent (axe color-contrast)', async ({
  browser,
  browserName,
  isMobile,
}) => {
  test.skip(browserName !== 'chromium', 'Colours are the same in every browser; one is enough');
  // The same colours on a phone; the desktop layout gives the right-click menu this test uses.
  test.skip(isMobile, 'Colours do not depend on the viewport');
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await createGroup(asha.page, GROUP, [bharat]);
  await conversation(asha.page, 'Asha', bharat);
  await expect(bharat.page.getByRole('link', { name: new RegExp(GROUP) })).toBeVisible(SLOW);
  await openFromList(bharat.page, GROUP);
  await conversation(bharat.page, 'Bharat', asha);
  await replyTo(bharat.page, 'Asha edited this message', 'replying to your edit');
  await expect(thread(asha.page).getByText('replying to your edit')).toBeVisible(SLOW);
  await replyTo(asha.page, 'replying to your edit', 'and a reply back');
  await expect(thread(bharat.page).getByText('and a reply back')).toBeVisible(SLOW);
  await expect(thread(asha.page).getByText('standup-notes.pdf')).toHaveCount(2, SLOW);
  await expect(thread(asha.page).getByRole('button', { name: 'Play voice message' })).toHaveCount(
    2,
    SLOW,
  );
  await expect(thread(asha.page).getByRole('button', { name: 'Read more' })).toHaveCount(2, SLOW);

  // Light: a soft tint with dark text and a plain (accent-coloured) mention. Dark: a muted accent
  // with white text, where the white mention is underlined to stand out.
  for (const look of await outgoingLook(asha.page)) {
    const where = `${look.theme}/${look.accent}`;
    if (look.theme === 'light') {
      expect(look.bubble, `${where}: my bubble is a soft tint`).toBeGreaterThan(0.7);
      expect(look.text, `${where}: dark text`).toBeLessThan(0.05);
      expect(look.underline, `${where}: mention`).toBe('none');
    } else {
      expect(look.bubble, `${where}: a muted accent`).toBeLessThan(0.1);
      expect(look.text, `${where}: white text`).toBeGreaterThan(0.9);
      expect(look.underline, `${where}: mention`).toBe('underline');
    }
  }

  // For design reviews: CONTRAST_SHOTS=<folder> keeps light and dark pictures of both sides.
  const shots = process.env.CONTRAST_SHOTS;
  if (shots) {
    for (const [side, page] of [
      ['outgoing-asha', asha.page],
      ['incoming-bharat', bharat.page],
    ] as const) {
      for (const theme of THEMES) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
          document.documentElement.dataset.accent = 'indigo';
        }, theme);
        await page.waitForTimeout(300);
        await thread(page).screenshot({
          path: `${shots}/contrast-${process.env.SHOTS ?? 'now'}-${theme}-${side}.png`,
        });
      }
    }
  }

  const problems = [
    ...(await contrastProblems(asha.page)).map((p) => ({ ...p, side: 'Asha' })),
    ...(await contrastProblems(bharat.page)).map((p) => ({ ...p, side: 'Bharat' })),
  ];
  // One line per problem, so a failure says exactly what to fix.
  expect(problems.map((p) => `${p.theme}/${p.accent} ${p.target}: ${p.summary}`)).toEqual([]);
  await asha.context.close();
  await bharat.context.close();
});
