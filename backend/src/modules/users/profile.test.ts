import {
  apiErrorSchema,
  myProfileResponseSchema,
  privacyResponseSchema,
  publicProfileResponseSchema,
  sessionResponseSchema,
  usernameAvailabilityResponseSchema,
  usernameSuggestionResponseSchema,
} from '@zuvo/protocol';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers, signIn } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { jpegWithExif, signInWithProfile, uploadAvatar } from '../../../test/user-helpers.ts';
import { loadUser } from '../../users/user-record.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
let alice: { cookie: string; id: string };
let bob: { cookie: string; id: string };

beforeAll(async () => {
  ctx = await buildTestApp();
  alice = await signInWithProfile(app(), 'alice@corremadvisory.com', {
    displayName: 'Alice Iyer',
    username: 'alice',
  });
  bob = await signInWithProfile(app(), 'bob@corremadvisory.com', {
    displayName: 'Bob Das',
    username: 'bob',
  });
});
afterAll(async () => {
  await ctx.cleanup();
});

const call = (
  method: 'GET' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie?: string,
  payload?: object,
) => app().inject({ method, url, headers: headers(cookie), ...(payload ? { payload } : {}) });

describe('profile and username', () => {
  it('returns and edits the own profile (contract-valid)', async () => {
    const fetched = myProfileResponseSchema.parse(
      (await call('GET', '/v1/me/profile', alice.cookie)).json(),
    );
    expect(fetched.profile).toMatchObject({
      username: 'alice',
      about: "Hey there! I'm using Zuvo",
    });
    const edited = await call('PATCH', '/v1/me/profile', alice.cookie, { about: 'Building Zuvo' });
    expect(myProfileResponseSchema.parse(edited.json()).profile.about).toBe('Building Zuvo');
    const tooLong = await call('PATCH', '/v1/me/profile', alice.cookie, { about: 'x'.repeat(141) });
    expect(tooLong.statusCode).toBe(400);
    expect((await call('PATCH', '/v1/me/profile', alice.cookie, {})).statusCode).toBe(400);
  });

  it('saves the app language, returns it everywhere, and refuses anything else', async () => {
    const before = myProfileResponseSchema.parse(
      (await call('GET', '/v1/me/profile', bob.cookie)).json(),
    );
    expect(before.profile.language).toBe('en');
    const saved = await call('PATCH', '/v1/me/profile', bob.cookie, { language: 'hi' });
    expect(saved.statusCode).toBe(200);
    expect(myProfileResponseSchema.parse(saved.json()).profile).toMatchObject({
      language: 'hi',
      displayName: 'Bob Das',
    });
    const me = sessionResponseSchema.parse((await call('GET', '/v1/auth/me', bob.cookie)).json());
    expect(me.user.language).toBe('hi');
    expect((await loadUser(app(), bob.id))?.language).toBe('hi');
    const invalid = await call('PATCH', '/v1/me/profile', bob.cookie, { language: 'fr' });
    expect(invalid.statusCode).toBe(400);
    expect((await call('PATCH', '/v1/me/profile', undefined, { language: 'hi' })).statusCode).toBe(
      401,
    );
    await call('PATCH', '/v1/me/profile', bob.cookie, { language: 'en' });
  });

  it('checks availability, suggests and rejects a taken username', async () => {
    const taken = await call('GET', '/v1/users/username-availability?username=bob', alice.cookie);
    expect(usernameAvailabilityResponseSchema.parse(taken.json())).toMatchObject({
      available: false,
      reason: 'taken',
    });
    const free = await call(
      'GET',
      '/v1/users/username-availability?username=@Alice_2',
      alice.cookie,
    );
    expect(free.json()).toMatchObject({ username: 'alice_2', available: true });
    const suggestion = await call('GET', '/v1/me/username-suggestion', alice.cookie);
    expect(usernameSuggestionResponseSchema.parse(suggestion.json()).username).toBe('alice');
    const clash = await call('PUT', '/v1/me/username', bob.cookie, { username: 'alice' });
    expect(clash.statusCode).toBe(409);
    expect(apiErrorSchema.parse(clash.json()).code).toBe('USERNAME_TAKEN');
    const invalid = await call('PUT', '/v1/me/username', bob.cookie, { username: '9lives' });
    expect(invalid.statusCode).toBe(400);
  });

  it('requires a session for every profile route', async () => {
    for (const [method, url] of [
      ['GET', '/v1/me/profile'],
      ['PUT', '/v1/me/username'],
      ['GET', '/v1/me/privacy'],
      ['GET', '/v1/users/search?q=a'],
      ['GET', `/v1/users/${bob.id}`],
      ['GET', `/v1/users/${bob.id}/avatar`],
      ['GET', '/v1/users/username-availability?username=abc'],
    ] as const) {
      expect((await call(method, url)).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await uploadAvatar(app(), undefined, await jpegWithExif())).statusCode).toBe(401);
  });
});

describe('avatar', () => {
  it('uploads, strips EXIF, serves with ETag/private cache and deletes old files', async () => {
    const first = await uploadAvatar(app(), alice.cookie, await jpegWithExif());
    expect(first.statusCode).toBe(200);
    const avatar = myProfileResponseSchema.parse(first.json()).profile.avatar;
    expect(avatar?.large).toMatch(new RegExp(`^/v1/users/${alice.id}/avatar\\?size=large&v=`));
    const firstKeys = (await loadUser(app(), alice.id))?.avatar;

    const served = await call('GET', avatar?.large ?? '', bob.cookie);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('private, max-age=86400');
    const servedMeta = await sharp(served.rawPayload).metadata();
    expect(servedMeta.width).toBe(512);
    expect(servedMeta.exif).toBeUndefined();
    const cached = await app().inject({
      method: 'GET',
      url: avatar?.large ?? '',
      headers: { ...headers(bob.cookie), 'if-none-match': String(served.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);

    expect((await uploadAvatar(app(), alice.cookie, await jpegWithExif())).statusCode).toBe(200);
    expect(await app().storage.exists(firstKeys?.large ?? '')).toBe(false);
    expect(await app().storage.exists(firstKeys?.small ?? '')).toBe(false);

    const secondKeys = (await loadUser(app(), alice.id))?.avatar;
    const removed = await call('DELETE', '/v1/me/avatar', alice.cookie);
    expect(myProfileResponseSchema.parse(removed.json()).profile.avatar).toBeNull();
    expect(await app().storage.exists(secondKeys?.small ?? '')).toBe(false);
  });

  it('rejects non-images (415) and files over 5 MB (413)', async () => {
    const text = await uploadAvatar(app(), bob.cookie, Buffer.from('definitely not a photo'));
    expect(text.statusCode).toBe(415);
    expect(text.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const huge = Buffer.concat([await jpegWithExif(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const tooBig = await uploadAvatar(app(), bob.cookie, huge);
    expect(tooBig.statusCode).toBe(413);
  });
});

describe('privacy and public profiles', () => {
  it('hides photo and about from others when set to nobody, never from the owner', async () => {
    await uploadAvatar(app(), bob.cookie, await jpegWithExif());
    const privacy = {
      lastSeen: 'everyone',
      profilePhoto: 'nobody',
      about: 'nobody',
      readReceipts: true,
    };
    const saved = await call('PUT', '/v1/me/privacy', bob.cookie, privacy);
    expect(privacyResponseSchema.parse(saved.json()).privacy).toMatchObject({
      profilePhoto: 'nobody',
    });

    const seen = publicProfileResponseSchema.parse(
      (await call('GET', `/v1/users/${bob.id}`, alice.cookie)).json(),
    );
    expect(seen.user).toMatchObject({ username: 'bob', about: null, avatar: null });
    expect((await call('GET', `/v1/users/${bob.id}/avatar`, alice.cookie)).statusCode).toBe(404);
    const own = publicProfileResponseSchema.parse(
      (await call('GET', `/v1/users/${bob.id}`, bob.cookie)).json(),
    );
    expect(own.user.avatar).not.toBeNull();

    const search = await call('GET', '/v1/users/search?q=bob', alice.cookie);
    expect(search.json().items[0]).toMatchObject({ username: 'bob', avatar: null, about: null });
  });

  it('shows deactivated users as "Deactivated account" and 404s unknown ids', async () => {
    const { response } = await signIn(app(), 'carol@corremadvisory.com');
    const carolId = response.json().user.id as string;
    await app()
      .mongo.db?.collection('user')
      .updateOne({ email: 'carol@corremadvisory.com' }, { $set: { status: 'deactivated' } });
    const profile = await call('GET', `/v1/users/${carolId}`, alice.cookie);
    expect(profile.json().user).toMatchObject({
      displayName: 'Deactivated account',
      deactivated: true,
    });
    expect((await call('GET', '/v1/users/000000000000000000000000', alice.cookie)).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/v1/users/not-an-id', alice.cookie)).statusCode).toBe(404);
  });
});
