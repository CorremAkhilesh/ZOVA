import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSettingsResponse, AppSettingKey } from '@zuvo/protocol';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { AdminPage } from '../components/AdminLayout';
import { ReasonDialog } from '../users/ReasonDialog';
import { adminSettingsApi, adminSettingsKey } from './api';
import { Choice, NumberInput, SettingRow, Toggle } from './SettingFields';
import { type Draft, type FieldValue, fromField, KIND, pendingOf, toField } from './settings-model';

const SECTIONS: Array<{ key: string; settings: AppSettingKey[] }> = [
  { key: 'storage', settings: ['mediaUserQuotaMb', 'mediaMaxFileMb', 'storageGuardPercent'] },
  {
    key: 'features',
    settings: ['calls', 'status', 'linkPreviews', 'adminChatUserCanReply', 'groupMaxMembers'],
  },
  { key: 'signIn', settings: ['otpIpLimitPerHour', 'otpFailuresPerEmailPerDay'] },
];

function Form({ data }: { data: AdminSettingsResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [reset, setReset] = useState<Set<AppSettingKey>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const pending = pendingOf(data, draft, reset);
  const count = Object.keys(pending.changes).length + pending.reset.length;

  const fieldOf = (key: AppSettingKey): FieldValue =>
    key in draft
      ? (draft[key] as FieldValue)
      : toField(key, reset.has(key) ? data.defaults[key] : data.values[key]);
  const set = (key: AppSettingKey, value: FieldValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setReset((current) => new Set([...current].filter((item) => item !== key)));
  };
  const backToDefault = (key: AppSettingKey) => {
    setDraft(({ [key]: _, ...rest }) => rest);
    setReset((current) => new Set([...current, key]));
  };
  const shown = (key: AppSettingKey, value: unknown) => {
    const kind = KIND[key];
    if (kind === 'toggle') return t(value ? 'adminPanel.settings.on' : 'adminPanel.settings.off');
    if (kind === 'calls') return t(`adminPanel.settings.calls.${value}`);
    if (kind === 'gb') return t('adminPanel.settings.gb', { value: toField(key, value as number) });
    if (kind === 'days') {
      return value === null
        ? t('adminPanel.settings.never')
        : t('adminPanel.settings.days', { count: value as number });
    }
    return String(value);
  };

  const save = useMutation({
    mutationFn: (reason: string) =>
      adminSettingsApi.save({ changes: pending.changes, reset: pending.reset, reason }),
    onSuccess: (next) => {
      queryClient.setQueryData(adminSettingsKey, next);
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      setDraft({});
      setReset(new Set());
      setConfirming(false);
      toast.success(t('admin.saved'));
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  const row = (key: AppSettingKey) => {
    const kind = KIND[key];
    const value = fieldOf(key);
    const invalid = key in draft && fromField(key, value) === undefined;
    const overridden = (data.overridden.includes(key) && !reset.has(key)) || key in draft;
    return (
      <SettingRow
        key={key}
        label={t(`adminPanel.settings.fields.${key}.label`)}
        hint={t(`adminPanel.settings.fields.${key}.hint`)}
        defaultText={shown(key, data.defaults[key])}
        overridden={overridden}
        onReset={() => backToDefault(key)}
        error={invalid ? t(`adminPanel.settings.fields.${key}.invalid`) : null}
        control={({ id, describedBy }) =>
          kind === 'toggle' ? (
            <Toggle
              id={id}
              describedBy={describedBy}
              checked={value === true}
              onChange={(next) => set(key, next)}
            />
          ) : kind === 'calls' ? (
            <Choice
              id={id}
              describedBy={describedBy}
              value={String(value)}
              onChange={(next) => set(key, next)}
              options={['all', 'admins', 'off'].map((option) => ({
                value: option,
                label: t(`adminPanel.settings.calls.${option}`),
              }))}
            />
          ) : (
            <NumberInput
              id={id}
              describedBy={describedBy}
              value={String(value)}
              invalid={invalid}
              unit={t(`adminPanel.settings.fields.${key}.unit`)}
              onChange={(next) => set(key, next)}
            />
          )
        }
      />
    );
  };

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => (
        <section
          key={section.key}
          aria-labelledby={`settings-${section.key}`}
          className="rounded-2xl border bg-surface p-5 shadow-sm"
        >
          <h2 id={`settings-${section.key}`} className="mb-4 text-lg font-semibold">
            {t(`adminPanel.settings.sections.${section.key}`)}
          </h2>
          <div className="divide-y">{section.settings.map(row)}</div>
        </section>
      ))}
      <section
        aria-labelledby="settings-cleanup"
        className="space-y-3 rounded-2xl border border-danger/40 bg-surface p-5 shadow-sm"
      >
        <h2 id="settings-cleanup" className="flex items-center gap-2 text-lg font-semibold">
          <TriangleAlert className="size-5 text-danger" aria-hidden />
          {t('adminPanel.settings.sections.cleanup')}
        </h2>
        <p className="text-sm text-text-muted">{t('adminPanel.settings.cleanupWarning')}</p>
        <div className="divide-y">{row('autoCleanupDays')}</div>
      </section>
      {count > 0 || pending.invalid.length > 0 ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <p className="mr-auto text-sm text-text-muted" aria-live="polite">
            {pending.invalid.length > 0
              ? t('adminPanel.settings.fixFirst')
              : t('adminPanel.settings.changes', { count })}
          </p>
          <Button
            variant="ghost"
            disabled={count === 0 && pending.invalid.length === 0}
            onClick={() => {
              setDraft({});
              setReset(new Set());
            }}
          >
            {t('adminPanel.settings.discard')}
          </Button>
          <Button
            disabled={count === 0 || pending.invalid.length > 0}
            onClick={() => setConfirming(true)}
          >
            {t('adminPanel.settings.save')}
          </Button>
        </div>
      ) : null}
      <ReasonDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('adminPanel.settings.confirmTitle', { count })}
        description={[
          ...Object.entries(pending.changes).map(([key, value]) =>
            t('adminPanel.settings.changeLine', {
              setting: t(`adminPanel.settings.fields.${key}.label`),
              from: shown(key as AppSettingKey, data.values[key as AppSettingKey]),
              to: shown(key as AppSettingKey, value),
            }),
          ),
          ...pending.reset.map((key) =>
            t('adminPanel.settings.resetLine', {
              setting: t(`adminPanel.settings.fields.${key}.label`),
              to: shown(key, data.defaults[key]),
            }),
          ),
        ].join(' · ')}
        confirmLabel={t('adminPanel.settings.save')}
        danger={'autoCleanupDays' in pending.changes && pending.changes.autoCleanupDays !== null}
        pending={save.isPending}
        onConfirm={(reason) => save.mutate(reason)}
      />
    </div>
  );
}

/** Admin → Settings: what the organization can change without code, each with its default. */
export default function AdminSettingsPage() {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: adminSettingsKey, queryFn: adminSettingsApi.get });
  const updated = query.data?.updatedAt
    ? t('adminPanel.settings.updated', {
        when: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(query.data.updatedAt)),
        by: query.data.updatedBy ?? '',
      })
    : undefined;
  return (
    <AdminPage
      title={t('adminPanel.settings.title')}
      description={updated ?? t('adminPanel.settings.subtitle')}
    >
      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="space-y-3 rounded-2xl border bg-surface p-5">
          <p className="text-sm">{t('admin.loadFailed')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('adminPanel.dashboard.retry')}
          </Button>
        </div>
      ) : (
        <div className="max-w-3xl">
          <Form key={query.data.updatedAt ?? 'defaults'} data={query.data} />
        </div>
      )}
    </AdminPage>
  );
}
