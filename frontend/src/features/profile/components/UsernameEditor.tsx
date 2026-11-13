import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type MyProfile, USERNAME_CHANGE_INTERVAL_DAYS } from '@zuvo/protocol';
import { Check, Pencil, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authErrorMessage } from '@/features/auth/errors';
import { profileApi } from '../api';
import { applyProfile } from '../queries';
import { useUsernameCheck } from '../use-username-check';
import { UsernameField } from './UsernameField';

const DAY_MS = 86_400_000;

/** When the username may change again (null = now). */
export function nextUsernameChange(profile: MyProfile, now = Date.now()): Date | null {
  if (!profile.username || !profile.usernameChangedAt) return null;
  const next = Date.parse(profile.usernameChangedAt) + USERNAME_CHANGE_INTERVAL_DAYS * DAY_MS;
  return next > now ? new Date(next) : null;
}

export function UsernameEditor({ profile }: { profile: MyProfile }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const check = useUsernameCheck(draft ?? '', profile.username);
  const lockedUntil = nextUsernameChange(profile);

  const save = useMutation({
    mutationFn: (username: string) => profileApi.setUsername(username),
    onSuccess: ({ profile: saved }) => {
      applyProfile(queryClient, saved);
      setDraft(null);
      toast.success(t('profile.username.saved'));
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (check.status.state === 'unchanged') return setDraft(null);
    if (check.status.state !== 'available') return;
    save.mutate(check.username);
  }

  const lockedText = lockedUntil
    ? t('profile.username.lockedUntil', {
        date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(lockedUntil),
      })
    : t('profile.username.changeRule', { days: USERNAME_CHANGE_INTERVAL_DAYS });

  if (draft === null) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text-muted">{t('profile.username.label')}</p>
          <p className="font-medium">{profile.username ? `@${profile.username}` : '—'}</p>
          <p className="mt-1 text-xs text-text-muted">{lockedText}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={Boolean(lockedUntil)}
          aria-label={t('profile.edit', { field: t('profile.username.label') })}
          onClick={() => setDraft(profile.username ?? '')}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <label htmlFor="username-edit" className="text-sm text-text-muted">
        {t('profile.username.label')}
      </label>
      <UsernameField
        id="username-edit"
        value={draft}
        onChange={setDraft}
        status={check.status}
        autoFocus
      />
      <p className="text-xs text-text-muted">{lockedText}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
          <X className="size-4" aria-hidden />
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending || !['available', 'unchanged'].includes(check.status.state)}
        >
          <Check className="size-4" aria-hidden />
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
