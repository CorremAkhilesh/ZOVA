import { type DisappearTimer, disappearingResponseSchema } from '@zuvo/protocol';
import { apiPut } from '@/lib/api-client';

export const disappearingApi = {
  set: (chatId: string, timer: DisappearTimer) =>
    apiPut(`/v1/chats/${chatId}/disappearing`, { timer }, disappearingResponseSchema),
};
