import {
  myProfileResponseSchema,
  type PrivacySettings,
  privacyResponseSchema,
  publicProfileResponseSchema,
  usernameAvailabilityResponseSchema,
  usernameSuggestionResponseSchema,
  userSearchResponseSchema,
} from '@zuvo/protocol';
import { apiDelete, apiGet, apiPatch, apiPut, apiUpload, withQuery } from '@/lib/api-client';

export const profileApi = {
  get: () => apiGet('/v1/me/profile', myProfileResponseSchema),
  update: (changes: { displayName?: string; about?: string }) =>
    apiPatch('/v1/me/profile', changes, myProfileResponseSchema),
  setUsername: (username: string) =>
    apiPut('/v1/me/username', { username }, myProfileResponseSchema),
  suggestUsername: () => apiGet('/v1/me/username-suggestion', usernameSuggestionResponseSchema),
  usernameAvailability: (username: string) =>
    apiGet(
      withQuery('/v1/users/username-availability', { username }),
      usernameAvailabilityResponseSchema,
    ),
  uploadAvatar: (file: Blob, onProgress?: (fraction: number) => void) =>
    apiUpload('/v1/me/avatar', file, myProfileResponseSchema, onProgress),
  removeAvatar: () => apiDelete('/v1/me/avatar', myProfileResponseSchema),
  privacy: () => apiGet('/v1/me/privacy', privacyResponseSchema),
  setPrivacy: (privacy: PrivacySettings) =>
    apiPut('/v1/me/privacy', privacy, privacyResponseSchema),
};

export const usersApi = {
  search: (q: string, cursor?: string) =>
    apiGet(withQuery('/v1/users/search', { q, cursor, limit: 20 }), userSearchResponseSchema),
  get: (id: string) => apiGet(`/v1/users/${id}`, publicProfileResponseSchema),
};
