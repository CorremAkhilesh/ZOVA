import { type AppSettingKey, type AppSettings, appSettingsSchema } from '@zuvo/protocol';
import { type Connection, type Model, Schema } from 'mongoose';
import { OTP_FAILURES_PER_EMAIL_PER_DAY } from '../auth/otp-throttle.ts';
import type { Env } from '../config/env.ts';

/** What applies when nothing is saved: the server's env (and a few built-in defaults). */
export function settingsFromEnv(env: Env): AppSettings {
  return {
    mediaUserQuotaMb: env.MEDIA_USER_QUOTA_MB,
    mediaMaxFileMb: env.MEDIA_MAX_FILE_MB,
    storageGuardPercent: env.STORAGE_GUARD_PERCENT,
    calls: env.CALLS_ENABLED_FOR,
    status: true,
    groupMaxMembers: 256,
    linkPreviews: true,
    adminChatUserCanReply: env.ADMIN_CHAT_USER_CAN_REPLY,
    otpIpLimitPerHour: env.OTP_IP_LIMIT_PER_HOUR,
    otpFailuresPerEmailPerDay: OTP_FAILURES_PER_EMAIL_PER_DAY,
    autoCleanupDays: null,
  };
}

/** The one saved document: only settings an admin changed, with who and when. */
export interface AppSettingsDoc {
  _id: string;
  values: Partial<AppSettings>;
  updatedAt: Date;
  updatedBy: string;
}

const settingsSchema = new Schema<AppSettingsDoc>(
  {
    _id: { type: String, required: true },
    values: { type: Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, required: true },
    updatedBy: { type: String, required: true },
  },
  { versionKey: false, autoCreate: true, collection: 'app_settings', minimize: false },
);
// Read and written by _id only ("global"): the default _id index serves both.

export function registerSettingsModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { AppSettings: model('AppSettings', settingsSchema) };
}

export const SETTINGS_ID = 'global';
/** How often each process re-reads the saved settings (another API process or the worker saved). */
export const SETTINGS_REFRESH_MS = 10_000;

/** Saved values that still pass the schema; anything else is ignored (the default applies). */
export function validSaved(saved: Partial<AppSettings> | null | undefined): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(saved ?? {})) {
    const field = appSettingsSchema.shape[key as AppSettingKey];
    if (field?.safeParse(value).success) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export interface SettingsStore {
  /** What applies now (defaults with saved values on top). Never waits. */
  current(): AppSettings;
  defaults(): AppSettings;
  /** Saved values, with who and when; read fresh. */
  saved(): Promise<{
    values: Partial<AppSettings>;
    updatedAt: Date | null;
    updatedBy: string | null;
  }>;
  /** Re-reads the saved values now. */
  refresh(): Promise<void>;
  /** Saves `values` (whole set of overrides) and applies them in this process at once. */
  write(values: Partial<AppSettings>, by: string): Promise<void>;
  close(): void;
}

/** Settings from MongoDB over env defaults, cached in memory and refreshed every 10 seconds. */
export function createSettingsStore(mongo: Connection, env: Env): SettingsStore {
  const defaults = settingsFromEnv(env);
  let overrides: Partial<AppSettings> = {};
  const { AppSettings: Settings } = registerSettingsModels(mongo);
  const read = async () => {
    const doc = await Settings.findById(SETTINGS_ID).lean();
    return doc;
  };
  const refresh = async () => {
    overrides = validSaved((await read())?.values);
  };
  const timer = setInterval(() => {
    void refresh().catch(() => undefined);
  }, SETTINGS_REFRESH_MS);
  timer.unref();
  return {
    current: () => ({ ...defaults, ...overrides }),
    defaults: () => ({ ...defaults }),
    async saved() {
      const doc = await read();
      return {
        values: validSaved(doc?.values),
        updatedAt: doc?.updatedAt ?? null,
        updatedBy: doc?.updatedBy ?? null,
      };
    },
    refresh,
    async write(values, by) {
      await Settings.updateOne(
        { _id: SETTINGS_ID },
        { $set: { values, updatedAt: new Date(), updatedBy: by } },
        { upsert: true },
      );
      overrides = validSaved(values);
    },
    close: () => clearInterval(timer),
  };
}
