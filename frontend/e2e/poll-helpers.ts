import { expect, type Page } from '@playwright/test';
import { SLOW } from './helpers';

/** 📎 → Poll → question, options (and "Allow multiple answers") → Send poll. */
export async function createPoll(
  page: Page,
  question: string,
  options: string[],
  multiple = false,
): Promise<void> {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page.getByRole('button', { name: 'Poll', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create poll' });
  await expect(dialog).toBeVisible(SLOW);
  await dialog.getByRole('textbox', { name: 'Question' }).fill(question);
  for (const [index, option] of options.entries()) {
    const field = dialog.getByRole('textbox', { name: `Option ${index + 1}`, exact: true });
    if (!(await field.isVisible()))
      await dialog.getByRole('button', { name: 'Add option' }).click();
    await field.fill(option);
  }
  if (multiple) await dialog.getByRole('switch', { name: /Allow multiple answers/ }).click();
  await dialog.getByRole('button', { name: 'Send poll' }).click();
  await expect(dialog).toBeHidden(SLOW);
}

/** A poll card in the thread, found by its question. */
export const pollCard = (page: Page, question: string) =>
  page.getByRole('group', { name: question });
