import type { ErrorCode } from '@zuvo/protocol';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  EMAIL_DOMAIN_NOT_ALLOWED: 403,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_ATTEMPTS_EXCEEDED: 429,
  SESSION_EXPIRED: 401,
  ACCOUNT_DEACTIVATED: 403,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  UNSUPPORTED_MEDIA_TYPE: 415,
  USERNAME_TAKEN: 409,
  USERNAME_CHANGE_TOO_SOON: 409,
  SECURITY_TOKEN_INVALID: 400,
  SECURITY_TOKEN_EXPIRED: 400,
  LAST_ADMIN: 409,
};

/** An expected error whose message is safe to show to the client. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/** Maps an HTTP status from Fastify or a plugin to the closest error code. */
export function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'INTERNAL_ERROR';
}
