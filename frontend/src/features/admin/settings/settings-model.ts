import {
  type AdminSettingsResponse,
  APP_SETTING_KEYS,
  type AppSettingKey,
  type AppSettings,
  appSettingsSchema,
} from '@zuvo/protocol';

/** How each setting is edited: a size in GB (stored in MiB), a plain number, on/off, or a choice. */
export const KIND: Record<AppSettingKey, 'gb' | 'number' | 'toggle' | 'calls' | 'days'> = {
  mediaUserQuotaMb: 'gb',
  mediaMaxFileMb: 'gb',
  storageGuardPercent: 'number',
  calls: 'calls',
  status: 'toggle',
  groupMaxMembers: 'number',
  linkPreviews: 'toggle',
  adminChatUserCanReply: 'toggle',
  otpIpLimitPerHour: 'number',
  otpFailuresPerEmailPerDay: 'number',
  autoCleanupDays: 'days',
};

/** What the form holds while editing: text for numbers, as typed; booleans; the calls choice. */
export type FieldValue = string | boolean;
export type Draft = Partial<Record<AppSettingKey, FieldValue>>;

const trimNumber = (value: number) => String(Math.round(value * 100) / 100);

/** A stored value as the form shows it. */
export function toField(key: AppSettingKey, value: AppSettings[AppSettingKey]): FieldValue {
  const kind = KIND[key];
  if (kind === 'toggle') return Boolean(value);
  if (kind === 'calls') return String(value);
  if (kind === 'gb') return trimNumber(Number(value) / 1024);
  if (kind === 'days') return value === null ? '' : String(value);
  return String(value);
}

/** The form's value as stored, or `undefined` while it is not a valid value. */
export function fromField(
  key: AppSettingKey,
  field: FieldValue,
): AppSettings[AppSettingKey] | undefined {
  const kind = KIND[key];
  let value: unknown = field;
  if (kind === 'gb' || kind === 'number' || kind === 'days') {
    const text = String(field).trim().replace(',', '.');
    if (kind === 'days' && text === '') value = null;
    else if (text === '' || Number.isNaN(Number(text))) return undefined;
    else value = kind === 'gb' ? Math.round(Number(text) * 1024) : Number(text);
  }
  const parsed = appSettingsSchema.shape[key].safeParse(value);
  return parsed.success ? (parsed.data as AppSettings[AppSettingKey]) : undefined;
}

export interface Pending {
  changes: Partial<AppSettings>;
  reset: AppSettingKey[];
  invalid: AppSettingKey[];
}

/** What saving would do: changed values, settings put back to default, and fields not valid yet. */
export function pendingOf(
  data: AdminSettingsResponse,
  draft: Draft,
  reset: Set<AppSettingKey>,
): Pending {
  const changes: Partial<AppSettings> = {};
  const invalid: AppSettingKey[] = [];
  for (const key of APP_SETTING_KEYS) {
    if (reset.has(key) || !(key in draft)) continue;
    const value = fromField(key, draft[key] as FieldValue);
    if (value === undefined) invalid.push(key);
    else if (value !== data.values[key]) (changes as Record<string, unknown>)[key] = value;
  }
  return {
    changes,
    reset: [...reset].filter((key) => data.overridden.includes(key)),
    invalid,
  };
}
