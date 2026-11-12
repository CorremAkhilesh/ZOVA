import type { DisappearTimer } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { privacyOf, type UserDoc, usersModel } from '../users/user-record.ts';

/** The timer a chat this person starts begins with: their privacy setting "Default message timer". */
export async function defaultTimerOf(
  app: FastifyInstance,
  userId: string,
): Promise<DisappearTimer> {
  const user = (await usersModel(app)
    .findById(userId)
    .select({ privacy: 1 })
    .lean()) as UserDoc | null;
  return user ? privacyOf(user).defaultDisappearing : 'off';
}

/** For a new chat document: nothing when off, which is what an absent timer means. */
export const timerFields = (timer: DisappearTimer): { disappearing?: DisappearTimer } =>
  timer === 'off' ? {} : { disappearing: timer };
