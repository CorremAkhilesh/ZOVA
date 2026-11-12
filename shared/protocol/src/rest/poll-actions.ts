import { z } from 'zod';
import { messageSchema } from './chats.ts';

/** PUT …/vote and POST …/close-poll: the poll's message as I now see it. */
export const pollMessageResponseSchema = z.object({ message: messageSchema });
