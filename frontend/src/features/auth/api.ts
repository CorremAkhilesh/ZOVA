import {
  requestOtpResponseSchema,
  sessionResponseSchema,
  signOutResponseSchema,
} from '@zuvo/protocol';
import { apiGet, apiPost, apiRequest } from '@/lib/api-client';
import { i18n } from '@/lib/i18n';

export const authApi = {
  /** Accept-Language: an address with no account yet gets its code in the app's language. */
  requestOtp: (email: string) =>
    apiRequest('/v1/auth/otp/request', requestOtpResponseSchema, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': i18n.resolvedLanguage === 'hi' ? 'hi' : 'en',
      },
      body: JSON.stringify({ email }),
    }),
  verifyOtp: (email: string, code: string) =>
    apiPost('/v1/auth/otp/verify', { email, code }, sessionResponseSchema),
  me: () => apiGet('/v1/auth/me', sessionResponseSchema),
  logout: () => apiPost('/v1/auth/logout', {}, signOutResponseSchema),
};
