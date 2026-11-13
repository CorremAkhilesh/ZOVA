import { brand } from '@zuvo/config';
import {
  type AppLanguage,
  type ChatSettings,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_PRIVACY,
  type MyProfile,
  type PrivacySettings,
  type PublicProfile,
  type SessionUser,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Model, Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';

/** A user document in Better Auth's `user` collection, with our profile fields. */
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  displayName?: string | null;
  username?: string | null;
  usernameChangedAt?: Date | null;
  about?: string | null;
  avatar?: { small: string; large: string; version: string } | null;
  privacy?: Partial<PrivacySettings> | null;
  chatSettings?: Partial<ChatSettings> | null;
  language?: string | null;
  searchTerms?: string[];
  role?: string | null;
  status?: string | null;
  lastLoginAt?: Date | null;
  /** When the last socket went away. Only ever shown through the presence privacy rules. */
  lastSeenAt?: Date | null;
  createdAt: Date;
}

/** Better Auth's `user` collection, typed with our profile fields. */
export const usersModel = (app: FastifyInstance) =>
  registerAuthModels(app.mongo).AuthUser as unknown as Model<UserDoc>;

export async function loadUser(app: FastifyInstance, id: string): Promise<UserDoc | null> {
  return (await usersModel(app).findById(id).lean()) as UserDoc | null;
}

export function privacyOf(user: UserDoc): PrivacySettings {
  return { ...DEFAULT_PRIVACY, ...(user.privacy ?? {}) };
}

export function chatSettingsOf(user: Pick<UserDoc, 'chatSettings'>): ChatSettings {
  return { ...DEFAULT_CHAT_SETTINGS, ...(user.chatSettings ?? {}) };
}

export function avatarUrls(user: UserDoc): { small: string; large: string } | null {
  if (!user.avatar?.version) return null;
  const base = `/v1/users/${user._id.toString()}/avatar`;
  return {
    small: `${base}?size=small&v=${user.avatar.version}`,
    large: `${base}?size=large&v=${user.avatar.version}`,
  };
}

/** The saved app language; anything else (or nothing yet) is English. */
export const languageOf = (user: Pick<UserDoc, 'language'> | null | undefined): AppLanguage =>
  user?.language === 'hi' ? 'hi' : 'en';

const isAdmin = (user: UserDoc) => user.role === 'admin';
const isDeactivated = (user: UserDoc) => user.status === 'deactivated';

export function toSessionUser(user: UserDoc): SessionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName ?? null,
    username: user.username ?? null,
    about: user.about ?? brand.defaultAbout,
    avatar: avatarUrls(user),
    role: isAdmin(user) ? 'admin' : 'user',
    status: isDeactivated(user) ? 'deactivated' : 'active',
    language: languageOf(user),
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function toMyProfile(user: UserDoc): MyProfile {
  const session = toSessionUser(user);
  return {
    id: session.id,
    email: session.email,
    displayName: session.displayName,
    username: session.username,
    usernameChangedAt: user.usernameChangedAt
      ? new Date(user.usernameChangedAt).toISOString()
      : null,
    about: session.about,
    avatar: session.avatar,
    role: session.role,
    status: session.status,
    language: session.language,
  };
}

/**
 * What `viewerId` may see of `user`. The owner always sees everything. Someone `user` blocked
 * (`blockedViewer`) sees neither their photo nor their about, whatever their privacy says.
 */
export function toPublicProfile(
  user: UserDoc,
  viewerId: string,
  options: { blockedViewer?: boolean } = {},
): PublicProfile {
  const id = user._id.toString();
  if (isDeactivated(user)) {
    return {
      id,
      displayName: 'Deactivated account',
      username: null,
      about: null,
      avatar: null,
      deactivated: true,
    };
  }
  const self = id === viewerId;
  const privacy = privacyOf(user);
  const shows = (setting: 'everyone' | 'nobody') =>
    self || (setting === 'everyone' && !options.blockedViewer);
  return {
    id,
    displayName: user.displayName ?? user.email.split('@')[0] ?? 'User',
    username: user.username ?? null,
    about: shows(privacy.about) ? (user.about ?? brand.defaultAbout) : null,
    avatar: shows(privacy.profilePhoto) ? avatarUrls(user) : null,
    deactivated: false,
  };
}

/** Lowercase words of the display name and the username (and its parts) for prefix search. */
export function buildSearchTerms(
  displayName: string | null | undefined,
  username: string | null | undefined,
) {
  const words = (displayName ?? '')
    .toLocaleLowerCase()
    .split(/[\s._-]+/u)
    .filter(Boolean);
  const handle = username ? [username, ...username.split(/[._]+/).filter(Boolean)] : [];
  return [...new Set([...words, ...handle])];
}

/** Escapes a user-typed string for use inside a RegExp. */
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
