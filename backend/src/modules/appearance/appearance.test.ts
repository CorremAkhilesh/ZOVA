import {
  appearanceResponseSchema,
  chatResponseSchema,
  DEFAULT_APPEARANCE,
  wallpaperImageResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { jpegWithExif, multipartFile } from '../../../test/user-helpers.ts';
import { toAppearance } from '../../appearance/appearance.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let url: string | undefined;
/** One server for the whole file. */
const serverUrl = async () => {
  url ??= await listen(app());
  return url;
};

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const patch = (who: Person | null, body: object) => call(who, 'PATCH', '/v1/me/appearance', body);
const chatWallpaper = (who: Person | null, chatId: string, wallpaper: unknown) =>
  call(who, 'PUT', `/v1/chats/${chatId}/wallpaper`, { wallpaper });

async function upload(who: Person) {
  const { payload, contentType } = multipartFile(await jpegWithExif(), 'beach.jpg');
  const response = await app().inject({
    method: 'POST',
    url: '/v1/me/wallpapers',
    headers: { ...headers(who.cookie), 'content-type': contentType },
    payload,
  });
  expect(response.statusCode).toBe(200);
  return wallpaperImageResponseSchema.parse(response.json()).image.id;
}

describe('appearance', () => {
  it('starts with the defaults and keeps any subset of changes', async () => {
    const asha = await person();
    const first = await call(asha, 'GET', '/v1/me/appearance');
    expect(appearanceResponseSchema.parse(first.json()).appearance).toEqual(DEFAULT_APPEARANCE);
    await patch(asha, { accent: 'teal' });
    const second = await patch(asha, { wallpaper: { kind: 'color', id: 'sage' }, dim: 50 });
    expect(appearanceResponseSchema.parse(second.json()).appearance).toEqual({
      accent: 'teal',
      wallpaper: { kind: 'color', id: 'sage' },
      dim: 50,
    });
  });

  it('refuses bad input', async () => {
    const asha = await person();
    for (const body of [
      {},
      { accent: 'green' },
      { dim: 81 },
      { dim: -1 },
      { wallpaper: { kind: 'pattern', id: 'stripes' } },
      { wallpaper: { kind: 'image', id: 'nope' } },
    ]) {
      expect((await patch(asha, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("an image wallpaper must be one of mine; someone else's is refused", async () => {
    const [asha, bharat] = [await person(), await person()];
    const ashas = await upload(asha);
    expect((await patch(asha, { wallpaper: { kind: 'image', id: ashas } })).statusCode).toBe(200);
    const refused = await patch(bharat, { wallpaper: { kind: 'image', id: ashas } });
    expect(refused.statusCode).toBe(404);
    expect((await call(bharat, 'GET', '/v1/me/appearance')).json().appearance).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it('tells my other devices', async () => {
    const asha = await person();
    const socket = await connect(await serverUrl(), asha.cookie);
    const events = record(socket, 'appearance:updated');
    await patch(asha, { accent: 'rose' });
    await waitUntil(() => expect(events.at(-1)?.appearance.accent).toBe('rose'));
  });

  it('falls back to the defaults for unreadable stored values', () => {
    expect(toAppearance({ dim: 500 })).toEqual(DEFAULT_APPEARANCE);
    expect(toAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('chat wallpaper', () => {
  it('is mine alone, for chats I am in, and null goes back to my default', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const set = await chatWallpaper(asha, chatId, { kind: 'pattern', id: 'waves' });
    expect(chatResponseSchema.parse(set.json()).chat.wallpaper).toEqual({
      kind: 'pattern',
      id: 'waves',
    });
    expect((await call(bharat, 'GET', `/v1/chats/${chatId}`)).json().chat.wallpaper).toBeNull();
    expect((await chatWallpaper(chitra, chatId, null)).statusCode).toBe(404);
    expect((await chatWallpaper(asha, chatId, { kind: 'color', id: 'neon' })).statusCode).toBe(400);
    expect((await chatWallpaper(asha, chatId, null)).json().chat.wallpaper).toBeNull();
  });

  it("refuses another person's picture", async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const ashas = await upload(asha);
    const refused = await chatWallpaper(bharat, chatId, { kind: 'image', id: ashas });
    expect(refused.statusCode).toBe(404);
    const mine = await chatWallpaper(asha, chatId, { kind: 'image', id: ashas });
    expect(mine.json().chat.wallpaper).toEqual({ kind: 'image', id: ashas });
  });

  it('tells my devices how the chat looks now', async () => {
    const asha = await person();
    const chatId = await group(asha);
    const socket = await connect(await serverUrl(), asha.cookie);
    const events = record(socket, 'chat:updated');
    await chatWallpaper(asha, chatId, { kind: 'color', id: 'sand' });
    await waitUntil(() =>
      expect(events.at(-1)).toMatchObject({ chatId, wallpaper: { kind: 'color', id: 'sand' } }),
    );
  });

  it('needs a session', async () => {
    const chatId = '0123456789abcdef01234567';
    expect((await call(null, 'GET', '/v1/me/appearance')).statusCode).toBe(401);
    expect((await patch(null, { accent: 'teal' })).statusCode).toBe(401);
    expect((await chatWallpaper(null, chatId, null)).statusCode).toBe(401);
  });
});
