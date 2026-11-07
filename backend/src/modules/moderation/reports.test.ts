import {
  auditLogResponseSchema,
  chatResponseSchema,
  createReportResponseSchema,
  reportDetailResponseSchema,
  reportListResponseSchema,
  reportSummarySchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets, signedIn } from '../../../test/realtime-helpers.ts';
import { oid } from '../../chats/chats.service.ts';
import { moderationModels } from '../../moderation/blocks.service.ts';
import { REPORTS_PER_HOUR } from '../../moderation/reports.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const report = (who: Person | null, body: object) => call(who, 'POST', '/v1/reports', body);
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const detail = async (id: string) => {
  const response = await call(admin, 'GET', `/v1/admin/reports/${id}`);
  expect(response.statusCode).toBe(200);
  return reportDetailResponseSchema.parse(response.json()).report;
};
const sent = async (who: Person, chatId: string, text: string) =>
  (await say(who, chatId, text)).message.id;

describe('reporting', () => {
  it('a message: the picked one plus the senderâ€™s last 5 I can see, copied', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await say(bharat, chatId, 'before chitra joined');
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [chitra.id] });
    for (const n of [1, 2, 3, 4, 5, 6]) await say(bharat, chatId, `rude ${n}`);
    const picked = await sent(bharat, chatId, 'the worst one');
    const response = await report(chitra, {
      target: { kind: 'message', chatId, messageIds: [picked] },
      reason: 'harassment',
      note: '  please look  ',
    });
    expect(response.statusCode).toBe(200);
    const { reportId, blocked } = createReportResponseSchema.parse(response.json());
    expect(blocked).toBe(false);
    // Later edits or deletes change nothing in the copy.
    await call(bharat, 'DELETE', `/v1/chats/${chatId}/messages/${picked}?scope=everyone`);
    const seen = await detail(reportId);
    expect(seen).toMatchObject({
      kind: 'message',
      reason: 'harassment',
      note: 'please look',
      reporter: { id: chitra.id },
      reported: { id: bharat.id },
    });
    expect(seen.evidence.map((item) => item.text)).toEqual([
      'rude 3',
      'rude 4',
      'rude 5',
      'rude 6',
      'the worst one',
    ]);
    expect(seen.evidence.filter((item) => item.selected).map((item) => item.text)).toEqual([
      'the worst one',
    ]);
  });

  it('a person from our chat, and report and block', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await say(bharat, chatId, 'buy my crypto');
    const response = await report(asha, {
      target: { kind: 'user', userId: bharat.id, chatId },
      reason: 'scam',
      block: true,
    });
    const { reportId, blocked } = createReportResponseSchema.parse(response.json());
    expect(blocked).toBe(true);
    const blocks = await call(asha, 'GET', '/v1/me/blocks');
    expect(blocks.json().items.map((item: { user: { id: string } }) => item.user.id)).toEqual([
      bharat.id,
    ]);
    const seen = await detail(reportId);
    expect(seen.evidence.map((item) => item.text)).toEqual(['buy my crypto']);
    expect(seen.blocked).toBe(true);
  });

  it('a group, with its latest messages', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat], 'Spam corner');
    await say(bharat, chatId, 'join my other group');
    const { reportId } = createReportResponseSchema.parse(
      (await report(asha, { target: { kind: 'group', chatId }, reason: 'spam' })).json(),
    );
    const seen = await detail(reportId);
    expect(seen).toMatchObject({ kind: 'group', reported: null, group: { name: 'Spam corner' } });
    expect(seen.evidence.map((item) => item.text)).toContain('join my other group');
    const notGroup = await report(asha, {
      target: { kind: 'group', chatId: await direct(asha, bharat) },
      reason: 'spam',
    });
    expect(notGroup.statusCode).toBe(400);
  });

  it('refuses what I cannot see, myself, bad input and the signed out', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const theirs = await sent(bharat, chatId, 'hello');
    const mine = await sent(asha, chatId, 'hi');
    const message = (who: Person, id: string) =>
      report(who, { target: { kind: 'message', chatId, messageIds: [id] }, reason: 'spam' });
    expect((await message(outsider, theirs)).statusCode).toBe(404);
    expect((await message(asha, mine)).statusCode).toBe(400);
    expect(
      (await report(asha, { target: { kind: 'user', userId: asha.id }, reason: 'spam' }))
        .statusCode,
    ).toBe(400);
    expect((await report(asha, { target: { kind: 'user' }, reason: 'spam' })).statusCode).toBe(400);
    expect(
      (await report(asha, { target: { kind: 'user', userId: bharat.id }, reason: 'meh' }))
        .statusCode,
    ).toBe(400);
    expect((await message(null as never, theirs)).statusCode).toBe(401);
    // A message I deleted for me is not mine to report any more.
    await call(asha, 'DELETE', `/v1/chats/${chatId}/messages/${theirs}?scope=me`);
    expect((await message(asha, theirs)).statusCode).toBe(404);
  });

  it(`stops at ${REPORTS_PER_HOUR} reports an hour per person`, async () => {
    const [asha, bharat] = [await person(), await person()];
    const body = { target: { kind: 'user', userId: bharat.id }, reason: 'spam' };
    for (let n = 0; n < REPORTS_PER_HOUR; n++) {
      expect((await report(asha, body)).statusCode).toBe(200);
    }
    expect((await report(asha, body)).statusCode).toBe(429);
  });
});

describe('Admin â†’ Reports', () => {
  it('lists newest first with a status filter and a cursor', async () => {
    const [asha, bharat] = [await person(), await person()];
    for (const reason of ['spam', 'scam', 'hate']) {
      await report(asha, { target: { kind: 'user', userId: bharat.id }, reason });
    }
    const first = reportListResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/reports?status=open&limit=2')).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.items[0]?.reason).toBe('hate');
    expect(first.nextCursor).not.toBeNull();
    const next = reportListResponseSchema.parse(
      (
        await call(
          admin,
          'GET',
          `/v1/admin/reports?status=open&limit=2&cursor=${first.nextCursor ?? ''}`,
        )
      ).json(),
    );
    expect(next.items[0]?.reason).toBe('spam');
  });

  it('resolves, can deactivate the person, and audits viewing and resolving', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { reportId } = createReportResponseSchema.parse(
      (
        await report(asha, { target: { kind: 'user', userId: bharat.id }, reason: 'violence' })
      ).json(),
    );
    await detail(reportId);
    const resolved = await call(admin, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'deactivate',
      note: 'confirmed',
    });
    expect(resolved.statusCode).toBe(200);
    expect(z.object({ report: reportSummarySchema }).parse(resolved.json()).report).toMatchObject({
      status: 'resolved',
      resolution: { action: 'deactivated', note: 'confirmed' },
      reported: { id: bharat.id, status: 'deactivated' },
    });
    const again = await call(admin, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'none',
    });
    expect(again.statusCode).toBe(409);
    const log = auditLogResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/audit-log?limit=10')).json(),
    );
    const actions = log.items
      .filter((entry) => entry.target.id === bharat.id)
      .map((entry) => entry.action);
    expect(actions).toEqual(['report.resolve', 'user.deactivate', 'report.view']);
    const resolvedList = reportListResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/reports?status=resolved')).json(),
    );
    expect(resolvedList.items.map((item) => item.id)).toContain(reportId);
  });

  it('is for admins only', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { reportId } = createReportResponseSchema.parse(
      (await report(asha, { target: { kind: 'user', userId: bharat.id }, reason: 'spam' })).json(),
    );
    expect((await call(asha, 'GET', '/v1/admin/reports')).statusCode).toBe(403);
    expect((await call(asha, 'GET', `/v1/admin/reports/${reportId}`)).statusCode).toBe(403);
    expect(
      (await call(asha, 'POST', `/v1/admin/reports/${reportId}/resolve`, { action: 'none' }))
        .statusCode,
    ).toBe(403);
    expect((await call(null, 'GET', '/v1/admin/reports')).statusCode).toBe(401);
    expect((await call(admin, 'GET', '/v1/admin/reports/nope')).statusCode).toBe(400);
    expect(
      (await call(admin, 'POST', `/v1/admin/reports/${reportId}/resolve`, { action: 'x' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(admin, 'GET', '/v1/admin/reports/0123456789abcdef01234567')).statusCode,
    ).toBe(404);
  });

  it('every report query uses an index', async () => {
    const { Report } = moderationModels(app());
    const at = new Date();
    const id = oid('0123456789abcdef01234567');
    await expectIndexedQuery(
      Report.find({
        status: 'open',
        $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }],
      }).sort({
        createdAt: -1,
        _id: -1,
      }),
    );
    await expectIndexedQuery(Report.find({}).sort({ createdAt: -1, _id: -1 }));
    await expectIndexedQuery(Report.find({ reporterId: id, createdAt: { $gt: at } }));
  });
});
