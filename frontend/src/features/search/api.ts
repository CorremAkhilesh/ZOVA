import { messageSearchResponseSchema, type SearchFilter } from '@zuvo/protocol';
import { apiGet, withQuery } from '@/lib/api-client';

export const searchApi = {
  messages: (params: {
    q: string;
    filter?: SearchFilter | undefined;
    chatId?: string | undefined;
    cursor?: string | undefined;
  }) =>
    apiGet(withQuery('/v1/search/messages', { ...params, limit: 20 }), messageSearchResponseSchema),
};
