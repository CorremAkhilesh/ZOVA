import { chatResponseSchema, scheduledResponseSchema } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { groupClient, texts } from '../../test/group-helpers.ts';
import { buildTestApp } from '../../test/helpers.ts';
import { waitUntil } from '../../test/realtime-helpers.ts';
import { buildApp } from '../app.ts';
import { oid } from './chats.service.ts';
import { scheduledModels } from './scheduled.service.ts';

describe('a restart', () => {
  it('loses nothing: the next start sends what fell due while the API was down', async () => {
    const first = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
    let current = first.app;
    const { person, call, history } = groupClient(() => current);
    const [asha, bharat] = [await person(), await person()];
    const chatId = chatResponseSchema.parse(
      (await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id })).json(),
    ).chat.id;
    const sendAt = new Date(Date.now() + 60_000).toISOString();
    const response = await call(asha, 'POST', '/v1/me/scheduled', {
      chatId,
      sendAt,
      text: 'sent while you slept',
    });
    const { id } = scheduledResponseSchema.parse(response.json()).item;
    // The API stops; meanwhile the time comes.
    await first.app.close();
    const second = await buildApp(first.env, { redis: null });
    try {
      await scheduledModels(second).Scheduled.updateOne(
        { _id: oid(id) },
        { $set: { sendAt: new Date(Date.now() - 1000) } },
      );
      current = second;
      await second.ready();
      await waitUntil(async () => {
        const doc = await scheduledModels(second).Scheduled.findById(id).lean();
        expect(doc?.status).toBe('sent');
      }, 90_000);
      expect(texts(await history(bharat, chatId))).toEqual(['sent while you slept']);
    } finally {
      await second.mongo.dropDatabase();
      await second.close();
    }
    // Two app starts and a sign-in flow: slow on a busy machine.
  }, 300_000);
});
