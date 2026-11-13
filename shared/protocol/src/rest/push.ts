import { z } from 'zod';

/**
 * Web Push (Step 18). A device subscribes after sign-in; the subscription belongs to that session and
 * goes when the session does (sign-out, revoke, expiry, deactivation) or when the push service says
 * 404/410. docs/protocol.md → "Notifications".
 */

/** The longest message text a notification shows; the rest is cut with "…". */
export const PUSH_BODY_MAX = 120;
/** Messages to one chat within this window become one notification. */
export const PUSH_COALESCE_SECONDS = 4;
/** At most this many pushes per person per minute; the rest wait for the next coalesced one. */
export const PUSH_USER_PER_MINUTE = 30;

/** A browser's PushSubscription.toJSON(). Only https push services are accepted. */
export const pushSubscriptionBodySchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => value.startsWith('https://'), 'must be an https URL'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;

/** DELETE /v1/me/push/subscription: this device stops receiving pushes. */
export const pushUnsubscribeBodySchema = z.object({ endpoint: z.url().max(2048) });

/** My notification settings, the same on every device. */
export const pushSettingsSchema = z.object({
  /** Show the sender and text. Off: "New message" only. Locked chats and app lock never show it. */
  showPreview: z.boolean().default(true),
  /** Sound for notifications and in-app toasts. Quiet hours silence it anyway. */
  sound: z.boolean().default(true),
});
export type PushSettings = z.infer<typeof pushSettingsSchema>;
export const DEFAULT_PUSH_SETTINGS: PushSettings = { showPreview: true, sound: true };
/** PUT /v1/me/push/settings: only what was sent changes (no defaults, so nothing else is reset). */
export const updatePushSettingsBodySchema = z
  .object({ showPreview: z.boolean(), sound: z.boolean() })
  .partial();

/** A device of mine with push turned on. */
export const pushDeviceSchema = z.object({
  id: z.string(),
  /** "Chrome on Windows", from the session's user agent. */
  label: z.string(),
  /** This browser. */
  current: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type PushDevice = z.infer<typeof pushDeviceSchema>;

/** GET /v1/me/push */
export const pushStateResponseSchema = z.object({
  /** VAPID public key (base64url) for pushManager.subscribe; null: push is not set up on this server. */
  publicKey: z.string().nullable(),
  settings: pushSettingsSchema,
  devices: z.array(pushDeviceSchema),
});
export type PushState = z.infer<typeof pushStateResponseSchema>;

/** PUT /v1/me/push/subscription */
export const pushSubscribeResponseSchema = z.object({ device: pushDeviceSchema });

/** POST /v1/me/push/test: a test notification to this device. */
export const pushTestResponseSchema = z.object({ sent: z.number().int().min(0) });

/** POST /v1/chats/:chatId/read (the notification's "Mark as read"). */
export const markChatReadBodySchema = z.object({ seq: z.number().int().positive() });

/** POST /v1/chats/:chatId/reply (the notification's inline "Reply"). */
export const notificationReplyBodySchema = z.object({
  clientMsgId: z.uuid(),
  text: z.string().trim().min(1).max(4096),
});

/**
 * What the service worker receives (encrypted by the push service, standard Web Push). Small, no
 * secrets. With the preview off or a locked chat: title "New message", no body, no sender.
 */
export const pushPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    v: z.literal(1),
    chatId: z.string(),
    /** One notification per chat: a newer one replaces it. */
    tag: z.string(),
    title: z.string().max(120),
    body: z.string().max(400),
    /** Newest message seq: "Mark as read" reads up to it. */
    seq: z.number().int().positive(),
    /** Messages in this notification (1 + "more"). */
    count: z.number().int().positive(),
    /** Unread chats for the app badge. */
    badge: z.number().int().min(0),
    /** Without details: locked chat, app lock or preview off. Hides Reply. */
    hidden: z.boolean(),
    silent: z.boolean(),
    sentAt: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal('test'),
    v: z.literal(1),
    tag: z.string(),
    title: z.string().max(120),
    body: z.string().max(400),
    silent: z.boolean(),
    sentAt: z.iso.datetime(),
  }),
]);
export type PushPayload = z.infer<typeof pushPayloadSchema>;

/** The tag of a chat's notification. */
export const pushTagFor = (chatId: string) => `chat:${chatId}`;
