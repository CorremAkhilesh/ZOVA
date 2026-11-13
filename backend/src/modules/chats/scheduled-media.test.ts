import {
  chatResponseSchema,
  messageSchema,
  scheduledResponseSchema,
  uploadStateSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF, png } from '../../../test/media-helpers.ts';
import { closeAllSockets } from '../../../test/realtime-helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, history } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

const WEBM = Buffer.concat([
  Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810442858102', 'hex'),
  Buffer.alloc(512, 1),
]);
const FLAT = Array.from({ length: 64 }, () => 50);

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const schedule = (who: Person, body: Record<string, unknown>) =>
  call(who, 'POST', '/v1/me/scheduled', { sendAt: inAnHour(), ...body });
const sendNow = async (who: Person, id: string) =>
  scheduledResponseSchema.parse((await call(who, 'POST', `/v1/me/scheduled/${id}/send-now`)).json())
    .item;

async function voiceNote(who: Person) {
  const media = mediaClient(app());
  const started = await media.start(who, {
    kind: 'voice',
    name: 'voice.webm',
    mime: 'audio/webm',
    size: WEBM.length,
    duration: 12.4,
    waveform: FLAT,
  });
  const { uploadId } = uploadStateSchema.parse(started.json());
  await media.chunk(who, uploadId, 0, WEBM);
  expect((await media.complete(who, uploadId)).statusCode).toBe(200);
  return uploadId;
}

describe('scheduling media and voice notes', () => {
  it('a voice note goes later as a voice note, with its length and waveform', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const mediaId = await voiceNote(asha);
    const response = await schedule(asha, { chatId, mediaId });
    expect(response.statusCode).toBe(200);
    const item = scheduledResponseSchema.parse(response.json()).item;
    expect(item).toMatchObject({ text: null, media: { kind: 'voice', duration: 12.4 } });
    expect((await sendNow(asha, item.id)).status).toBe('sent');
    const [message] = messageSchema.array().parse(await history(bharat, chatId));
    expect(message).toMatchObject({ type: 'voice', media: { duration: 12.4, waveform: FLAT } });
  });

  it('a photo goes later with its caption', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const mediaId = await mediaClient(app()).ready(asha, 'image', 'view.png', await png());
    const item = scheduledResponseSchema.parse(
      (await schedule(asha, { chatId, mediaId, text: 'the view' })).json(),
    ).item;
    expect((await sendNow(asha, item.id)).status).toBe('sent');
    const [message] = messageSchema.array().parse(await history(bharat, chatId));
    expect(message).toMatchObject({ type: 'image', text: 'the view' });
  });

  it('refuses an upload that is not finished, or already sent in a message', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const media = mediaClient(app());
    const started = await media.start(asha, {
      kind: 'document',
      name: 'half.pdf',
      mime: 'application/pdf',
      size: PDF.length,
    });
    const { uploadId } = uploadStateSchema.parse(started.json());
    const unfinished = await schedule(asha, { chatId, mediaId: uploadId });
    expect(unfinished.statusCode).toBe(409);
    expect(unfinished.json().code).toBe('MEDIA_NOT_ATTACHABLE');

    const used = await media.ready(asha, 'document', 'used.pdf', PDF);
    const first = scheduledResponseSchema.parse(
      (await schedule(asha, { chatId, mediaId: used })).json(),
    ).item;
    await sendNow(asha, first.id);
    expect((await schedule(asha, { chatId, mediaId: used })).statusCode).toBe(409);
  });
});
