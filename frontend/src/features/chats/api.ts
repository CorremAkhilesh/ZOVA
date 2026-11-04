import {
  type ChatSummary,
  chatListResponseSchema,
  chatResponseSchema,
  messageHistoryResponseSchema,
  syncResponseSchema,
} from '@zuvo/protocol';
import { apiGet, apiPost, withQuery } from '@/lib/api-client';

export const MESSAGE_PAGE = 50;
const CHAT_PAGE = 50;

export const chatsApi = {
  sync: (since: string | undefined) => apiGet(withQuery('/v1/sync', { since }), syncResponseSchema),

  async listAllChats(): Promise<ChatSummary[]> {
    const chats: ChatSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await apiGet(
        withQuery('/v1/chats', { limit: CHAT_PAGE, cursor }),
        chatListResponseSchema,
      );
      chats.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return chats;
  },

  recentChats: async () =>
    (await apiGet(withQuery('/v1/chats', { limit: CHAT_PAGE }), chatListResponseSchema)).items,

  selfChat: async () => (await apiGet('/v1/chats/self', chatResponseSchema)).chat,

  getChat: async (id: string) => (await apiGet(`/v1/chats/${id}`, chatResponseSchema)).chat,

  createDirect: async (userId: string) =>
    (await apiPost('/v1/chats/direct', { userId }, chatResponseSchema)).chat,

  history: (chatId: string, before: number | undefined) =>
    apiGet(
      withQuery(`/v1/chats/${chatId}/messages`, { before, limit: MESSAGE_PAGE }),
      messageHistoryResponseSchema,
    ),
};
