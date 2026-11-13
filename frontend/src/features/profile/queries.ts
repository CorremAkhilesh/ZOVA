import { type QueryClient, queryOptions } from '@tanstack/react-query';
import type { MyProfile } from '@zuvo/protocol';
import { sessionQuery, setSignedIn } from '@/features/auth/session';
import { profileApi } from './api';

export const myProfileQuery = queryOptions({
  queryKey: ['me', 'profile'],
  queryFn: async () => (await profileApi.get()).profile,
});

export const privacyQuery = queryOptions({
  queryKey: ['me', 'privacy'],
  queryFn: async () => (await profileApi.privacy()).privacy,
});

/** Stores a fresh profile and mirrors it into the session user (rail avatar, name, …). */
export function applyProfile(queryClient: QueryClient, profile: MyProfile) {
  queryClient.setQueryData(myProfileQuery.queryKey, profile);
  const state = queryClient.getQueryData(sessionQuery.queryKey);
  if (state?.status !== 'signed-in') return;
  const user = {
    ...state.data.user,
    displayName: profile.displayName,
    username: profile.username,
    about: profile.about,
    avatar: profile.avatar,
    language: profile.language,
  };
  setSignedIn(queryClient, {
    ...state.data,
    user,
    needsProfile: !user.displayName || !user.username,
  });
}
