import { randomUUID } from 'node:crypto';
import { brand } from '@zuvo/config';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type Actor, audit } from '../admin/admin.service.ts';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { sendMessage } from '../chats/messages.service.ts';
import { languageOf, type UserDoc, usersModel } from '../users/user-record.ts';

/** The reminder, in the person's language: install the app and turn notifications on. */
export function reminderText(language: 'en' | 'hi', appUrl: string): string {
  const name = brand.name;
  if (language === 'hi') {
    return [
      `नमस्ते! कृपया ${name} इंस्टॉल करें और नोटिफ़िकेशन चालू करें, ताकि कोई मैसेज छूटे नहीं।`,
      '',
      `1. ${appUrl} खोलें: Android और लैपटॉप पर Chrome या Edge में, iPhone पर Safari में।`,
      `2. इंस्टॉल करें: Chrome/Edge मेनू → "ऐप इंस्टॉल करें"। iPhone: शेयर → "होम स्क्रीन में जोड़ें", फिर उसी आइकन से खोलें।`,
      '3. पूछे जाने पर नोटिफ़िकेशन की अनुमति दें (या सेटिंग्स → नोटिफ़िकेशन → चालू करें)।',
      '4. जाँचने के लिए "टेस्ट नोटिफ़िकेशन भेजें" दबाएँ।',
    ].join('\n');
  }
  return [
    `Hi! Please install ${name} and turn on notifications, so you never miss a message.`,
    '',
    `1. Open ${appUrl}: in Chrome or Edge on Android and laptops, in Safari on iPhone.`,
    '2. Install it: Chrome/Edge menu → "Install app". iPhone: Share → "Add to Home Screen", then open it from that icon.',
    '3. Allow notifications when asked (or Settings → Notifications → Turn on).',
    '4. Tap "Send test notification" to check.',
  ].join('\n');
}

/**
 * Sends the reminder from the admin to each active person chosen (not the admin), in a 1:1 chat,
 * and audits each. Returns how many were sent.
 */
export async function remindUsers(
  app: FastifyInstance,
  actor: Actor,
  userIds: string[],
): Promise<number> {
  const wanted = [...new Set(userIds)].filter(
    (id) => id !== actor.id && Types.ObjectId.isValid(id),
  );
  const users = (await usersModel(app)
    .find({ _id: { $in: wanted.map((id) => new Types.ObjectId(id)) } })
    .lean()) as UserDoc[];
  let sent = 0;
  for (const user of users) {
    if (user.status === 'deactivated') continue;
    const chat = await getOrCreateDirectChat(app, actor.id, user._id.toString());
    await sendMessage(app, {
      userId: actor.id,
      chatId: chat.id,
      clientMsgId: randomUUID(),
      text: reminderText(languageOf(user), app.env.APP_URL.replace(/\/$/, '')),
    });
    await audit(app, actor, 'notifications.remind', user);
    sent += 1;
  }
  return sent;
}
