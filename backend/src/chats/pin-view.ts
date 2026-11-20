import type { PinnedMessage } from '@zuvo/protocol';
import type { ChatMemberDoc, StoredPin } from '../db/chat-models.ts';
import { canSeeSeq } from './visibility.ts';

/**
 * The pins this member may see: not expired (the job removes those later), only messages history
 * lets them see (someone who joined later never learns of an older one), and none they deleted for
 * themselves (`hidden`: message ids).
 */
export function visiblePins(
  pins: StoredPin[] | undefined,
  member: Pick<ChatMemberDoc, 'joinSeq' | 'leftSeq' | 'leftAt' | 'clearedSeq'>,
  now = Date.now(),
  hidden?: ReadonlySet<string>,
): PinnedMessage[] {
  return (pins ?? [])
    .filter(
      (pin) =>
        new Date(pin.expiresAt).getTime() > now &&
        canSeeSeq(member, pin.seq) &&
        !hidden?.has(pin.messageId.toString()),
    )
    .map((pin) => ({
      messageId: pin.messageId.toString(),
      seq: pin.seq,
      pinnedBy: pin.pinnedBy?.toString() ?? null,
      pinnedAt: new Date(pin.pinnedAt).toISOString(),
      expiresAt: new Date(pin.expiresAt).toISOString(),
    }));
}
