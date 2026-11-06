import {
  AVATAR_MAX_BYTES,
  addMembersBodySchema,
  chatParamsSchema,
  chatResponseSchema,
  createGroupBodySchema,
  groupMembersResponseSchema,
  inviteParamsSchema,
  invitePreviewSchema,
  inviteResponseSchema,
  memberParamsSchema,
  memberRoleBodySchema,
  messageInfoResponseSchema,
  messageParamsSchema,
  transferOwnerBodySchema,
  updateGroupBodySchema,
  updateGroupSettingsBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import { requireGroupMember } from '../../chats/group-core.ts';
import {
  invitePhotoKey,
  joinByInvite,
  previewInvite,
  readInvite,
  resetInvite,
  revokeInvite,
} from '../../chats/group-invites.service.ts';
import {
  addMembers,
  leaveGroup,
  listMembers,
  removeMember,
  setMemberRole,
} from '../../chats/group-members.service.ts';
import { transferOwnership } from '../../chats/group-ownership.service.ts';
import {
  createGroup,
  setGroupPhoto,
  updateGroupInfo,
  updateGroupSettings,
} from '../../chats/groups.service.ts';
import { messageInfo } from '../../chats/message-info.service.ts';
import { AppError } from '../../lib/errors.ts';

const memberList = { 200: groupMembersResponseSchema };
const oneChat = { 200: chatResponseSchema };
const invite = { 200: inviteResponseSchema };

/** Groups: every action checks the caller's role here, on the server, whatever the app shows. */
export const groupsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.post(
    '/groups',
    { schema: { tags: ['groups'], body: createGroupBodySchema, response: oneChat } },
    async (request) => ({ chat: await createGroup(app, currentUserId(request), request.body) }),
  );

  app.patch(
    '/chats/:id/group',
    {
      schema: {
        tags: ['groups'],
        params: chatParamsSchema,
        body: updateGroupBodySchema,
        response: oneChat,
      },
    },
    async (request) => ({
      chat: await updateGroupInfo(app, currentUserId(request), request.params.id, request.body),
    }),
  );

  app.put(
    '/chats/:id/group/settings',
    {
      schema: {
        tags: ['groups'],
        params: chatParamsSchema,
        body: updateGroupSettingsBodySchema,
        response: oneChat,
      },
    },
    async (request) => ({
      chat: await updateGroupSettings(app, currentUserId(request), request.params.id, request.body),
    }),
  );

  app.post(
    '/chats/:id/group/photo',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['groups'], params: chatParamsSchema, response: oneChat },
    },
    async (request) => {
      const file = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
      if (!file) throw new AppError('BAD_REQUEST', 'Attach a photo in the "file" field.');
      const bytes = await file.toBuffer().catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('PAYLOAD_TOO_LARGE', 'Photos can be at most 5 MB.');
        }
        throw error;
      });
      return { chat: await setGroupPhoto(app, currentUserId(request), request.params.id, bytes) };
    },
  );

  app.delete(
    '/chats/:id/group/photo',
    { schema: { tags: ['groups'], params: chatParamsSchema, response: oneChat } },
    async (request) => ({
      chat: await setGroupPhoto(app, currentUserId(request), request.params.id, null),
    }),
  );

  app.get(
    '/chats/:id/photo',
    {
      schema: {
        tags: ['groups'],
        summary: 'Group photo (members only; private cache)',
        params: chatParamsSchema,
        querystring: z.object({
          size: z.enum(['small', 'large']).default('small'),
          v: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { chat } = await requireGroupMember(app, request.params.id, currentUserId(request));
      const photo = chat.group?.photo;
      if (!photo) throw new AppError('NOT_FOUND', 'No photo.');
      const { size } = request.query;
      reply.header('cache-control', 'private, max-age=86400').header('vary', 'Cookie');
      return reply
        .type('image/webp')
        .send(await app.storage.read(size === 'large' ? photo.large : photo.small));
    },
  );

  app.get(
    '/chats/:id/members',
    { schema: { tags: ['groups'], params: chatParamsSchema, response: memberList } },
    async (request) => ({
      members: await listMembers(app, currentUserId(request), request.params.id),
    }),
  );

  app.post(
    '/chats/:id/members',
    {
      schema: {
        tags: ['groups'],
        params: chatParamsSchema,
        body: addMembersBodySchema,
        response: memberList,
      },
    },
    async (request) => ({
      members: await addMembers(
        app,
        currentUserId(request),
        request.params.id,
        request.body.userIds,
      ),
    }),
  );

  app.delete(
    '/chats/:id/members/:userId',
    { schema: { tags: ['groups'], params: memberParamsSchema, response: memberList } },
    async (request) => ({
      members: await removeMember(
        app,
        currentUserId(request),
        request.params.id,
        request.params.userId,
      ),
    }),
  );

  app.put(
    '/chats/:id/members/:userId/role',
    {
      schema: {
        tags: ['groups'],
        params: memberParamsSchema,
        body: memberRoleBodySchema,
        response: memberList,
      },
    },
    async (request) => ({
      members: await setMemberRole(
        app,
        currentUserId(request),
        request.params.id,
        request.params.userId,
        request.body.role,
      ),
    }),
  );

  app.post(
    '/chats/:id/transfer',
    {
      schema: {
        tags: ['groups'],
        params: chatParamsSchema,
        body: transferOwnerBodySchema,
        response: memberList,
      },
    },
    async (request) => ({
      members: await transferOwnership(
        app,
        currentUserId(request),
        request.params.id,
        request.body.userId,
      ),
    }),
  );

  app.post(
    '/chats/:id/leave',
    { schema: { tags: ['groups'], params: chatParamsSchema, response: oneChat } },
    async (request) => ({ chat: await leaveGroup(app, currentUserId(request), request.params.id) }),
  );

  app.get(
    '/chats/:id/invite',
    { schema: { tags: ['groups'], params: chatParamsSchema, response: invite } },
    async (request) => readInvite(app, currentUserId(request), request.params.id),
  );
  app.post(
    '/chats/:id/invite',
    {
      schema: {
        tags: ['groups'],
        summary: 'Create the invite link, or reset it',
        params: chatParamsSchema,
        response: invite,
      },
    },
    async (request) => resetInvite(app, currentUserId(request), request.params.id),
  );
  app.delete(
    '/chats/:id/invite',
    { schema: { tags: ['groups'], params: chatParamsSchema, response: invite } },
    async (request) => revokeInvite(app, currentUserId(request), request.params.id),
  );

  app.get(
    '/invites/:code',
    {
      schema: {
        tags: ['groups'],
        params: inviteParamsSchema,
        response: { 200: invitePreviewSchema },
      },
    },
    async (request) => previewInvite(app, currentUserId(request), request.params.code),
  );
  app.get(
    '/invites/:code/photo',
    { schema: { tags: ['groups'], params: inviteParamsSchema } },
    async (request, reply) =>
      reply
        .type('image/webp')
        .header('cache-control', 'private, no-store')
        .send(await app.storage.read(await invitePhotoKey(app, request.params.code))),
  );
  app.post(
    '/invites/:code/join',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['groups'], params: inviteParamsSchema, response: oneChat },
    },
    async (request) => ({
      chat: await joinByInvite(app, currentUserId(request), request.params.code),
    }),
  );

  app.get(
    '/chats/:id/messages/:messageId/info',
    {
      schema: {
        tags: ['groups'],
        summary: 'Read by and delivered to, for my own message',
        params: messageParamsSchema,
        response: { 200: messageInfoResponseSchema },
      },
    },
    async (request) =>
      messageInfo(app, currentUserId(request), request.params.id, request.params.messageId),
  );
};
