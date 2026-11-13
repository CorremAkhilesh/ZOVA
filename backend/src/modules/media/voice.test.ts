import { appConfigResponseSchema, mediaInfoSchema, messageSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  signedIn,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { chatModels, getOrCreateDirectChat, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { markPlayed } from '../../chats/played.service.ts';

const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(512, 1)]);
const WEBM = pad(
  Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102', 'hex'),
);
const OGG = pad(
  Buffer.concat([
    Buffer.from('OggS', 'latin1'),
    Buffer.alloc(24),
    Buffer.from('OpusHead', 'latin1'),
    Buffer.alloc(32),
  ]),
);
const mp4 = (brand: string) =>
  pad(
    Buffer.concat([
      Buffer.from('00000018', 'hex'),
      Buffer.from(`ftyp${brand}`, 'latin1'),
      Buffer.alloc(12),
    ]),
  );
/** MPEG audio frames: the sync word is what identifies it, with or without tags before it. */
const MP3 = Buffer.concat(
  Array.from({ length: 40 }, () =>
    Buffer.concat([Buffer.from('fffb9000', 'hex'), Buffer.alloc(413)]),
  ),
);
const WAV = pad(Buffer.from('RIFF$\u0000\u0000\u0000WAVEfmt ', 'latin1'));
const FLAT = Array.from({ length: 64 }, () => 50);

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const client = () => mediaClient(app());
let people = 0;
const person = () => {
  people += 1;
  return signedIn(app(), `voice${people}@corremadvisory.com`);
};
type Person = Awaited<ReturnType<typeof person>>;
const voice = (size: number, extra: object = {}) => ({
  kind: 'voice',
  name: 'voice.webm',
  mime: 'audio/webm',
  size,
  duration: 12.4,
  waveform: FLAT,
  ...extra,
});

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

async function uploadVoice(who: Person, bytes: Buffer = WEBM, extra: object = {}) {
  const started = await client().start(who, voice(bytes.length, extra));
  expect(started.statusCode).toBe(200);
  const { uploadId } = started.json();
  expect((await client().chunk(who, uploadId, 0, bytes)).statusCode).toBe(200);
  return { uploadId, response: await client().complete(who, uploadId) };
}

describe('a voice note upload', () => {
  it.each([
    ['WebM', WEBM, 'audio/webm'],
    ['Ogg', OGG, 'audio/ogg'],
    ['M4A', mp4('M4A '), 'audio/mp4'],
    ['MP4', mp4('isom'), 'audio/mp4'],
  ])('accepts %s, by its bytes, and keeps the waveform and length', async (_name, bytes, mime) => {
    const { response } = await uploadVoice(await person(), bytes);
    expect(response.statusCode).toBe(200);
    expect(mediaInfoSchema.parse(response.json().media)).toMatchObject({
      kind: 'voice',
      mime,
      duration: 12.4,
      waveform: FLAT,
    });
  });

  it('refuses anything else, whatever it claims to be', async () => {
    const { response } = await uploadVoice(await person(), PDF);
    expect(response.statusCode).toBe(415);
  });

  it.each([
    ['no waveform', { waveform: undefined }],
    ['too few bars', { waveform: [1, 2, 3] }],
    ['too many bars', { waveform: Array.from({ length: 65 }, () => 1) }],
    ['a bar too tall', { waveform: [...FLAT.slice(1), 101] }],
    ['a negative bar', { waveform: [...FLAT.slice(1), -1] }],
    ['no length', { duration: undefined }],
    ['too short', { duration: 0.5 }],
  ])('refuses %s', async (_name, extra) => {
    const response = await client().start(await person(), voice(100, extra));
    expect(response.statusCode).toBe(400);
  });

  it('allows the longest length plus the margin, and no more', async () => {
    const who = await person();
    expect((await client().start(who, voice(100, { duration: 900 }))).statusCode).toBe(200);
    expect((await client().start(who, voice(100, { duration: 902 }))).statusCode).toBe(200);
    const over = await client().start(who, voice(100, { duration: 902.5 }));
    expect(over.statusCode).toBe(400);
    expect(over.json().details.maxSeconds).toBe(900);
  });

  it('refuses a waveform on anything but a voice note', async () => {
    const response = await client().start(await person(), {
      kind: 'audio',
      name: 'a.mp3',
      mime: 'audio/mpeg',
      size: 10,
      waveform: FLAT,
    });
    expect(response.statusCode).toBe(400);
  });

  it('holds voice notes to their own size limit', async () => {
    const response = await client().start(await person(), voice(64 * 1024 * 1024 + 1));
    expect(response.statusCode).toBe(413);
  });

  it('follows a configured limit, which the app can read', async () => {
    const short = await buildTestApp({}, { VOICE_MAX_SECONDS: '60' });
    try {
      const who = await signedIn(short.app, 'short@corremadvisory.com');
      const config = await short.app.inject({
        method: 'GET',
        url: '/v1/config',
        headers: headers(who.cookie),
      });
      expect(appConfigResponseSchema.parse(config.json()).media.voiceMaxSeconds).toBe(60);
      const api = mediaClient(short.app);
      expect((await api.start(who, voice(100, { duration: 62 }))).statusCode).toBe(200);
      expect((await api.start(who, voice(100, { duration: 63 }))).statusCode).toBe(400);
    } finally {
      await short.cleanup();
    }
  });
});

describe('an audio file', () => {
  it.each([
    ['a.mp3', MP3, 'audio/mpeg'],
    ['a.wav', WAV, 'audio/wav'],
    ['a.m4a', mp4('M4A '), 'audio/mp4'],
    ['a.ogg', OGG, 'audio/ogg'],
  ])('%s is served as what its bytes say', async (name, bytes, mime) => {
    const { response } = await client().upload(await person(), 'audio', name, bytes);
    expect(response.statusCode).toBe(200);
    expect(response.json().media).toMatchObject({ kind: 'audio', mime, waveform: null });
  });

  it('refuses a file that is not audio', async () => {
    const { response } = await client().upload(await person(), 'audio', 'a.mp3', PDF);
    expect(response.statusCode).toBe(415);
  });

  it('can be seeked, and is not forced to download', async () => {
    const who = await person();
    const id = await client().ready(who, 'audio', 'a.mp3', MP3);
    const response = await client().content(who, id, { range: 'bytes=0-3' });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-type']).toBe('audio/mpeg');
    expect(response.headers['content-disposition']).toContain('inline');
  });
});

async function sentVoice(from: Person, to: Person) {
  const chat = await getOrCreateDirectChat(app(), from.id, to.id);
  const { uploadId } = await uploadVoice(from);
  const { message } = await sendMessage(app(), {
    userId: from.id,
    chatId: chat.id,
    clientMsgId: uuidv7(),
    mediaId: uploadId,
  });
  return { chatId: chat.id, message };
}

const history = async (who: Person, chatId: string) => {
  const response = await app().inject({
    method: 'GET',
    url: `/v1/chats/${chatId}/messages`,
    headers: headers(who.cookie),
  });
  return messageSchema.array().parse(response.json().items);
};
const playedAs = async (who: Person, chatId: string, id: string) =>
  (await history(who, chatId)).find((message) => message.id === id)?.played;

let listening: string | undefined;
const serverUrl = async () => {
  listening ??= await listen(app());
  return listening;
};

async function setReceipts(who: Person, readReceipts: boolean) {
  const response = await app().inject({
    method: 'PUT',
    url: '/v1/me/privacy',
    headers: headers(who.cookie),
    payload: { lastSeen: 'everyone', profilePhoto: 'everyone', about: 'everyone', readReceipts },
  });
  expect(response.statusCode).toBe(200);
}

describe('a voice note message', () => {
  it('has the kind "voice", and the chat list says how long it is', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    expect(message).toMatchObject({ type: 'voice', played: false });
    const chat = await app().inject({
      method: 'GET',
      url: `/v1/chats/${chatId}`,
      headers: headers(bharat.cookie),
    });
    expect(chat.json().chat.lastMessage).toMatchObject({ type: 'voice', preview: '0:12' });
  });
});

describe('played receipts', () => {
  it('colors the sender’s mic and clears the player’s dot, live and in history', async () => {
    const [asha, bharat] = [await person(), await person()];
    const url = await serverUrl();
    const [ashaSocket, bharatSocket] = [
      await connect(url, asha.cookie),
      await connect(url, bharat.cookie),
    ];
    const ashaHears = record(ashaSocket, 'message:played');
    const bharatHears = record(bharatSocket, 'message:played');
    const { chatId, message } = await sentVoice(asha, bharat);
    expect(await playedAs(asha, chatId, message.id)).toBe(false);
    expect(await playedAs(bharat, chatId, message.id)).toBe(false);

    const ack = await bharatSocket.emitWithAck('voice:played', { chatId, messageId: message.id });
    expect(ack).toMatchObject({ ok: true, data: { played: true } });

    await waitUntil(() => expect(ashaHears).toHaveLength(1));
    await waitUntil(() => expect(bharatHears).toHaveLength(1));
    expect(ashaHears[0]?.message.played).toBe(true);
    expect(bharatHears[0]?.message.played).toBe(true);
    expect(await playedAs(asha, chatId, message.id)).toBe(true);
    expect(await playedAs(bharat, chatId, message.id)).toBe(true);
  });

  it('reaches a device that was away, through sync', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    const before = await app().inject({
      method: 'GET',
      url: '/v1/sync',
      headers: headers(asha.cookie),
    });
    await markPlayed(app(), bharat.id, chatId, message.id);
    const after = await app().inject({
      method: 'GET',
      url: `/v1/sync?since=${before.json().cursor}`,
      headers: headers(asha.cookie),
    });
    expect(after.json().messages).toHaveLength(1);
    expect(after.json().messages[0]).toMatchObject({ id: message.id, played: true });
  });

  it('counts once, and playing again changes nothing', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    await markPlayed(app(), bharat.id, chatId, message.id);
    await markPlayed(app(), bharat.id, chatId, message.id);
    await Promise.all([
      markPlayed(app(), bharat.id, chatId, message.id),
      markPlayed(app(), bharat.id, chatId, message.id),
    ]);
    const doc = await chatModels(app()).Message.findById(message.id).lean();
    expect(doc?.plays).toHaveLength(1);
  });

  it('does not count the sender playing their own note', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    const answer = await markPlayed(app(), asha.id, chatId, message.id);
    expect(answer.played).toBe(false);
    expect(await playedAs(asha, chatId, message.id)).toBe(false);
  });

  it.each([
    ['the player', (a: Person, _b: Person) => a],
    ['the sender', (_a: Person, b: Person) => b],
  ])('stays hidden from the sender when %s has receipts off', async (_who, pick) => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    await setReceipts(pick(bharat, asha), false);
    await markPlayed(app(), bharat.id, chatId, message.id);
    expect(await playedAs(asha, chatId, message.id)).toBe(false);
    // The player still knows they played it.
    expect(await playedAs(bharat, chatId, message.id)).toBe(true);
  });

  it('with receipts off, tells the sender nothing live', async () => {
    const [asha, bharat] = [await person(), await person()];
    const url = await serverUrl();
    const ashaSocket = await connect(url, asha.cookie);
    const hears = record(ashaSocket, 'message:played');
    const { chatId, message } = await sentVoice(asha, bharat);
    await setReceipts(bharat, false);
    await markPlayed(app(), bharat.id, chatId, message.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(hears).toHaveLength(0);
  });

  it('keeps a play hidden after receipts come back on: it was private when it happened', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    await setReceipts(bharat, false);
    await markPlayed(app(), bharat.id, chatId, message.id);
    await setReceipts(bharat, true);
    expect(await playedAs(asha, chatId, message.id)).toBe(false);
  });

  it('never goes back: turning receipts off leaves a shown play shown', async () => {
    const [asha, bharat] = [await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    await markPlayed(app(), bharat.id, chatId, message.id);
    await setReceipts(bharat, false);
    expect(await playedAs(asha, chatId, message.id)).toBe(true);
  });

  it('is refused for someone outside the chat, who cannot tell it exists', async () => {
    const [asha, bharat, stranger] = [await person(), await person(), await person()];
    const { chatId, message } = await sentVoice(asha, bharat);
    await expect(markPlayed(app(), stranger.id, chatId, message.id)).rejects.toThrow();
    expect((await chatModels(app()).Message.findById(message.id).lean())?.plays).toBeUndefined();
  });

  it('is refused for a message that is not a voice note, or from another chat', async () => {
    const [asha, bharat, carol] = [await person(), await person(), await person()];
    const { chatId } = await sentVoice(asha, bharat);
    const { message: text } = await sendMessage(app(), {
      userId: asha.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'hello',
    });
    await expect(markPlayed(app(), bharat.id, chatId, text.id)).rejects.toThrow('Voice note');
    const other = await sentVoice(asha, carol);
    await expect(markPlayed(app(), bharat.id, chatId, other.message.id)).rejects.toThrow();
  });

  it('is refused over the socket with bad input, without a session', async () => {
    const [asha] = [await person()];
    const url = await serverUrl();
    const socket = await connect(url, asha.cookie);
    const ack = await socket.emitWithAck('voice:played', { chatId: 'x', messageId: 'y' } as never);
    expect(ack.ok).toBe(false);
  });

  it('uses indexes', async () => {
    const { Message } = chatModels(app());
    await expectIndexedQuery(Message.findOne({ _id: oid(uuidHex()), chatId: oid(uuidHex()) }));
  });
});

const uuidHex = () => 'a'.repeat(24);
