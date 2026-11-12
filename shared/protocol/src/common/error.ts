import { z } from 'zod';

/** Machine-readable error codes returned by the REST API and socket acks. */
export const errorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_ATTEMPTS_EXCEEDED',
  'SESSION_EXPIRED',
  'ACCOUNT_DEACTIVATED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'UNSUPPORTED_MEDIA_TYPE',
  'USERNAME_TAKEN',
  'USERNAME_CHANGE_TOO_SOON',
  'SECURITY_TOKEN_INVALID',
  'SECURITY_TOKEN_EXPIRED',
  'LAST_ADMIN',
  'MEDIA_NOT_FOUND',
  'MEDIA_NOT_ATTACHABLE',
  'MEDIA_LINK_INVALID',
  'UPLOAD_OFFSET_MISMATCH',
  'STORAGE_FULL',
  'GROUP_FULL',
  'OWNER_MUST_TRANSFER',
  'INVITE_INVALID',
  'EDIT_WINDOW_PASSED',
  'DELETE_WINDOW_PASSED',
  'PIN_LIMIT_REACHED',
  /** I blocked this person: unblock them to write. */
  'BLOCKED',
  /** This person blocked me. Deliberately vague, as in other messengers. */
  'CANNOT_MESSAGE',
  /** No link preview for this address: not a web page, not reachable, or not allowed. */
  'PREVIEW_UNAVAILABLE',
  /** Already 10 folders. */
  'FOLDER_LIMIT_REACHED',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  /** Human-readable message, safe to show to the user. */
  message: z.string().min(1),
  /** Correlates the error with server logs. */
  requestId: z.string().min(1),
  /** Extra structured context, e.g. per-field validation issues. */
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
