import { randomBytes } from 'node:crypto';
import {
  auditLogResponseSchema,
  chatResponseSchema,
  createReportResponseSchema,
  STATUS_PER_DAY_MAX,
  statusFeedResponseSchema,
  statusResponseSchema,
  statusViewersResponseSchema,
  syncResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, png } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  signedIn,
  uuidv7,
} from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { cleanupDeletedMedia } from '../../media/media-access.ts';
import { statusModels } from '../../status/audience.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call } = groupClient(app);
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

const TEXT = { kind: 'text', text: 'standup at 10', style: { background: 'teal', font: 'sans' } };
const post = async (who: Person, body: object = TEXT) => {
  const response = await call(who, 'POST', '/v1/statuses', body);
  expect(response.statusCode, response.body).toBe(200);
  return statusResponseSchema.parse(response.json()).status;
};
const feed = async (who: Person) =>
  statusFeedResponseSchema.parse((await call(who, 'GET', '/v1/statuses')).json());
const seesOf = async (who: Person, owner: Person) =>
  (await feed(who)).people.find((p) => p.user.id === owner.id)?.statuses ?? [];
const privacy = (who: Person, body: object) => call(who, 'PUT', '/v1/me/status-privacy', body);
const receipts = (who: Person, readReceipts: boolean) =>
  call(who, 'PUT', '/v1/me/privacy', {
    lastSeen: 'everyone',
    profilePhoto: 'everyone',
    about: 'everyone',
    readReceipts,
  });

describe('posting and seeing', () => {
  it('a text status reaches colleagues, and the owner sees it as their own', async () => {
    const [asha, bharat] = [await person(), await person()];
    const status = await post(asha);
    expect(status).toMatchObject({ kind: 'text', text: 'standup at 10', viewCount: 0 });
    expect(new Date(status.expiresAt).getTime() - new Date(status.createdAt).getTime()).toBe(
      24 * 3_600_000,
    );
    expect((await feed(asha)).mine.map((s) => s.id)).toEqual([status.id]);
    expect(await seesOf(bharat, asha)).toEqual([
      expect.objectContaining({ id: status.id, viewed: false }),
    ]);
  });

  it('"except" and "only" decide who sees the statuses posted after the change', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const before = await post(asha);
    const changed = await privacy(asha, { mode: 'except', userIds: [bharat.id] });
    expect(changed.statusCode, changed.body).toBe(200);
    const except = await post(asha);
    expect((await seesOf(bharat, asha)).map((s) => s.id)).toEqual([before.id]);
    expect((await seesOf(chitra, asha)).map((s) => s.id)).toEqual([before.id, except.id]);
    // Hidden from Bharat entirely: viewing it is "not found".
    expect((await call(bharat, 'POST', `/v1/statuses/${except.id}/view`, {})).statusCode).toBe(404);

    await privacy(asha, { mode: 'only', userIds: [chitra.id] });
    const only = await post(asha);
    expect((await seesOf(bharat, asha)).map((s) => s.id)).not.toContain(only.id);
    expect((await seesOf(chitra, asha)).map((s) => s.id)).toContain(only.id);
    const saved = (await call(asha, 'GET', '/v1/me/status-privacy')).json();
    expect(saved).toEqual({ privacy: { mode: 'only', userIds: [chitra.id] } });
  });

  it('blocking either way hides statuses', async () => {
    const [asha, bharat] = [await person(), await person()];
    await post(asha);
    expect((await call(bharat, 'PUT', `/v1/me/blocks/${asha.id}`)).statusCode).toBe(200);
    expect(await seesOf(bharat, asha)).toEqual([]);
  });

  it('allows 30 a day, and nothing that is not mine or not checked', async () => {
    const asha = await person();
    await statusModels(app()).Status.insertMany(
      Array.from({ length: STATUS_PER_DAY_MAX }, () => ({
        userId: oid(asha.id),
        kind: 'text',
        text: 'x',
        style: { background: 'teal', font: 'sans' },
        audience: { mode: 'all', userIds: [] },
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    );
    const refused = await call(asha, 'POST', '/v1/statuses', TEXT);
    expect(refused.json().code).toBe('STATUS_LIMIT_REACHED');
    const bad = await call(asha, 'POST', '/v1/statuses', { kind: 'text', text: '', style: {} });
    expect(bad.statusCode).toBe(400);
    expect((await call(null, 'GET', '/v1/statuses')).statusCode).toBe(401);
    expect((await call(null, 'POST', '/v1/statuses', TEXT)).statusCode).toBe(401);
  });
});

describe('views, read receipts and mutes', () => {
  it('lists who viewed, with reactions, only while both share read receipts', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const status = await post(asha);
    await call(bharat, 'POST', `/v1/statuses/${status.id}/view`, { reaction: '😍' });
    await call(chitra, 'POST', `/v1/statuses/${status.id}/view`, {});
    expect((await seesOf(bharat, asha))[0]?.viewed).toBe(true);
    const viewers = async () =>
      statusViewersResponseSchema.parse(
        (await call(asha, 'GET', `/v1/statuses/${status.id}/viewers`)).json(),
      );
    expect((await viewers()).count).toBe(2);
    expect((await viewers()).viewers.find((v) => v.user.id === bharat.id)?.reaction).toBe('😍');
    // Someone else cannot read my viewers.
    expect((await call(bharat, 'GET', `/v1/statuses/${status.id}/viewers`)).statusCode).toBe(404);

    await receipts(chitra, false);
    expect((await viewers()).viewers.map((v) => v.user.id)).toEqual([bharat.id]);
    await receipts(asha, false);
    expect(await viewers()).toEqual({ viewers: [], count: 0 });
    expect((await feed(asha)).mine[0]?.viewCount).toBeNull();
  });

  it('mutes and unmutes a person', async () => {
    const [asha, bharat] = [await person(), await person()];
    await post(asha);
    expect((await call(bharat, 'PUT', `/v1/statuses/mutes/${asha.id}`)).statusCode).toBe(200);
    expect((await feed(bharat)).people.find((p) => p.user.id === asha.id)?.muted).toBe(true);
    await call(bharat, 'DELETE', `/v1/statuses/mutes/${asha.id}`);
    expect((await feed(bharat)).people.find((p) => p.user.id === asha.id)?.muted).toBe(false);
    expect((await call(bharat, 'PUT', `/v1/statuses/mutes/${bharat.id}`)).statusCode).toBe(400);
  });
});

describe('ending', () => {
  it('only the owner deletes, and it goes for everyone', async () => {
    const [asha, bharat] = [await person(), await person()];
    const status = await post(asha);
    expect((await call(bharat, 'DELETE', `/v1/statuses/${status.id}`)).statusCode).toBe(404);
    expect((await call(asha, 'DELETE', `/v1/statuses/${status.id}`)).statusCode).toBe(200);
    expect(await seesOf(bharat, asha)).toEqual([]);
  });

  it('an expired status is gone, and the next sync says statuses changed', async () => {
    const [asha, bharat] = [await person(), await person()];
    const cursor = syncResponseSchema.parse((await call(bharat, 'GET', '/v1/sync')).json()).cursor;
    const status = await post(asha);
    const sync = syncResponseSchema.parse(
      (await call(bharat, 'GET', `/v1/sync?since=${cursor}`)).json(),
    );
    expect(sync.statusesChanged).toBe(true);
    await statusModels(app()).Status.updateOne(
      { _id: oid(status.id) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(await seesOf(bharat, asha)).toEqual([]);
    expect((await call(bharat, 'POST', `/v1/statuses/${status.id}/view`, {})).statusCode).toBe(404);
  });
});

describe('photos and videos', () => {
  const uploads = () => mediaClient(app());
  const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom'),
    Buffer.alloc(12),
    randomBytes(2000),
  ]);
  const video = async (who: Person, duration: number) => {
    const { uploadId } = (
      await uploads().start(who, {
        kind: 'video',
        name: 'v.mp4',
        mime: 'video/mp4',
        size: MP4.length,
        duration,
      })
    ).json();
    await uploads().chunk(who, uploadId, 0, MP4);
    expect((await uploads().complete(who, uploadId)).statusCode).toBe(200);
    return uploadId as string;
  };

  it('a photo: shown to its audience only, and its file goes once it ends', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    await privacy(asha, { mode: 'except', userIds: [chitra.id] });
    const mediaId = await uploads().ready(asha, 'image', 'p.png', await png());
    const status = await post(asha, { kind: 'image', mediaId, caption: 'view' });
    expect(status).toMatchObject({ kind: 'image', text: 'view', media: { id: mediaId } });
    expect((await uploads().content(bharat, mediaId, {}, '?variant=thumb')).statusCode).not.toBe(
      404,
    );
    expect((await uploads().content(chitra, mediaId, {}, '?variant=thumb')).statusCode).toBe(404);
    // Used once only.
    const again = await call(asha, 'POST', '/v1/statuses', { kind: 'image', mediaId });
    expect(again.json().code).toBe('MEDIA_NOT_ATTACHABLE');
    const media = await chatModels(app()).Media.findById(mediaId).lean();
    expect(media?.deleteRequestedAt?.toISOString()).toBe(status.expiresAt);
    await cleanupDeletedMedia(app(), 200, new Date(Date.parse(status.expiresAt) + 1000));
    expect(await chatModels(app()).Media.exists({ _id: oid(mediaId) })).toBeNull();
  });

  it('a video up to 60 seconds; a longer one is refused', async () => {
    const asha = await person();
    expect((await post(asha, { kind: 'video', mediaId: await video(asha, 59.5) })).kind).toBe(
      'video',
    );
    const long = await call(asha, 'POST', '/v1/statuses', {
      kind: 'video',
      mediaId: await video(asha, 61),
    });
    expect(long.json().code).toBe('STATUS_VIDEO_TOO_LONG');
    const other = await person();
    const theirs = await call(other, 'POST', '/v1/statuses', {
      kind: 'video',
      mediaId: await video(asha, 10),
    });
    expect(theirs.json().code).toBe('MEDIA_NOT_ATTACHABLE');
  });
});

describe('replies and reports', () => {
  it('a reply goes to the owner’s 1:1 chat with a copy of the status', async () => {
    const [asha, bharat] = [await person(), await person()];
    const status = await post(asha);
    const chatId = chatResponseSchema.parse(
      (await call(bharat, 'POST', '/v1/chats/direct', { userId: asha.id })).json(),
    ).chat.id;
    const socket = await connect(await listen(app()), bharat.cookie);
    const ack = await socket.timeout(30_000).emitWithAck('message:send', {
      chatId,
      clientMsgId: uuidv7(),
      text: 'nice!',
      statusId: status.id,
    });
    expect(ack).toMatchObject({ ok: true });
    const history = (await call(asha, 'GET', `/v1/chats/${chatId}/messages`)).json();
    expect(history.items.at(-1)).toMatchObject({
      text: 'nice!',
      statusReply: { statusId: status.id, ownerId: asha.id, kind: 'text', text: 'standup at 10' },
    });
    // Not to a chat with someone else.
    const chitra = await person();
    const elsewhere = chatResponseSchema.parse(
      (await call(bharat, 'POST', '/v1/chats/direct', { userId: chitra.id })).json(),
    ).chat.id;
    const refused = await socket.timeout(30_000).emitWithAck('message:send', {
      chatId: elsewhere,
      clientMsgId: uuidv7(),
      text: 'nice!',
      statusId: status.id,
    });
    expect(refused).toMatchObject({ ok: false });
  });

  it('a reported status can be removed by an admin, and that is audited', async () => {
    const [asha, bharat] = [await person(), await person()];
    const status = await post(asha);
    const created = await call(bharat, 'POST', '/v1/reports', {
      target: { kind: 'status', statusId: status.id },
      reason: 'spam',
    });
    expect(created.statusCode).toBe(200);
    const { reportId } = createReportResponseSchema.parse(created.json());
    const own = await call(asha, 'POST', '/v1/reports', {
      target: { kind: 'status', statusId: status.id },
      reason: 'spam',
    });
    expect(own.statusCode).toBe(400);
    expect(
      (
        await call(bharat, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
          action: 'removeStatus',
        })
      ).statusCode,
    ).toBe(403);
    const resolved = await call(admin, 'POST', `/v1/admin/reports/${reportId}/resolve`, {
      action: 'removeStatus',
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().report.resolution.action).toBe('statusRemoved');
    expect(await seesOf(bharat, asha)).toEqual([]);
    const log = auditLogResponseSchema.parse(
      (await call(admin, 'GET', '/v1/admin/audit-log?limit=20')).json(),
    );
    expect(log.items.some((e) => e.action === 'status.remove' && e.target.id === asha.id)).toBe(
      true,
    );
  });
});
