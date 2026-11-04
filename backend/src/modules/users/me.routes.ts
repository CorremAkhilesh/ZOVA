import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AVATAR_MAX_BYTES,
  myProfileResponseSchema,
  privacyResponseSchema,
  privacySettingsSchema,
  setUsernameBodySchema,
  updateProfileBodySchema,
  usernameSuggestionResponseSchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { AppError } from '../../lib/errors.ts';
import { processAvatar } from '../../users/avatar.ts';
import { toMyProfile, type UserDoc, usersModel } from '../../users/user-record.ts';
import {
  getPrivacy,
  requireUser,
  setUsername,
  suggestUsername,
  updatePrivacy,
  updateProfile,
} from '../../users/users.service.ts';

/** The signed-in user's own profile, username, privacy and photo. */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  // onRequest: authentication is decided before any body is parsed or validated (401 before 400).
  app.addHook('onRequest', requireSession);
  const profile = (user: UserDoc) => ({ profile: toMyProfile(user) });

  app.get(
    '/me/profile',
    { schema: { tags: ['profile'], response: { 200: myProfileResponseSchema } } },
    async (request) => profile(await requireUser(app, currentUserId(request))),
  );

  app.patch(
    '/me/profile',
    {
      schema: {
        tags: ['profile'],
        summary: 'Update display name and/or about',
        body: updateProfileBodySchema,
        response: { 200: myProfileResponseSchema },
      },
    },
    async (request) => profile(await updateProfile(app, currentUserId(request), request.body)),
  );

  app.put(
    '/me/username',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['profile'],
        summary: 'Set the username (changes allowed once every 30 days)',
        body: setUsernameBodySchema,
        response: { 200: myProfileResponseSchema },
      },
    },
    async (request) =>
      profile(await setUsername(app, currentUserId(request), request.body.username)),
  );

  app.get(
    '/me/username-suggestion',
    { schema: { tags: ['profile'], response: { 200: usernameSuggestionResponseSchema } } },
    async (request) => {
      const user = await requireUser(app, currentUserId(request));
      return { username: user.username ?? (await suggestUsername(app, user.email)) };
    },
  );

  app.get(
    '/me/privacy',
    { schema: { tags: ['privacy'], response: { 200: privacyResponseSchema } } },
    async (request) => ({
      privacy: await getPrivacy(app, currentUserId(request)),
    }),
  );

  app.put(
    '/me/privacy',
    {
      schema: {
        tags: ['privacy'],
        body: privacySettingsSchema,
        response: { 200: privacyResponseSchema },
      },
    },
    async (request) => ({
      privacy: await updatePrivacy(app, currentUserId(request), request.body),
    }),
  );

  app.post(
    '/me/avatar',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['profile'],
        summary: 'Upload a profile photo (multipart field "file", ≤ 5 MB)',
        response: { 200: myProfileResponseSchema },
      },
    },
    async (request) => {
      const userId = currentUserId(request);
      const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
      if (!file) throw new AppError('BAD_REQUEST', 'Attach a photo in the "file" field.');
      const bytes = await file.toBuffer().catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('PAYLOAD_TOO_LARGE', 'Photos can be at most 5 MB.');
        }
        throw error;
      });
      const { large, small } = await processAvatar(bytes);
      const [largeKey, smallKey] = await Promise.all([
        app.storage.save(Readable.from([large])),
        app.storage.save(Readable.from([small])),
      ]);
      const previous = await requireUser(app, userId);
      const updated = (await usersModel(app)
        .findByIdAndUpdate(
          userId,
          {
            $set: {
              avatar: {
                large: largeKey.key,
                small: smallKey.key,
                version: randomBytes(6).toString('hex'),
              },
            },
          },
          { returnDocument: 'after' },
        )
        .lean()) as UserDoc;
      await deleteAvatarFiles(previous);
      return profile(updated);
    },
  );

  app.delete(
    '/me/avatar',
    { schema: { tags: ['profile'], response: { 200: myProfileResponseSchema } } },
    async (request) => {
      const userId = currentUserId(request);
      const previous = await requireUser(app, userId);
      const updated = (await usersModel(app)
        .findByIdAndUpdate(userId, { $unset: { avatar: 1 } }, { returnDocument: 'after' })
        .lean()) as UserDoc;
      await deleteAvatarFiles(previous);
      return profile(updated);
    },
  );

  async function deleteAvatarFiles(user: UserDoc) {
    if (!user.avatar) return;
    await Promise.all([
      app.storage.delete(user.avatar.large),
      app.storage.delete(user.avatar.small),
    ]).catch((error: unknown) => app.log.warn({ err: error }, 'could not delete old avatar files'));
  }
};
