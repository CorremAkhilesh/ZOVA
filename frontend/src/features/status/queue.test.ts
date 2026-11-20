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
  withoutStatuses,
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

describe('a status that goes while the viewer is open', () => {
  const ids = (q: ViewerPerson[]) => q.map((person) => person.statuses.map((status) => status.id));
  const riya = queue[0]?.statuses ?? [];
  const not =
    (...gone: (string | undefined)[]) =>
    (status: { id: string }) =>
      !gone.includes(status.id);

  it('deleting the one on screen shows the one after it', () => {
    const left = withoutStatuses(queue, { person: 0, status: 0 }, not(riya[0]?.id));
    expect(left?.at).toEqual({ person: 0, status: 0 });
    expect(left?.queue[0]?.statuses[0]?.id).toBe(riya[1]?.id);
  });

  it('a person’s last one gone: the next person’s first', () => {
    const left = withoutStatuses(queue, { person: 0, status: 1 }, not(riya[1]?.id));
    expect(left?.at).toEqual({ person: 1, status: 0 });
  });

  it('a person with nothing left drops out; the one on screen stays put', () => {
    const left = withoutStatuses(queue, { person: 1, status: 0 }, not(riya[0]?.id, riya[1]?.id));
    expect(left && ids(left.queue)).toHaveLength(queue.length - 1);
    expect(left?.at).toEqual({ person: 0, status: 0 });
    expect(left?.queue[0]?.user.id).toBe(queue[1]?.user.id);
  });

  it('the very last one gone: the one before it; nothing left: null (the viewer closes)', () => {
    const lastPerson = queue.length - 1;
    const lastId = queue[lastPerson]?.statuses.at(-1)?.id;
    const left = withoutStatuses(queue, { person: lastPerson, status: 0 }, not(lastId));
    const end = left?.queue.at(-1);
    expect(left?.at).toEqual({
      person: (left?.queue.length ?? 0) - 1,
      status: (end?.statuses.length ?? 0) - 1,
    });
    expect(withoutStatuses(queue, { person: 0, status: 0 }, () => false)).toBeNull();
  });
});
