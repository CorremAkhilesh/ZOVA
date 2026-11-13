import { type PublicProfile, publicProfileSchema } from '@zuvo/protocol';

const KEY = 'zuvo-recent-people';
const MAX = 5;

/** People opened recently from the picker, on this device only (a convenience, not synced). */
export const recentPeople = {
  load(): PublicProfile[] {
    try {
      const parsed = publicProfileSchema
        .array()
        .safeParse(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: nothing was saved.
    }
  },
  add(profile: PublicProfile): void {
    try {
      const next = [profile, ...this.load().filter((p) => p.id !== profile.id)].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: no recent list.
    }
  },
};
