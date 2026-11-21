import { afterAll, beforeAll, describe, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerAuthModels } from '../db/auth-models.ts';
import { registerSecurityModels } from '../db/security-models.ts';
import { registerSecurityEventModels } from '../security/security-events.ts';
import { auditFilterOf } from './audit-log.ts';

// Admin → Security and the audit log's filters read through indexes (CLAUDE.md §8).

let db: Awaited<ReturnType<typeof connectTestDb>>;
beforeAll(async () => {
  db = await connectTestDb();
});
afterAll(async () => {
  await db.cleanup();
});

describe('security indexes', () => {
  it('signed-in sessions, locks, wrong codes', async () => {
    const live = { expiresAt: { $gt: new Date() } };
    await expectIndexedQuery(registerAuthModels(db.connection).AuthSession.find(live));
    const { SecurityEvent } = registerSecurityEventModels(db.connection);
    await expectIndexedQuery(
      SecurityEvent.find({ kind: 'otp_locked', until: { $gt: new Date() }, unlockedAt: null }).sort(
        {
          until: -1,
        },
      ),
    );
    await expectIndexedQuery(SecurityEvent.find({ kind: 'otp_failed' }).sort({ at: -1 }));
    await expectIndexedQuery(
      SecurityEvent.find({ kind: 'otp_locked', email: 'a@x.com', until: { $gt: new Date() } }),
    );
  });

  it('every audit log filter, newest first', async () => {
    const { AuditLog } = registerSecurityModels(db.connection);
    const now = new Date().toISOString();
    for (const filter of [
      {},
      { action: 'user.suspend' as const },
      { actor: 'admin@corremadvisory.com' },
      { target: 'asha@corremadvisory.com' },
      { from: now },
      { action: 'settings.change' as const, from: now, to: now },
    ]) {
      await expectIndexedQuery(AuditLog.find(auditFilterOf(filter)).sort({ at: -1, _id: -1 }));
    }
  });
});
