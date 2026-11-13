import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuietHours } from '@zuvo/protocol';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { QUIET_HOURS_KEY, quietHoursApi } from '../api';
import { initialForm, quietProblem, timezoneOptions } from '../rules';
import { DayToggles } from './DayToggles';
import { QuietChatPicker } from './QuietChatPicker';
import { Switch } from './Switch';

const MODES = ['off', 'on', 'scheduled'] as const;

function TimeField(props: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1 text-sm font-medium">
      <label htmlFor={id} className="block">
        {props.label}
      </label>
      <Input
        id={id}
        type="time"
        value={props.value}
        required
        onChange={(event) => (event.target.value ? props.onChange(event.target.value) : undefined)}
      />
    </div>
  );
}

/** Edits a copy of my quiet hours; Save sends the whole thing (PUT). */
export function QuietHoursForm({ saved }: { saved: QuietHours }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => initialForm(saved));
  const [tried, setTried] = useState(false);
  const set = (changes: Partial<QuietHours>) => setForm((current) => ({ ...current, ...changes }));
  const problem = quietProblem(form);
  const save = useMutation({
    mutationFn: (quietHours: QuietHours) => quietHoursApi.save(quietHours),
    onSuccess: ({ quietHours }) => {
      queryClient.setQueryData(QUIET_HOURS_KEY, quietHours);
      toast.success(t('quietHours.saved'));
    },
    onError: () => toast.error(t('quietHours.saveFailed')),
  });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!problem) save.mutate(form);
      }}
    >
      <SettingsSection title={t('quietHours.title')}>
        <p className="text-sm text-text-muted">{t('quietHours.hint')}</p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('quietHours.mode')}</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-subtle has-[:checked]:text-brand-text"
              >
                <input
                  type="radio"
                  name="quiet-mode"
                  checked={form.mode === mode}
                  onChange={() => set({ mode })}
                  className="accent-brand"
                />
                {t(`quietHours.modes.${mode}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {form.mode === 'scheduled' ? (
          <>
            <div className="flex flex-wrap gap-4">
              <TimeField
                label={t('quietHours.start')}
                value={form.start}
                onChange={(start) => set({ start })}
              />
              <TimeField
                label={t('quietHours.end')}
                value={form.end}
                onChange={(end) => set({ end })}
              />
            </div>
            <DayToggles days={form.days} onChange={(days) => set({ days })} />
          </>
        ) : null}
        <label className="block space-y-1 text-sm font-medium">
          <span className="block">{t('quietHours.timezone')}</span>
          <select
            value={form.timezone}
            onChange={(event) => set({ timezone: event.target.value })}
            className="h-10 w-full rounded-lg border bg-surface px-3 text-sm"
          >
            {timezoneOptions(form.timezone, saved.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </SettingsSection>
      <SettingsSection title={t('quietHours.exceptions')}>
        <Switch
          label={t('quietHours.allowMentions')}
          hint={t('quietHours.allowMentionsHint')}
          checked={form.allowMentions}
          onChange={(allowMentions) => set({ allowMentions })}
        />
        <QuietChatPicker
          picked={form.allowChatIds}
          onChange={(allowChatIds) => set({ allowChatIds })}
        />
      </SettingsSection>
      {tried && problem ? (
        <p role="alert" className="text-sm text-danger">
          {t(`quietHours.problem.${problem}`)}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
