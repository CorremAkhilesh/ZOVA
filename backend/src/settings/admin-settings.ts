import {
  type AdminSettingsResponse,
  APP_SETTING_KEYS,
  type AppSettingKey,
  type AppSettings,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type Actor, audit } from '../admin/admin.service.ts';
import { chatModels } from '../chats/chats.service.ts';
import { destroyMedia } from '../media/media.service.ts';

/** GET /v1/admin/settings: what applies, the defaults, and which ones an admin changed. */
export async function adminSettings(app: FastifyInstance): Promise<AdminSettingsResponse> {
  const saved = await app.settings.saved();
  return {
    values: { ...app.settings.defaults(), ...saved.values },
    defaults: app.settings.defaults(),
    overridden: APP_SETTING_KEYS.filter((key) => key in saved.values),
    updatedAt: saved.updatedAt?.toISOString() ?? null,
    updatedBy: saved.updatedBy,
  };
}

/** How a value reads in the audit log: on/off, numbers, or "never". */
const auditValue = (value: AppSettings[AppSettingKey] | undefined) => {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value === null || value === undefined) return null;
  return value;
};

/**
 * PUT /v1/admin/settings: saves the changes, puts `reset` ones back to their default, applies them
 * in this process at once (others within 10 seconds), and audits each setting that changed, with
 * its old and new value.
 */
export async function updateSettings(
  app: FastifyInstance,
  actor: Actor,
  body: {
    changes: { [K in AppSettingKey]?: AppSettings[K] | undefined };
    reset: AppSettingKey[];
    reason: string;
  },
): Promise<AdminSettingsResponse> {
  const saved = await app.settings.saved();
  const defaults = app.settings.defaults();
  const before: AppSettings = { ...defaults, ...saved.values };
  const given = Object.fromEntries(
    Object.entries(body.changes).filter(([, value]) => value !== undefined),
  ) as Partial<AppSettings>;
  const next: Partial<AppSettings> = { ...saved.values, ...given };
  for (const key of body.reset) delete next[key];
  const after: AppSettings = { ...defaults, ...next };
  const changed = APP_SETTING_KEYS.filter(
    (key) => before[key] !== after[key] || key in saved.values !== key in next,
  );
  if (changed.length === 0) return adminSettings(app);
  await app.settings.write(next, actor.email);
  const self = { _id: new Types.ObjectId(actor.id), email: actor.email };
  for (const key of changed) {
    await audit(app, actor, 'settings.change', self, {
      reason: body.reason,
      details: {
        setting: key,
        from: auditValue(before[key]),
        to: auditValue(after[key]),
        ...(key in next ? {} : { default: 'yes' }),
      },
    });
  }
  return adminSettings(app);
}

const DAY_MS = 86_400_000;

/**
 * Admin → Settings → Auto-cleanup: deletes finished files older than the chosen number of days,
 * oldest first, a batch per run (hourly, in the worker). Off (null) by default. Their messages stay
 * and show "Media not available". Index: status + createdAt.
 */
export async function cleanupOldFiles(
  app: FastifyInstance,
  now: Date = new Date(),
  batch = 200,
): Promise<number> {
  const days = app.settings.current().autoCleanupDays;
  if (!days) return 0;
  const old = await chatModels(app)
    .Media.find({ status: 'ready', createdAt: { $lt: new Date(now.getTime() - days * DAY_MS) } })
    .sort({ createdAt: 1 })
    .limit(batch)
    .lean();
  for (const doc of old) await destroyMedia(app, doc);
  return old.length;
}
