import {
  requestOtpResponseSchema,
  sessionResponseSchema,
  signOutResponseSchema,
} from '@zuvo/protocol';
import { apiGet, apiPost } from '@/lib/api-client';

export const authApi = {
  requestOtp: (email: string) =>
    apiPost('/v1/auth/otp/request', { email }, requestOtpResponseSchema),
  verifyOtp: (email: string, code: string) =>
    apiPost('/v1/auth/otp/verify', { email, code }, sessionResponseSchema),
  me: () => apiGet('/v1/auth/me', sessionResponseSchema),
  logout: () => apiPost('/v1/auth/logout', {}, signOutResponseSchema),
};
