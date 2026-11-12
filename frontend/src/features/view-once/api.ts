import { viewOnceOpenResponseSchema } from '@zuvo/protocol';
import { ApiClientError, apiRequest } from '@/lib/api-client';

export const viewOnceApi = {
  /** The one link to the file. Counts as opened at once; asking again is 410. */
  open: (chatId: string, messageId: string) =>
    apiRequest(`/v1/chats/${chatId}/messages/${messageId}/view-once`, viewOnceOpenResponseSchema, {
      method: 'POST',
    }),
};

export const isAlreadyOpened = (error: unknown) =>
  error instanceof ApiClientError &&
  (error.status === 410 || error.apiError?.code === 'VIEW_ONCE_OPENED');
