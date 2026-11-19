import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF, png } from '../../../test/media-helpers.ts';
import { closeAllSockets, connect, listen, uuidv7 } from '../../../test/realtime-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { deleteForEveryone } from '../../chats/message-actions.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { cleanupDeletedMedia } from '../../media/media-access.ts';

// "Share to Zuvo": one upload, several chats. The first chat's message attaches the file; the
// others send it by reference (`sharedMediaId`), so the server holds one upload, one file.

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, call } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let asha: Person;
let bharat: Person;
let chitra: Person;
let toBharat = '';
let toChitra = '';

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
  [asha, bharat, chitra] = [await person(), await person(), await person()];
  const direct = async (other: Person) =>
    (await call(asha, 'POST', '/v1/chats/direct', { userId: other.id })).json().chat.id as string;
  toBharat = await direct(bharat);
  toChitra = await direct(chitra);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const send = async (who: Person, payload: Record<string, unknown>) => {
  const socket = await connect(url, who.cookie);
  return socket
    .timeout(30_000)
    .emitWithAck('message:send', { clientMsgId: uuidv7(), ...payload } as never);
};

describe('one file to several chats', () => {
  it('two files to two chats: two uploads, and both people get both files', async () => {
    const media = mediaClient(app());
    const files = [
      await media.ready(asha, 'document', 'budget.pdf', PDF),
      await media.ready(asha, 'document', 'notes.pdf', PDF),
    ];
    for (const mediaId of files) {
      expect((await send(asha, { chatId: toBharat, mediaIds: [mediaId] })).ok).toBe(true);
      const shared = await send(asha, { chatId: toChitra, sharedMediaId: mediaId, caption: 'fyi' });
      expect(shared.ok, JSON.stringify(shared)).toBe(true);
    }
    const { Media } = chatModels(app());
    expect(await Media.countDocuments({ ownerId: asha.id })).toBe(2);
    for (const [who, chatId] of [
      [bharat, toBharat],
      [chitra, toChitra],
    ] as const) {
      const items = (await call(who, 'GET', `/v1/chats/${chatId}/messages`)).json().items as Array<{
        media: { id: string; name: string } | null;
      }>;
      expect(items.map((item) => item.media?.id).filter(Boolean)).toEqual(files);
      // Each can open the file: the access check follows any message that uses it.
      const link = await call(who, 'GET', `/v1/media/${files[0]}/link`);
      expect(link.statusCode).toBe(200);
    }
  });

  it('never someone else’s file, nor a view-once one', async () => {
    const media = mediaClient(app());
    const bharatsFile = await media.ready(bharat, 'document', 'his.pdf', PDF);
    const refused = await send(asha, { chatId: toChitra, sharedMediaId: bharatsFile });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('MEDIA_NOT_ATTACHABLE');
    const once = await media.ready(asha, 'image', 'once.png', await png());
    expect((await send(asha, { chatId: toBharat, mediaIds: [once], viewOnce: true })).ok).toBe(
      true,
    );
    const again = await send(asha, { chatId: toChitra, sharedMediaId: once });
    expect(again.ok).toBe(false);
  });

  it('deleting one chat’s copy for everyone keeps the file for the other chat', async () => {
    const media = mediaClient(app());
    const mediaId = await media.ready(asha, 'document', 'keep.pdf', PDF);
    const first = await sendMessage(app(), {
      userId: asha.id,
      chatId: toBharat,
      clientMsgId: uuidv7(),
      mediaId,
    });
    const shared = await send(asha, { chatId: toChitra, sharedMediaId: mediaId });
    expect(shared.ok).toBe(true);
    await deleteForEveryone(app(), asha.id, toBharat, first.message.id);
    await cleanupDeletedMedia(app(), 200, new Date(Date.now() + 86_400_000));
    expect((await call(chitra, 'GET', `/v1/media/${mediaId}/link`)).statusCode).toBe(200);
  });
});
