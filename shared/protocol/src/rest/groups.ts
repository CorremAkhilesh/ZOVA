import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { publicProfileSchema } from './profile.ts';

export const GROUP_NAME_MAX = 100;
export const GROUP_DESCRIPTION_MAX = 500;
export const GROUP_MEMBERS_MAX = 256;

export const groupRoleSchema = z.enum(['owner', 'admin', 'member']);
export const groupAudienceSchema = z.enum(['all', 'admins']);

/** Who may do what in a group. Only admins can change these. */
export const groupSettingsSchema = z.object({
  editInfo: groupAudienceSchema,
  sendMessages: groupAudienceSchema,
  addMembers: groupAudienceSchema,
  /** Who may pin messages for everyone. Defaults keep copies cached before this existed valid. */
  pinMessages: groupAudienceSchema.default('all'),
  /** "@everyone": admins may use it, or nobody. */
  mentionEveryone: z.enum(['admins', 'off']).default('admins'),
  /** Who may change the disappearing-messages timer. */
  disappearing: groupAudienceSchema.default('admins'),
});

export const DEFAULT_GROUP_SETTINGS: z.infer<typeof groupSettingsSchema> = {
  editInfo: 'all',
  sendMessages: 'all',
  addMembers: 'admins',
  pinMessages: 'all',
  mentionEveryone: 'admins',
  disappearing: 'admins',
};

/** A group as one member sees it. */
export const groupInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  photo: z.object({ small: z.string(), large: z.string() }).nullable(),
  memberCount: z.number().int().nonnegative(),
  settings: groupSettingsSchema,
  myRole: groupRoleSchema,
  /** False once I left or was removed: this is how the group looked at that moment. */
  active: z.boolean(),
});

const groupNameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX);
const groupDescriptionSchema = z.string().trim().max(GROUP_DESCRIPTION_MAX);
const memberIdsSchema = z.array(objectIdSchema).max(GROUP_MEMBERS_MAX);

/** POST /v1/groups */
export const createGroupBodySchema = z.object({
  name: groupNameSchema,
  description: groupDescriptionSchema.default(''),
  /** Everyone but me. */
  memberIds: memberIdsSchema,
});

/** PATCH /v1/chats/:id/group */
export const updateGroupBodySchema = z
  .object({ name: groupNameSchema.optional(), description: groupDescriptionSchema.optional() })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Nothing to change',
  });

/**
 * PUT /v1/chats/:id/group/settings: only what is sent changes. Spelled out without defaults, since a
 * `.partial()` of the settings would fill in every default and reset settings nobody touched.
 */
export const updateGroupSettingsBodySchema = z
  .object({
    editInfo: groupAudienceSchema,
    sendMessages: groupAudienceSchema,
    addMembers: groupAudienceSchema,
    pinMessages: groupAudienceSchema,
    mentionEveryone: z.enum(['admins', 'off']),
    disappearing: groupAudienceSchema,
  })
  .partial();

/** GET /v1/chats/:id/members. A group is small enough to send whole. */
export const groupMemberSchema = z.object({
  user: publicProfileSchema,
  role: groupRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export const groupMembersResponseSchema = z.object({ members: z.array(groupMemberSchema) });

/** POST /v1/chats/:id/members */
export const addMembersBodySchema = z.object({ userIds: memberIdsSchema.min(1) });
export const memberParamsSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });
/** PUT /v1/chats/:id/members/:userId/role */
export const memberRoleBodySchema = z.object({ role: z.enum(['admin', 'member']) });
/** POST /v1/chats/:id/transfer */
export const transferOwnerBodySchema = z.object({ userId: objectIdSchema });

/** Random and long: having the code is what lets someone in. */
export const inviteCodeSchema = z.string().regex(/^[\w-]{16,64}$/, 'Invalid invite code');
export const inviteParamsSchema = z.object({ code: inviteCodeSchema });
/** GET, POST and DELETE /v1/chats/:id/invite. Admins only. Null when there is no active link. */
export const inviteResponseSchema = z.object({ code: inviteCodeSchema.nullable() });
/** GET /v1/invites/:code: what the join page shows, for someone not in the group yet. */
export const invitePreviewSchema = z.object({
  chatId: z.string(),
  name: z.string(),
  photo: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  alreadyMember: z.boolean(),
});

/** GET /v1/chats/:id/messages/:messageId/info. Only for whoever sent the message. */
export const messageInfoEntrySchema = z.object({
  user: publicProfileSchema,
  /** Null for receipts older than the log of when things happened. */
  at: isoDateTimeSchema.nullable(),
});
export const messageInfoResponseSchema = z.object({
  readBy: z.array(messageInfoEntrySchema),
  deliveredTo: z.array(messageInfoEntrySchema),
  /** Members whose devices do not have it yet. */
  waiting: z.number().int().nonnegative(),
});
export const messageParamsSchema = z.object({ id: objectIdSchema, messageId: objectIdSchema });

export type GroupRole = z.infer<typeof groupRoleSchema>;
export type GroupSettings = z.infer<typeof groupSettingsSchema>;
export type GroupInfo = z.infer<typeof groupInfoSchema>;
export type GroupMember = z.infer<typeof groupMemberSchema>;
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export type MessageInfo = z.infer<typeof messageInfoResponseSchema>;
