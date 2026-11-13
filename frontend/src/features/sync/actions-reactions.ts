import type { Message } from '@zuvo/protocol';

export type MessageReaction = NonNullable<Message['reactions']>[number];

/** One per person: a new one replaces mine, and none takes it away. */
export function nextReactions(
  current: MessageReaction[],
  me: string,
  emoji: string | null,
): MessageReaction[] {
  const others = current.filter((reaction) => reaction.userId !== me);
  return emoji ? [...others, { userId: me, emoji, at: new Date().toISOString() }] : others;
}
