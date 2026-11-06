import { chatResponseSchema, groupMembersResponseSchema, messageSchema } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { sendMessage } from '../src/chats/messages.service.ts';
import { headers } from './auth-helpers.ts';
import { signedIn, uuidv7 } from './realtime-helpers.ts';

let people = 0;

/** The group API as a client uses it. */
export function groupClient(app: () => FastifyInstance) {
  const person = () => {
    people += 1;
    return signedIn(app(), `group${people}@corremadvisory.com`);
  };
  type Person = Awaited<ReturnType<typeof person>>;
  const call = (
    who: Person | null,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    app().inject({
      method,
      url,
      headers: headers(who?.cookie),
      ...(payload ? { payload } : {}),
    });

  /** A group owned by the first person, with the others as members. */
  async function group(owner: Person, others: Person[] = [], name = 'Team') {
    const response = await call(owner, 'POST', '/v1/groups', {
      name,
      memberIds: others.map((other) => other.id),
    });
    expect(response.statusCode).toBe(200);
    return chatResponseSchema.parse(response.json()).chat.id;
  }

  const say = (who: Person, chatId: string, text: string) =>
    sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), text });

  async function history(who: Person, chatId: string) {
    const response = await call(who, 'GET', `/v1/chats/${chatId}/messages`);
    expect(response.statusCode).toBe(200);
    return messageSchema.array().parse(response.json().items);
  }

  async function members(who: Person, chatId: string) {
    const response = await call(who, 'GET', `/v1/chats/${chatId}/members`);
    expect(response.statusCode).toBe(200);
    return groupMembersResponseSchema.parse(response.json()).members;
  }

  const summary = async (who: Person, chatId: string) => {
    const response = await call(who, 'GET', `/v1/chats/${chatId}`);
    expect(response.statusCode).toBe(200);
    return chatResponseSchema.parse(response.json()).chat;
  };

  const setRole = (who: Person, chatId: string, target: Person, role: 'admin' | 'member') =>
    call(who, 'PUT', `/v1/chats/${chatId}/members/${target.id}/role`, { role });

  const setReceipts = (who: Person, readReceipts: boolean) =>
    call(who, 'PUT', '/v1/me/privacy', {
      lastSeen: 'everyone',
      profilePhoto: 'everyone',
      about: 'everyone',
      readReceipts,
    });

  return { person, call, group, say, history, members, summary, setRole, setReceipts };
}

export const texts = (messages: Array<{ text: string | null }>) =>
  messages.flatMap((message) => (message.text ? [message.text] : []));
export const systemKinds = (messages: Array<{ system?: { kind: string } | null | undefined }>) =>
  messages.flatMap((message) => (message.system ? [message.system.kind] : []));
