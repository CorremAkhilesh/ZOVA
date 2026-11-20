import { expect, type Locator, type Page, test } from '@playwright/test';
import { newPerson, type Person } from './chat-helpers';
import { SLOW } from './helpers';

// Deleting my own status, by real clicks (desktop) and real taps (a touch phone): ⋯ → Delete status
// → the "Delete this status?" dialog shows over the viewer and its button takes the click → the
// viewer moves on to my next status (after the last one, back to the list), and a colleague's list
// drops it at once (socket), without a reload.

test.describe.configure({ timeout: 240_000 });

const DEVICES = [
  { name: 'desktop', options: { viewport: { width: 1366, height: 768 } } },
  { name: 'phone', options: { viewport: { width: 375, height: 812 }, hasTouch: true } },
] as const;

async function post(person: Person, text: string) {
  const response = await person.page.request.post('/v1/statuses', {
    data: { kind: 'text', text, style: { background: 'teal', font: 'sans' } },
  });
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
}

async function toStatus(page: Page) {
  await page.goto('/updates');
  await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible(SLOW);
}

for (const device of DEVICES) {
  test(`${device.name}: delete my status from the viewer; it goes for everyone`, async ({
    browser,
  }) => {
    // Everyone sees everyone's status: a name of its own, so other tests' posts never count here.
    const name = `Meher${Math.random().toString(36).slice(2, 6)}`;
    const asha = await newPerson(browser, name, device.options);
    const bharat = await newPerson(browser, 'Bharat');
    // Touch on the phone, the mouse on the desktop: the way people really do it.
    const press = (target: Locator) => (device.name === 'phone' ? target.tap() : target.click());

    await post(asha, 'First of two');
    await post(asha, 'Second of two');
    await toStatus(bharat.page);
    const fromAsha = bharat.page
      .getByRole('list', { name: 'Recent updates' })
      .getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(fromAsha.getByTestId('status-ring').locator('circle')).toHaveCount(2, SLOW);

    await toStatus(asha.page);
    await press(asha.page.getByRole('button', { name: /^My status 2 updates/ }));
    const viewer = asha.page.getByRole('dialog', { name: 'My status' });
    await expect(viewer.getByText('First of two')).toBeVisible(SLOW);

    const remove = async () => {
      await press(viewer.getByRole('button', { name: 'More options' }));
      await press(asha.page.getByRole('menuitem', { name: 'Delete status' }));
      const confirm = asha.page
        .getByRole('alertdialog', { name: 'Delete this status?' })
        .or(asha.page.getByRole('dialog', { name: 'Delete this status?' }));
      await expect(confirm).toBeVisible(SLOW);
      // A real click lands only on what is on top: it fails if the viewer covers the dialog.
      await press(confirm.getByRole('button', { name: 'Delete', exact: true }));
      await expect(confirm).toBeHidden(SLOW);
    };

    await remove();
    // On to the next one, and Bharat's ring is down to one part, live.
    await expect(viewer.getByText('Second of two')).toBeVisible(SLOW);
    await expect(fromAsha.getByTestId('status-ring').locator('circle')).toHaveCount(1, SLOW);

    await remove();
    // The last one gone: back to the list, with nothing of mine left.
    await expect(viewer).toBeHidden(SLOW);
    await expect(
      asha.page.getByRole('button', { name: /^My status Tap to add a status update/ }),
    ).toBeVisible(SLOW);
    await expect(bharat.page.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveCount(
      0,
      SLOW,
    );

    await asha.context.close();
    await bharat.context.close();
  });
}
