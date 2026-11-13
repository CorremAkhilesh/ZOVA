import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../test/expect-indexed-query.ts';
import { connectTestDb } from '../../test/helpers.ts';
import { registerAuthModels } from './auth-models.ts';

let db: Awaited<ReturnType<typeof connectTestDb>>;
let models: ReturnType<typeof registerAuthModels>;

beforeEach(async () => {
  db = await connectTestDb();
  models = registerAuthModels(db.connection);
});
afterEach(() => db.cleanup());

describe('Better Auth queries are index-backed', () => {
  const userId = new Types.ObjectId();

  it('user by email (sign-in)', async () => {
    await expectIndexedQuery(models.AuthUser.findOne({ email: 'a@corremadvisory.com' }));
  });

  it('user by username', async () => {
    await expectIndexedQuery(
      models.AuthUser.findOne({ username: { $eq: 'asha', $type: 'string' } }),
    );
  });

  it('session by token (every authenticated request)', async () => {
    await expectIndexedQuery(models.AuthSession.findOne({ token: 'abc' }));
  });

  it("a user's sessions, newest first", async () => {
    await expectIndexedQuery(models.AuthSession.find({ userId }).sort({ expiresAt: -1 }));
  });

  it('verification by identifier (OTP lookup without Redis)', async () => {
    await expectIndexedQuery(models.AuthVerification.findOne({ identifier: 'sign-in-otp-a@x' }));
  });

  it('accounts by user and by provider account', async () => {
    await expectIndexedQuery(models.AuthAccount.find({ userId }));
    await expectIndexedQuery(
      models.AuthAccount.findOne({ providerId: 'credential', accountId: 'x' }),
    );
  });
});

describe('index options', () => {
  it('declares unique, partial and TTL indexes', async () => {
    for (const model of Object.values(models)) await model.init();
    const userIndexes = await models.AuthUser.collection.indexes();
    expect(userIndexes.find((i) => i.name === 'email_1')).toMatchObject({ unique: true });
    expect(userIndexes.find((i) => i.name === 'username_1')).toMatchObject({
      unique: true,
      partialFilterExpression: { username: { $type: 'string' } },
    });
    const sessionIndexes = await models.AuthSession.collection.indexes();
    expect(sessionIndexes.find((i) => i.name === 'expiresAt_1')).toMatchObject({
      expireAfterSeconds: 0,
    });
    const verificationIndexes = await models.AuthVerification.collection.indexes();
    expect(verificationIndexes.find((i) => i.name === 'expiresAt_1')).toMatchObject({
      expireAfterSeconds: 0,
    });
  });

  it('lets many users have no username but keeps usernames unique', async () => {
    await models.AuthUser.init();
    await models.AuthUser.create([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    await models.AuthUser.create({ email: 'c@x.com', username: 'asha' });
    await expect(models.AuthUser.create({ email: 'd@x.com', username: 'asha' })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it('registers each model only once per connection', () => {
    expect(registerAuthModels(db.connection).AuthUser).toBe(models.AuthUser);
  });
});
