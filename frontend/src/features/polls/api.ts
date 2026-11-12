import { pollMessageResponseSchema } from '@zuvo/protocol';
import { apiPost, apiPut } from '@/lib/api-client';

const messagePath = (chatId: string, messageId: string) =>
  `/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;

export const pollsApi = {
  /** My whole choice; empty removes my vote. */
  vote: (chatId: string, messageId: string, optionIds: string[]) =>
    apiPut(`${messagePath(chatId, messageId)}/vote`, { optionIds }, pollMessageResponseSchema),
  close: (chatId: string, messageId: string) =>
    apiPost(`${messagePath(chatId, messageId)}/close-poll`, undefined, pollMessageResponseSchema),
};
