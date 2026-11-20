import { expect, test } from '@playwright/test';
import { createGroup, newPerson, openFromList, thread } from './chat-helpers';
import { SLOW } from './helpers';
import { createPoll, pollCard } from './poll-helpers';

// Three people in a group: a poll, votes that show on everyone's screen at once, "View votes" with
// names, changing and taking back a vote, and closing.

test.describe.configure({ timeout: 180_000 });

const GROUP = 'Lunch club';
const QUESTION = 'Where do we eat on Friday?';

test('three people vote; everyone sees it live; View votes names them; then the poll closes', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  await createGroup(asha.page, GROUP, [bharat, chitra]);
  await createPoll(asha.page, QUESTION, ['Dosa Corner', 'Pizza Hub', 'Salad Bar']);
  for (const other of [bharat, chitra]) {
    await expect(other.page.getByRole('link', { name: new RegExp(GROUP) })).toBeVisible(SLOW);
    await openFromList(other.page, GROUP);
    await expect(pollCard(other.page, QUESTION)).toBeVisible(SLOW);
  }

  // Bharat votes: Asha and Chitra see it at once, without reloading.
  await pollCard(bharat.page, QUESTION).getByText('Dosa Corner', { exact: true }).click();
  for (const page of [asha.page, chitra.page]) {
    await expect(
      pollCard(page, QUESTION).getByRole('radio', { name: /^Dosa Corner, 1 vote, 100 percent/ }),
    ).toBeVisible(SLOW);
  }
  // Chitra votes the same; Asha votes Pizza Hub.
  await pollCard(chitra.page, QUESTION).getByText('Dosa Corner', { exact: true }).click();
  await pollCard(asha.page, QUESTION).getByText('Pizza Hub', { exact: true }).click();
  for (const page of [asha.page, bharat.page, chitra.page]) {
    await expect(
      pollCard(page, QUESTION).getByRole('radio', { name: /^Dosa Corner, 2 votes, 67 percent/ }),
    ).toBeVisible(SLOW);
    await expect(
      pollCard(page, QUESTION).getByRole('radio', { name: /^Pizza Hub, 1 vote, 33 percent/ }),
    ).toBeVisible(SLOW);
  }

  // View votes, on Bharat's screen: who voted for what.
  await thread(bharat.page, GROUP)
    .getByRole('button', { name: /^View votes/ })
    .click();
  const sheet = bharat.page.getByRole('dialog', { name: QUESTION });
  await expect(sheet).toContainText('3 people voted', SLOW);
  const dosa = sheet.getByRole('list', { name: 'Who voted for Dosa Corner' });
  await expect(dosa.getByRole('listitem')).toHaveCount(2, SLOW);
  await expect(dosa).toContainText('You');
  await expect(dosa).toContainText('Chitra');
  await expect(sheet.getByRole('list', { name: 'Who voted for Pizza Hub' })).toContainText('Asha');
  await bharat.page.keyboard.press('Escape');

  // Chitra changes her mind, then takes her vote back.
  await pollCard(chitra.page, QUESTION).getByText('Salad Bar', { exact: true }).click();
  await expect(
    pollCard(asha.page, QUESTION).getByRole('radio', { name: /^Salad Bar, 1 vote/ }),
  ).toBeVisible(SLOW);
  await thread(chitra.page, GROUP).getByRole('button', { name: 'Remove vote' }).click();
  await expect(
    pollCard(asha.page, QUESTION).getByRole('radio', { name: /^Salad Bar, 0 votes/ }),
  ).toBeVisible(SLOW);

  // Asha closes it: nobody can vote any more.
  await thread(asha.page, GROUP).getByRole('button', { name: 'Close poll' }).click();
  await asha.page
    .getByRole('dialog', { name: 'Close this poll?' })
    .getByRole('button', { name: 'Close poll' })
    .click();
  await expect(pollCard(chitra.page, QUESTION)).toContainText('Poll closed', SLOW);
  await expect(
    pollCard(chitra.page, QUESTION).getByRole('radio', { name: /^Salad Bar/ }),
  ).toBeDisabled();

  for (const person of [asha, bharat, chitra]) await person.context.close();
});
