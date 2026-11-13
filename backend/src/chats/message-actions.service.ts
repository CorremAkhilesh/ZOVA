import { DELETE_WINDOW_HOURS, EDIT_WINDOW_MINUTES } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession } from 'mongoose';
import type { MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { hasLink } from '../previews/link-text.ts';
import { announceOwnChat } from './chat-prefs.service.ts';
import { chatModels, oid } from './chats.service.ts';
import { namesOf } from './group-core.ts';
import { isAdminRole } from './group-permissions.ts';
import { checkMentions, editMentions, type MentionInput, mentionUpdate } from './mentions.ts';
import { previewOf } from './message-format.ts';
import {
  announceMessageUpdate,
  logMessageUpdate,
  refreshQuotes,
  requireVisibleMessage,
} from './message-updates.ts';

export const assertActionable = (doc: MessageDoc) => {
  if (doc.deletedForEveryoneAt) throw new AppError('CONFLICT', 'This message was deleted.');
  if (doc.type === 'system') throw new AppError('BAD_REQUEST', 'This cannot be done to this.');
};

/** Someone who hid the chat's last message has an earlier one as their preview: keep it true. */
function patchPreviewCopies(
  app: FastifyInstance,
  session: ClientSession,
  doc: MessageDoc,
  patch: Record<string, unknown>,
) {
  return chatModels(app).ChatMember.updateMany(
    { chatId: doc.chatId, 'previewLast.seq': doc.seq },
    { $set: patch },
    { session },
  );
}

/** Own text or caption, within 15 minutes. A voice note has neither. */
export async function editMessage(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
  input: string,
  mentionInput: MentionInput = {},
) {
  const { doc, member } = await requireVisibleMessage(app, userId, chatId, messageId);
  assertActionable(doc);
  if (doc.senderId?.toString() !== userId) {
    throw new AppError('FORBIDDEN', 'You can only edit your own messages.');
  }
  if (Date.now() - doc.createdAt.getTime() > EDIT_WINDOW_MINUTES * 60_000) {
    throw new AppError('EDIT_WINDOW_PASSED', 'This message is too old to edit.');
  }
  if (doc.type === 'voice') throw new AppError('BAD_REQUEST', 'A voice note cannot be edited.');
  if (doc.type === 'poll') throw new AppError('BAD_REQUEST', 'A poll cannot be edited.');
  const trimmed = input.trim();
  if (!trimmed && doc.type === 'text') {
    throw new AppError('BAD_REQUEST', 'A message cannot be empty.');
  }
  const text = trimmed ? input : null;
  // Sent again by a device catching up: nothing has changed.
  if (text === doc.text) return;
  const checked = await checkMentions(app, doc.chatId, member, text, mentionInput);
  const { Message, Chat } = chatModels(app);
  const editedAt = new Date();
  // Taking every link out also takes the preview away; any link keeps it.
  const linked = hasLink(text);
  const mention = mentionUpdate(checked);
  const { hasLink: _had, linkPreview: _preview, mentions: _m, mentionsEveryone: _e, ...rest } = doc;
  const updated: MessageDoc = {
    ...rest,
    text,
    editedAt,
    ...mention.set,
    ...(linked ? { hasLink: true, linkPreview: doc.linkPreview ?? null } : {}),
  };
  const change = {
    $set: { text, editedAt, ...mention.set, ...(linked ? { hasLink: true } : {}) },
    $unset: { ...mention.unset, ...(linked ? {} : { hasLink: 1, linkPreview: 1 }) },
  };
  const touched: string[] = [];
  const pending = await app.mongo.transaction(async (session) => {
    await Message.updateOne({ _id: doc._id }, change, { session });
    touched.push(...(await editMentions(app, session, doc, checked)));
    const preview = await Chat.updateOne(
      { _id: doc.chatId, 'lastMessage.seq': doc.seq },
      { $set: { 'lastMessage.preview': previewOf(doc.media, text) } },
      { session },
    );
    await patchPreviewCopies(app, session, doc, {
      'previewLast.preview': previewOf(doc.media, text),
    });
    return logMessageUpdate(app, session, updated, { chatChanged: preview.modifiedCount > 0 });
  });
  announceMessageUpdate(app, pending);
  // Their "@" on the chat may have come or gone.
  for (const id of touched) await announceOwnChat(app, id, chatId, '0').catch(() => undefined);
  await refreshQuotes(app, doc, { text: previewOf(doc.media, text), deleted: false });
}

/**
 * Own messages within 48 hours. A group's owner and admins can delete anyone's, whenever, and the
 * tombstone says so. The file goes in a background job, once no forwarded copy still needs it.
 */
export async function deleteForEveryone(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { doc, member } = await requireVisibleMessage(app, userId, chatId, messageId);
  // Sent again by a device catching up.
  if (doc.deletedForEveryoneAt) return;
  assertActionable(doc);
  const { Message, Chat, ChatMember, Media, Star } = chatModels(app);
  const mine = doc.senderId?.toString() === userId;
  const chat = await Chat.findById(doc.chatId).select({ type: 1 }).lean();
  const asAdmin = !mine && chat?.type === 'group' && isAdminRole(member.role);
  if (!mine && !asAdmin) throw new AppError('FORBIDDEN', 'You cannot delete this message.');
  if (!asAdmin && Date.now() - doc.createdAt.getTime() > DELETE_WINDOW_HOURS * 3_600_000) {
    throw new AppError('DELETE_WINDOW_PASSED', 'This message is too old to delete for everyone.');
  }
  const deletedForEveryoneAt = new Date();
  const changes = {
    deletedForEveryoneAt,
    deletedByAdmin: asAdmin,
    text: null,
    media: null,
    reactions: [],
    replyTo: null,
  };
  const updated: MessageDoc = { ...doc, ...changes };
  const pending = await app.mongo.transaction(async (session) => {
    await Message.updateOne({ _id: doc._id }, { $set: changes }, { session });
    await Star.deleteMany({ chatId: doc.chatId, messageId: doc._id }, { session });
    if (doc.media?.id) {
      await Media.updateOne(
        { _id: oid(doc.media.id) },
        { $set: { deleteRequestedAt: deletedForEveryoneAt } },
        { session },
      );
    }
    const preview = await Chat.updateOne(
      { _id: doc.chatId, 'lastMessage.seq': doc.seq },
      { $set: { 'lastMessage.preview': '', 'lastMessage.deleted': true } },
      { session },
    );
    // A deleted message stays pinned for nobody.
    await Chat.updateOne(
      { _id: doc.chatId },
      { $pull: { pins: { messageId: doc._id } } },
      { session },
    );
    await patchPreviewCopies(app, session, doc, {
      'previewLast.preview': '',
      'previewLast.deleted': true,
    });
    if (doc.senderId) {
      await ChatMember.updateOne(
        { chatId: doc.chatId, userId: doc.senderId, 'lastReaction.seq': doc.seq },
        { $unset: { lastReaction: 1 } },
        { session },
      );
    }
    return logMessageUpdate(app, session, updated, { chatChanged: preview.modifiedCount > 0 });
  });
  announceMessageUpdate(app, pending);
  await refreshQuotes(app, doc, { text: '', deleted: true });
}

/** One per person: a new one replaces the old. Null removes it. The author hears about it. */
export async function setReaction(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
  emoji: string | null,
) {
  const { doc, member } = await requireVisibleMessage(app, userId, chatId, messageId);
  assertActionable(doc);
  const current = doc.reactions?.find((reaction) => reaction.userId.equals(member.userId));
  // Sent again by a device catching up.
  if ((current?.emoji ?? null) === emoji) return;
  const { Message, ChatMember } = chatModels(app);
  const at = new Date();
  const others = (doc.reactions ?? []).filter((reaction) => !reaction.userId.equals(member.userId));
  const reactions = emoji ? [...others, { userId: member.userId, emoji, at }] : others;
  const author = doc.senderId && !doc.senderId.equals(member.userId) ? doc.senderId : null;
  const name = (await namesOf(app, [userId]))(userId).name;
  const lastReaction = emoji && {
    byId: userId,
    byName: name,
    emoji,
    text: previewOf(doc.media, doc.text, doc.poll),
    seq: doc.seq,
    at: at.toISOString(),
  };
  const pending = await app.mongo.transaction(async (session) => {
    await Message.updateOne({ _id: doc._id }, { $set: { reactions } }, { session });
    const preview = author
      ? await ChatMember.updateOne(
          // Taking mine back only removes the line if the line is mine.
          { chatId: doc.chatId, userId: author, ...(emoji ? {} : { 'lastReaction.byId': userId }) },
          emoji ? { $set: { lastReaction } } : { $unset: { lastReaction: 1 } },
          { session },
        )
      : null;
    return {
      update: await logMessageUpdate(app, session, { ...doc, reactions }),
      previewChanged: (preview?.modifiedCount ?? 0) > 0,
    };
  });
  announceMessageUpdate(app, pending.update);
  if (author && pending.previewChanged) {
    app.realtime.emitToUser(author.toString(), 'reaction:preview', {
      chatId,
      lastReaction: lastReaction || null,
    });
  }
}
