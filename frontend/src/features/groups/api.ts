import {
  chatResponseSchema,
  type GroupSettings,
  groupMembersResponseSchema,
  invitePreviewSchema,
  inviteResponseSchema,
  messageInfoResponseSchema,
} from '@zuvo/protocol';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiRequest,
  apiUpload,
} from '@/lib/api-client';

const chat = async (work: Promise<{ chat: import('@zuvo/protocol').ChatSummary }>) =>
  (await work).chat;

const membersOf = async (work: Promise<{ members: import('@zuvo/protocol').GroupMember[] }>) =>
  (await work).members;

export const groupsApi = {
  create: (body: { name: string; description: string; memberIds: string[] }) =>
    chat(apiPost('/v1/groups', body, chatResponseSchema)),
  update: (id: string, changes: { name?: string; description?: string }) =>
    chat(apiPatch(`/v1/chats/${id}/group`, changes, chatResponseSchema)),
  updateSettings: (id: string, changes: Partial<GroupSettings>) =>
    chat(apiPut(`/v1/chats/${id}/group/settings`, changes, chatResponseSchema)),
  setPhoto: (id: string, file: Blob) =>
    chat(apiUpload(`/v1/chats/${id}/group/photo`, file, chatResponseSchema)),
  removePhoto: (id: string) => chat(apiDelete(`/v1/chats/${id}/group/photo`, chatResponseSchema)),

  members: (id: string) => membersOf(apiGet(`/v1/chats/${id}/members`, groupMembersResponseSchema)),
  addMembers: (id: string, userIds: string[]) =>
    membersOf(apiPost(`/v1/chats/${id}/members`, { userIds }, groupMembersResponseSchema)),
  removeMember: (id: string, userId: string) =>
    membersOf(apiDelete(`/v1/chats/${id}/members/${userId}`, groupMembersResponseSchema)),
  setRole: (id: string, userId: string, role: 'admin' | 'member') =>
    membersOf(
      apiPut(`/v1/chats/${id}/members/${userId}/role`, { role }, groupMembersResponseSchema),
    ),
  transfer: (id: string, userId: string) =>
    membersOf(apiPost(`/v1/chats/${id}/transfer`, { userId }, groupMembersResponseSchema)),
  leave: (id: string) =>
    chat(apiRequest(`/v1/chats/${id}/leave`, chatResponseSchema, { method: 'POST' })),

  invite: (id: string) => apiGet(`/v1/chats/${id}/invite`, inviteResponseSchema),
  resetInvite: (id: string) =>
    apiRequest(`/v1/chats/${id}/invite`, inviteResponseSchema, { method: 'POST' }),
  revokeInvite: (id: string) => apiDelete(`/v1/chats/${id}/invite`, inviteResponseSchema),
  previewInvite: (code: string) => apiGet(`/v1/invites/${code}`, invitePreviewSchema),
  join: (code: string) =>
    chat(apiRequest(`/v1/invites/${code}/join`, chatResponseSchema, { method: 'POST' })),

  messageInfo: (id: string, messageId: string) =>
    apiGet(`/v1/chats/${id}/messages/${messageId}/info`, messageInfoResponseSchema),
};
