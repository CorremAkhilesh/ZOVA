import type { ChatPrefs } from '@zuvo/protocol';

interface OnMessage {
  chatId: string;
  messageId: string;
  seq: number;
}

/** Something done to a message or chat, kept until the server has heard it. */
export type QueuedAction =
  | ({ type: 'edit'; text: string } & OnMessage)
  | ({ type: 'delete'; scope: 'me' | 'everyone'; asAdmin?: boolean } & OnMessage)
  | ({ type: 'react'; emoji: string | null } & OnMessage)
  | ({ type: 'star'; starred: boolean } & OnMessage)
  | { type: 'prefs'; chatId: string; prefs: ChatPrefs }
  | { type: 'clear'; chatId: string; seq: number; removeChat: boolean }
  | {
      type: 'forward';
      forwardId: string;
      messages: Array<{ chatId: string; messageId: string }>;
      chatIds: string[];
      comment?: string;
    };

export type ActionRow = QueuedAction & { n?: number };
