import { DEFAULT_GROUP_SETTINGS, MENTION_SEQS_MAX, type Mention } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { type ClientSession, Types } from 'mongoose';
import type { ChatMemberDoc, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels } from './chats.service.ts';
import { assertAllowed, groupRules } from './group-permissions.ts';

export interface MentionInput {
  mentions?: Mention[] | undefined;
  mentionsEveryone?: boolean | undefined;
}

export interface CheckedMentions {
  mentions: NonNullable<MessageDoc['mentions']>;
  everyone: boolean;
  /** Who gets an "@" on the chat: the people named, or every member but the sender. */
  recipients: Types.ObjectId[];
}

const bad = (message: string) => new AppError('BAD_REQUEST', message);

/** Each mention is an "@…" in the text, in order, none overlapping. Offsets are UTF-16 units. */
export function checkRanges(text: string, mentions: Mention[]) {
  const sorted = [...mentions].sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const mention of sorted) {
    if (mention.offset < end) throw bad('Mentions overlap.');
    end = mention.offset + mention.length;
    if (end > text.length || text[mention.offset] !== '@') {
      throw bad('A mention must point at an @name in the text.');
    }
  }
  return sorted;
}

/**
 * Checks the mentions of a message about to be sent (or edited): groups only, members only (not
 * the sender), "@everyone" only where allowed. Null when the message mentions nobody.
 */
export async function checkMentions(
  app: FastifyInstance,
  chatId: Types.ObjectId,
  sender: Pick<ChatMemberDoc, 'userId' | 'role'>,
  text: string | null | undefined,
  input: MentionInput,
): Promise<CheckedMentions | null> {
  const list = input.mentions ?? [];
  const everyone = input.mentionsEveryone === true;
  if (list.length === 0 && !everyone) return null;
  const { Chat, ChatMember } = chatModels(app);
  const chat = await Chat.findById(chatId).select({ type: 1, group: 1 }).lean();
  if (chat?.type !== 'group') throw bad('Mentions are only for groups.');
  const body = text ?? '';
  const sorted = checkRanges(body, list);
  const members = await ChatMember.find({ chatId, leftAt: null }).select({ userId: 1 }).lean();
  const others = members.map((member) => member.userId).filter((id) => !id.equals(sender.userId));
  const allowed = new Set(others.map(String));
  if (sorted.some((mention) => !allowed.has(mention.userId))) {
    throw bad('You can only mention members of this group.');
  }
  if (everyone) {
    const settings = { ...DEFAULT_GROUP_SETTINGS, ...chat.group?.settings };
    assertAllowed(
      groupRules.mentionEveryone(sender.role, settings),
      'Only admins can mention everyone here.',
    );
    if (!body.includes('@everyone')) throw bad('Say @everyone in the text to mention everyone.');
  }
  const named = [...new Set(sorted.map((mention) => mention.userId))].map(
    (id) => new Types.ObjectId(id),
  );
  return {
    mentions: sorted.map((mention) => ({ ...mention, userId: new Types.ObjectId(mention.userId) })),
    everyone,
    recipients: everyone ? others : named,
  };
}

/** What a message stores about its mentions. Absent when it has none. */
export const mentionFields = (checked: CheckedMentions | null) =>
  checked
    ? {
        ...(checked.mentions.length ? { mentions: checked.mentions } : {}),
        ...(checked.everyone ? { mentionsEveryone: true } : {}),
      }
    : {};

/** The "@" on the chat for each person mentioned: the position joins their unread mentions. */
export async function recordMentions(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  seq: number,
  recipients: Types.ObjectId[],
) {
  if (recipients.length === 0) return;
  await chatModels(app).ChatMember.updateMany(
    // Only if they have not read that far: an edit must not bring back a mention already seen.
    { chatId, userId: { $in: recipients }, mentionSeqs: { $ne: seq }, lastReadSeq: { $lt: seq } },
    { $push: { mentionSeqs: { $each: [seq], $sort: 1, $slice: -MENTION_SEQS_MAX } } },
    { session },
  );
}

/** Who a stored message mentions: the people named, or every member but the sender. */
async function recipientsOf(app: FastifyInstance, doc: MessageDoc) {
  if (doc.mentionsEveryone) {
    const members = await chatModels(app)
      .ChatMember.find({ chatId: doc.chatId, leftAt: null })
      .select({ userId: 1 })
      .lean();
    return members.map((member) => member.userId).filter((id) => !doc.senderId?.equals(id));
  }
  return (doc.mentions ?? []).map((mention) => mention.userId);
}

/**
 * An edit changes who is mentioned: newly named people get the "@" (if they have not read that
 * far), people no longer named lose it. Returns everyone whose "@" may have changed.
 */
export async function editMentions(
  app: FastifyInstance,
  session: ClientSession,
  doc: MessageDoc,
  checked: CheckedMentions | null,
) {
  const before = await recipientsOf(app, doc);
  const after = checked?.recipients ?? [];
  const had = new Set(before.map(String));
  const has = new Set(after.map(String));
  const added = after.filter((id) => !had.has(id.toString()));
  const removed = before.filter((id) => !has.has(id.toString()));
  await recordMentions(app, session, doc.chatId, doc.seq, added);
  await forgetMentions(app, session, doc.chatId, doc.seq, removed);
  return [...added, ...removed].map(String);
}

/** The message update for its new mentions. */
export function mentionUpdate(checked: CheckedMentions | null) {
  const set = mentionFields(checked);
  return {
    set,
    unset: {
      ...('mentions' in set ? {} : { mentions: 1 }),
      ...('mentionsEveryone' in set ? {} : { mentionsEveryone: 1 }),
    },
  };
}

/** A mention taken away (edited out): its position leaves their unread mentions. */
export async function forgetMentions(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  seq: number,
  userIds: Types.ObjectId[],
) {
  if (userIds.length === 0) return;
  await chatModels(app).ChatMember.updateMany(
    { chatId, userId: { $in: userIds } },
    { $pull: { mentionSeqs: seq } },
    { session },
  );
}
