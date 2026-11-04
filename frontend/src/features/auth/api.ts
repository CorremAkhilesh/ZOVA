import {
  requestOtpResponseSchema,
  sessionResponseSchema,
  signOutResponseSchema,
  updateProfileResponseSchema,
} from '@zuvo/protocol';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

export const authApi = {
  requestOtp: (email: string) =>
    apiPost('/v1/auth/otp/request', { email }, requestOtpResponseSchema),
  verifyOtp: (email: string, code: string) =>
    apiPost('/v1/auth/otp/verify', { email, code }, sessionResponseSchema),
  me: () => apiGet('/v1/auth/me', sessionResponseSchema),
  logout: () => apiPost('/v1/auth/logout', {}, signOutResponseSchema),
  updateProfile: (displayName: string) =>
    apiPatch('/v1/me/profile', { displayName }, updateProfileResponseSchema),
};
