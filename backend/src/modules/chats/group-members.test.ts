import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient, systemKinds } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { insertUser } from '../../../test/user-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { onUserDeactivated } from '../../chats/group-members.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, history, members, summary, setRole } = groupClient(app);

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(() => built.cleanup());

const roleOf = async (viewer: { cookie: string; id: string }, chatId: string, id: string) =>
  (await members(viewer as never, chatId)).find((member) => member.user.id === id)?.role;

describe('adding members', () => {
  it('follows the setting, and says who', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const url = `/v1/chats/${chatId}/members`;
    const add = (who: typeof asha) => call(who, 'POST', url, { userIds: [chitra.id] });
    expect((await add(bharat)).statusCode).toBe(403);
    expect((await add(asha)).statusCode).toBe(200);
    const messages = await history(asha, chatId);
    expect(systemKinds(messages)).toEqual(['created', 'added']);
    expect(messages.at(-1)?.system?.targets.map((target) => target.id)).toEqual([chitra.id]);
    await call(asha, 'PUT', `/v1/chats/${chatId}/group/settings`, { addMembers: 'all' });
    const dinesh = await person();
    expect((await call(bharat, 'POST', url, { userIds: [dinesh.id] })).statusCode).toBe(200);
    expect((await summary(asha, chatId)).group?.memberCount).toBe(4);
  });

  it('does nothing for someone already in, with no message', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [bharat.id] });
    expect(systemKinds(await history(asha, chatId))).toEqual(['created']);
  });

  it('stops at 256 members', async () => {
    const asha = await person();
    const chatId = await group(asha);
    await chatModels(app()).Chat.updateOne(
      { _id: oid(chatId) },
      { $set: { 'group.memberCount': 256 } },
    );
    const bharat = await person();
    const full = await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [bharat.id] });
    expect(full.statusCode).toBe(409);
    expect(full.json().code).toBe('GROUP_FULL');
  });

  it('refuses a deactivated account, and bad input', async () => {
    const asha = await person();
    const chatId = await group(asha);
    const gone = await insertUser(app(), {
      email: 'gone@corremadvisory.com',
      status: 'deactivated',
    });
    const url = `/v1/chats/${chatId}/members`;
    expect((await call(asha, 'POST', url, { userIds: [gone] })).statusCode).toBe(400);
    expect((await call(asha, 'POST', url, { userIds: [] })).statusCode).toBe(400);
  });
});

describe('removing members', () => {
  it('admins can remove members, not admins or the owner', async () => {
    const [asha, admin, other, plain] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    const chatId = await group(asha, [admin, other, plain]);
    await setRole(asha, chatId, admin, 'admin');
    await setRole(asha, chatId, other, 'admin');
    const remove = (who: typeof asha, target: typeof asha) =>
      call(who, 'DELETE', `/v1/chats/${chatId}/members/${target.id}`);
    expect((await remove(plain, other)).statusCode).toBe(403);
    expect((await remove(admin, other)).statusCode).toBe(403);
    expect((await remove(admin, asha)).statusCode).toBe(403);
    expect((await remove(admin, admin)).statusCode).toBe(400);
    expect((await remove(admin, plain)).statusCode).toBe(200);
    expect((await remove(asha, other)).statusCode).toBe(200);
    expect((await summary(asha, chatId)).group?.memberCount).toBe(2);
    expect(
      systemKinds(await history(asha, chatId)).filter((kind) => kind === 'removed'),
    ).toHaveLength(2);
  });

  it('someone not in the group cannot be removed', async () => {
    const [asha, stranger] = [await person(), await person()];
    const chatId = await group(asha);
    const response = await call(asha, 'DELETE', `/v1/chats/${chatId}/members/${stranger.id}`);
    expect(response.statusCode).toBe(404);
  });
});

describe('roles', () => {
  it('only the owner can promote and demote', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    expect((await setRole(bharat, chatId, chitra, 'admin')).statusCode).toBe(403);
    expect((await setRole(asha, chatId, bharat, 'admin')).statusCode).toBe(200);
    expect((await setRole(bharat, chatId, chitra, 'admin')).statusCode).toBe(403);
    expect(await roleOf(asha, chatId, bharat.id)).toBe('admin');
    expect((await setRole(asha, chatId, bharat, 'member')).statusCode).toBe(200);
    expect(systemKinds(await history(asha, chatId))).toEqual(['created', 'promoted', 'demoted']);
    expect((await setRole(asha, chatId, asha, 'member')).statusCode).toBe(409);
  });
});

describe('ownership', () => {
  it('can be handed over by the owner only', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const url = `/v1/chats/${chatId}/transfer`;
    expect((await call(bharat, 'POST', url, { userId: bharat.id })).statusCode).toBe(403);
    expect((await call(asha, 'POST', url, { userId: asha.id })).statusCode).toBe(400);
    expect((await call(asha, 'POST', url, { userId: bharat.id })).statusCode).toBe(200);
    expect(await roleOf(asha, chatId, bharat.id)).toBe('owner');
    expect(await roleOf(asha, chatId, asha.id)).toBe('admin');
    expect(systemKinds(await history(asha, chatId))).toContain('owner_changed');
  });

  it('must be handed over before the owner can leave', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const blocked = await call(asha, 'POST', `/v1/chats/${chatId}/leave`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('OWNER_MUST_TRANSFER');
    await call(asha, 'POST', `/v1/chats/${chatId}/transfer`, { userId: bharat.id });
    expect((await call(asha, 'POST', `/v1/chats/${chatId}/leave`)).statusCode).toBe(200);
  });

  it('the last person can simply leave', async () => {
    const asha = await person();
    const chatId = await group(asha);
    expect((await call(asha, 'POST', `/v1/chats/${chatId}/leave`)).statusCode).toBe(200);
  });

  it('passes to the oldest admin when the owner is deactivated', async () => {
    const [asha, plain, young, old] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    const chatId = await group(asha, [plain, old]);
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [young.id] });
    await setRole(asha, chatId, young, 'admin');
    await setRole(asha, chatId, old, 'admin');
    await onUserDeactivated(app(), asha.id);
    expect(await roleOf(plain, chatId, old.id)).toBe('owner');
    const last = (await history(plain, chatId)).at(-1);
    expect(last?.system).toMatchObject({ kind: 'owner_changed', actor: null });
  });

  it('passes to the oldest member when there is no admin', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [chitra.id] });
    await onUserDeactivated(app(), asha.id);
    expect(await roleOf(bharat, chatId, bharat.id)).toBe('owner');
  });

  it('through the admin route too', async () => {
    const [admin, asha, bharat] = [
      await (await import('../../../test/realtime-helpers.ts')).signedIn(
        app(),
        'admin@corremadvisory.com',
      ),
      await person(),
      await person(),
    ];
    const chatId = await group(asha, [bharat]);
    const off = await call(admin, 'POST', `/v1/admin/users/${asha.id}/deactivate`, {});
    expect(off.statusCode).toBe(200);
    expect(await roleOf(bharat, chatId, bharat.id)).toBe('owner');
  });
});
