import type { ChatSummary, Draft } from '@zuvo/protocol';
import type { ChatDoc, ChatMemberDoc } from '../db/chat-models.ts';
import { groupView } from './group-core.ts';
import { shownLast, toLastMessage } from './message-format.ts';
import { visiblePins } from './pin-view.ts';

export type PeerProgress = Pick<ChatSummary, 'peerDeliveredSeq' | 'peerReadSeq'>;
export const NO_PEER: PeerProgress = { peerDeliveredSeq: 0, peerReadSeq: 0 };

export function peerProgress(
  other: Pick<ChatMemberDoc, 'lastDeliveredSeq' | 'lastReadSeq' | 'sharedReadSeq'>,
): PeerProgress {
  return {
    peerDeliveredSeq: other.lastDeliveredSeq,
    peerReadSeq: other.sharedReadSeq ?? other.lastReadSeq,
  };
}

/** My draft, or null when it is empty (an empty one is still kept, for its time). */
export function draftView(member: Pick<ChatMemberDoc, 'draft'>): Draft | null {
  const { draft } = member;
  if (!draft || (!draft.text.trim() && !draft.replyTo)) return null;
  return {
    text: draft.text,
    replyTo: draft.replyTo,
    updatedAt: new Date(draft.updatedAt).toISOString(),
  };
}

/** A chat as one member sees it. */
export function toSummary(
  chat: ChatDoc,
  member: ChatMemberDoc,
  otherUser: ChatSummary['otherUser'],
  peer: PeerProgress,
): ChatSummary {
  const seq = member.leftSeq ?? chat.seq;
  const last = shownLast(chat, member);
  return {
    id: chat._id.toString(),
    type: chat.type,
    seq,
    otherUser,
    group: chat.type === 'group' ? groupView(chat, member) : null,
    lastMessage: last ? toLastMessage(last) : null,
    lastReadSeq: member.lastReadSeq,
    unreadCount: Math.max(0, seq - member.lastReadSeq),
    pinned: Boolean(member.pinnedAt),
    mutedUntil: member.mutedUntil?.toISOString() ?? null,
    archived: Boolean(member.archivedAt),
    markedUnread: member.markedUnread === true,
    lastReaction: member.lastReaction ?? null,
    ...peer,
    lastActivityAt: member.lastActivityAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
    pins: visiblePins(chat.pins, member),
    mentionSeqs: member.mentionSeqs ?? [],
    draft: draftView(member),
  };
}
