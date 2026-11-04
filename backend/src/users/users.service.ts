import {
  type PrivacySettings,
  type PublicProfile,
  USERNAME_CHANGE_INTERVAL_DAYS,
  type UsernameAvailability,
  usernameBaseFromEmail,
  usernameProblem,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { AppError } from '../lib/errors.ts';
import {
  buildSearchTerms,
  escapeRegex,
  loadUser,
  privacyOf,
  toPublicProfile,
  type UserDoc,
  usersModel,
} from './user-record.ts';

const DAY_MS = 86_400_000;
const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

/** Uses the partial unique index (CLAUDE.md §8: queries must include $type). */
/** Matches the partial unique index (`username` stored as a string). */
const usernameFilter = (username: string) => ({
  username: { $eq: username, $type: 'string' as const },
});

export async function requireUser(app: FastifyInstance, id: string): Promise<UserDoc> {
  const user = Types.ObjectId.isValid(id) ? await loadUser(app, id) : null;
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');
  return user;
}

export async function usernameAvailability(
  app: FastifyInstance,
  username: string,
  userId: string,
): Promise<UsernameAvailability> {
  const problem = usernameProblem(username);
  if (problem) return { username, available: false, reason: problem };
  const owner = (await usersModel(app)
    .findOne(usernameFilter(username), { _id: 1 })
    .lean()) as Pick<UserDoc, '_id'> | null;
  const taken = owner !== null && owner._id.toString() !== userId;
  return { username, available: !taken, reason: taken ? 'taken' : null };
}

/** A free username from the email: "akhilesh", else "akhilesh2", "akhilesh3", … */
export async function suggestUsername(app: FastifyInstance, email: string): Promise<string> {
  const base = usernameBaseFromEmail(email);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}${n}`;
    if (usernameProblem(candidate)) continue;
    if (!(await usersModel(app).exists(usernameFilter(candidate)))) return candidate;
  }
  return `${base}${Date.now().toString().slice(-6)}`;
}

/** Sets the username. The first one is free; later changes at most once every 30 days. */
export async function setUsername(
  app: FastifyInstance,
  userId: string,
  username: string,
): Promise<UserDoc> {
  const user = await requireUser(app, userId);
  if (user.username === username) return user;
  if (user.username && user.usernameChangedAt) {
    const nextChangeAt = new Date(
      new Date(user.usernameChangedAt).getTime() + USERNAME_CHANGE_INTERVAL_DAYS * DAY_MS,
    );
    if (Date.now() < nextChangeAt.getTime()) {
      throw new AppError(
        'USERNAME_CHANGE_TOO_SOON',
        `You can change your username again on ${nextChangeAt.toDateString()}.`,
        {
          nextChangeAt: nextChangeAt.toISOString(),
        },
      );
    }
  }
  try {
    const updated = (await usersModel(app)
      .findByIdAndUpdate(
        userId,
        {
          $set: {
            username,
            usernameChangedAt: new Date(),
            searchTerms: buildSearchTerms(user.displayName, username),
          },
        },
        { returnDocument: 'after' },
      )
      .lean()) as UserDoc | null;
    if (!updated) throw new AppError('NOT_FOUND', 'User not found.');
    return updated;
  } catch (error) {
    // The unique index decides races: two people claiming the same name at once.
    if (isDuplicateKey(error))
      throw new AppError('USERNAME_TAKEN', 'That username is already taken.');
    throw error;
  }
}

export async function updateProfile(
  app: FastifyInstance,
  userId: string,
  changes: { displayName?: string | undefined; about?: string | undefined },
): Promise<UserDoc> {
  const user = await requireUser(app, userId);
  const displayName = changes.displayName ?? user.displayName ?? null;
  const set: Record<string, unknown> = {
    searchTerms: buildSearchTerms(displayName, user.username),
  };
  if (changes.displayName !== undefined) Object.assign(set, { displayName, name: displayName });
  if (changes.about !== undefined) set.about = changes.about;
  return (await usersModel(app)
    .findByIdAndUpdate(userId, { $set: set }, { returnDocument: 'after' })
    .lean()) as UserDoc;
}

export async function updatePrivacy(
  app: FastifyInstance,
  userId: string,
  privacy: PrivacySettings,
) {
  await usersModel(app).updateOne({ _id: userId }, { $set: { privacy } });
  return privacy;
}

export async function getPrivacy(app: FastifyInstance, userId: string): Promise<PrivacySettings> {
  return privacyOf(await requireUser(app, userId));
}

interface SearchInput {
  viewerId: string;
  q: string;
  cursor?: string | undefined;
  limit: number;
}

/**
 * People search over active users, excluding the caller:
 * - empty → suggested (recently active), one page
 * - contains "@" → exact email
 * - otherwise every word must prefix-match a search term (name words or username)
 */
export async function searchUsers(app: FastifyInstance, input: SearchInput) {
  const { viewerId, limit } = input;
  const q = input.q.trim().toLocaleLowerCase();
  const Users = usersModel(app);
  const base = { status: { $ne: 'deactivated' }, _id: { $ne: new Types.ObjectId(viewerId) } };
  const page = (docs: UserDoc[], nextCursor: string | null) => ({
    items: docs.map((doc): PublicProfile => toPublicProfile(doc, viewerId)),
    nextCursor,
  });

  if (!q) {
    const docs = (await Users.find({ ...base, status: 'active' })
      .sort({ lastLoginAt: -1 })
      .limit(limit)
      .lean()) as UserDoc[];
    return page(docs, null);
  }
  if (q.includes('@')) {
    const doc = (await Users.findOne({ ...base, email: q }).lean()) as UserDoc | null;
    return page(doc ? [doc] : [], null);
  }

  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  const filter: Record<string, unknown> = {
    ...base,
    searchTerms: { $all: words.map((word) => new RegExp(`^${escapeRegex(word)}`)) },
  };
  if (input.cursor && Types.ObjectId.isValid(input.cursor)) {
    filter._id = { $ne: new Types.ObjectId(viewerId), $gt: new Types.ObjectId(input.cursor) };
  }
  const docs = (await Users.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean()) as UserDoc[];
  const more = docs.length > limit;
  const items = docs.slice(0, limit);
  return page(items, more ? (items.at(-1)?._id.toString() ?? null) : null);
}
