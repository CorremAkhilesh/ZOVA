import type { PublicProfile, Status, StatusFeedResponse } from '@zuvo/protocol';
import { ME_ID, personFixture } from '@/test/chat-fixtures';

let next = 0;
const hex = (n: number) => n.toString(16).padStart(24, '0');

/** A status of `userId`, posted `minutesAgo` minutes ago (24 hours to run from then). */
export function statusFixture(
  userId: string,
  overrides: Partial<Status> = {},
  minutesAgo = 5,
): Status {
  next += 1;
  const created = Date.now() - minutesAgo * 60_000;
  return {
    id: hex(next),
    userId,
    kind: 'text',
    text: `status ${next}`,
    style: { background: 'teal', font: 'sans' },
    media: null,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + 24 * 3_600_000).toISOString(),
    viewed: false,
    viewCount: userId === ME_ID ? 0 : null,
    ...overrides,
  };
}

export const riya: PublicProfile = personFixture({
  id: 'u-riya',
  displayName: 'Riya Shah',
  username: 'riya',
});
export const vikram: PublicProfile = personFixture({
  id: 'u-vikram',
  displayName: 'Vikram Rao',
  username: 'vikram',
});
export const meera: PublicProfile = personFixture({
  id: 'u-meera',
  displayName: 'Meera Iyer',
  username: 'meera',
});

/** A feed: Riya with two new statuses, Vikram with one seen, Meera muted. */
export function feedFixture(overrides: Partial<StatusFeedResponse> = {}): StatusFeedResponse {
  return {
    mine: [],
    people: [
      {
        user: riya,
        statuses: [
          statusFixture('u-riya', { text: 'first from Riya' }, 30),
          statusFixture('u-riya', { text: 'second from Riya' }),
        ],
        muted: false,
      },
      {
        user: vikram,
        statuses: [statusFixture('u-vikram', { text: 'from Vikram', viewed: true })],
        muted: false,
      },
      { user: meera, statuses: [statusFixture('u-meera', { text: 'from Meera' })], muted: true },
    ],
    ...overrides,
  };
}
