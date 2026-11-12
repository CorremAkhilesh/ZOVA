import { describe, expect, it } from 'vitest';
import { groupSettingsSchema, updateGroupSettingsBodySchema } from './groups.ts';

describe('changing group settings', () => {
  it('keeps only what was sent, so other settings are not reset to their defaults', () => {
    expect(updateGroupSettingsBodySchema.parse({ editInfo: 'admins' })).toEqual({
      editInfo: 'admins',
    });
    expect(updateGroupSettingsBodySchema.parse({ disappearing: 'all' })).toEqual({
      disappearing: 'all',
    });
    expect(updateGroupSettingsBodySchema.safeParse({ pinMessages: 'nobody' }).success).toBe(false);
  });

  it('shows why: a partial of the full settings fills in their defaults', () => {
    // This is what the body schema used to be.
    expect(groupSettingsSchema.partial().parse({ editInfo: 'admins' })).toMatchObject({
      pinMessages: 'all',
    });
  });
});
