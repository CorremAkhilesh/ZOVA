import type { PushClientReport } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';

/** What a device last said about itself, kept on its session (gone when the session goes). */
export interface StoredPushClient extends PushClientReport {
  at: Date;
}

/** This device's permission, installed or not, push on or off. Updated by _id. */
export async function reportPushClient(
  app: FastifyInstance,
  sessionId: string,
  report: PushClientReport,
): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) return;
  const pushClient: StoredPushClient = { ...report, at: new Date() };
  await registerAuthModels(app.mongo).AuthSession.updateOne(
    { _id: new Types.ObjectId(sessionId) },
    { $set: { pushClient } },
    { strict: false },
  );
}
