import { isQuietAt, passesQuietHours, type QuietHours } from '@zuvo/protocol';

/** Why a message is not pushed to a device. Logged (never with content) and counted. */
export type SkipReason =
  | 'own_message'
  | 'system'
  | 'deleted'
  | 'expired'
  | 'not_visible'
  | 'hidden'
  | 'read'
  | 'blocked'
  | 'muted'
  | 'quiet_hours'
  | 'attended';

/** Everything the decision needs, gathered beforehand (see gather.ts). */
export interface PushDecisionInput {
  now: Date;
  /** The recipient sent it (another device of theirs). */
  isSender: boolean;
  message: {
    chatId: string;
    seq: number;
    system: boolean;
    deletedForEveryone: boolean;
    expiresAt: Date | null;
    /** Within what the recipient may see: after they joined (or cleared), before they left. */
    visible: boolean;
    /** Deleted for me. */
    hiddenForMe: boolean;
    /** Named, or "@everyone", in a group. */
    mentionsMe: boolean;
  };
  recipient: {
    lastReadSeq: number;
    /** 1:1 only: one of the two blocked the other. */
    blocked: boolean;
    mutedUntil: Date | null;
    quietHours: QuietHours;
  };
  device: {
    /** A tab of this device is visible and focused right now. */
    attended: boolean;
  };
}

export type PushDecision =
  | {
      send: true;
      /** It is quiet, and this went through only because of an exception (a mention, a chat). */
      quietException: boolean;
    }
  | { send: false; reason: SkipReason };

const skip = (reason: SkipReason): PushDecision => ({ send: false, reason });

/** About the message itself: whether it is something this person should hear about at all. */
function messageSkip(input: PushDecisionInput): SkipReason | null {
  const { message, recipient, now } = input;
  if (input.isSender) return 'own_message';
  if (message.system) return 'system';
  if (message.deletedForEveryone) return 'deleted';
  if (message.expiresAt && message.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (!message.visible) return 'not_visible';
  if (message.hiddenForMe) return 'hidden';
  if (recipient.lastReadSeq >= message.seq) return 'read';
  if (recipient.blocked) return 'blocked';
  return null;
}

/**
 * Should this message be pushed to this device? Pure: every fact is gathered beforehand. Order:
 * the message, then the person's choices (mute, quiet hours), then the device (attended).
 * A mention gets through a mute. Quiet hours let through the exceptions the person chose.
 */
export function decidePush(input: PushDecisionInput): PushDecision {
  const reason = messageSkip(input);
  if (reason) return skip(reason);
  const { message, recipient, now } = input;
  const muted = recipient.mutedUntil !== null && recipient.mutedUntil.getTime() > now.getTime();
  if (muted && !message.mentionsMe) return skip('muted');
  const quiet = isQuietAt(recipient.quietHours, now);
  const exception =
    quiet &&
    passesQuietHours(recipient.quietHours, {
      chatId: message.chatId,
      mentionsMe: message.mentionsMe,
    });
  if (quiet && !exception) return skip('quiet_hours');
  if (input.device.attended) return skip('attended');
  return { send: true, quietException: exception };
}
