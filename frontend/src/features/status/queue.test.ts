import { describe, expect, it } from 'vitest';
import { withoutExpired } from './feed';
import { feedFixture, statusFixture } from './status-test-fixtures';
import {
  durationOf,
  firstUnseen,
  nextPosition,
  previousPosition,
  STILL_MS,
  type ViewerPerson,
} from './viewer/queue';

const queue: ViewerPerson[] = feedFixture().people.map((person) => ({
  user: person.user,
  statuses: person.statuses,
  mine: false,
}));

describe('moving through statuses', () => {
  it('goes to the person’s next status, then the next person’s first, then ends', () => {
    expect(nextPosition(queue, { person: 0, status: 0 })).toEqual({ person: 0, status: 1 });
    expect(nextPosition(queue, { person: 0, status: 1 })).toEqual({ person: 1, status: 0 });
    expect(nextPosition(queue, { person: 2, status: 0 })).toBeNull();
  });

  it('goes back within a person, then to the previous person’s last', () => {
    expect(previousPosition(queue, { person: 0, status: 1 })).toEqual({ person: 0, status: 0 });
    expect(previousPosition(queue, { person: 1, status: 0 })).toEqual({ person: 0, status: 1 });
    expect(previousPosition(queue, { person: 0, status: 0 })).toBeNull();
  });

  it('starts at someone’s first status not seen yet', () => {
    const person = {
      ...queue[0],
      statuses: [statusFixture('u', { viewed: true }), statusFixture('u')],
    } as ViewerPerson;
    expect(firstUnseen(person)).toBe(1);
    expect(
      firstUnseen({ ...person, statuses: person.statuses.map((s) => ({ ...s, viewed: true })) }),
    ).toBe(0);
  });

  it('shows a picture or text for 5 s, and a video for its length, at most 60 s', () => {
    expect(durationOf(statusFixture('u'))).toBe(STILL_MS);
    const video = statusFixture('u', { kind: 'video' });
    expect(durationOf(video, 12.5)).toBe(12_500);
    expect(durationOf(video, 90)).toBe(60_000);
  });
});

describe('the feed on this device', () => {
  it('drops what has expired, and people with nothing left', () => {
    const old = statusFixture('u-riya', {}, 25 * 60);
    const feed = feedFixture({ mine: [old] });
    feed.people[0] = { ...feed.people[0], statuses: [old] } as (typeof feed.people)[number];
    const shown = withoutExpired(feed);
    expect(shown.mine).toEqual([]);
    expect(shown.people.map((p) => p.user.id)).toEqual(['u-vikram', 'u-meera']);
  });
});
