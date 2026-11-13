import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { displayNameSchema } from '@zuvo/protocol';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { profileApi } from '@/features/profile/api';
import { UsernameField } from '@/features/profile/components/UsernameField';
import { applyProfile } from '@/features/profile/queries';
import { useUsernameCheck } from '@/features/profile/use-username-check';
import { authErrorMessage } from '../errors';
import { useSession } from '../session';
import { AuthCard, FormError } from './AuthCard';

/** First login (or an account without a username): choose a display name and an @username. */
export function NameStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSession()?.user;
  const [name, setName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [touched, setTouched] = useState(Boolean(user?.username));
  const [clientError, setClientError] = useState('');
  const check = useUsernameCheck(username);

  // Suggest "@akhilesh" (or "@akhilesh2") from the email until the user types their own.
  const suggestion = useQuery({
    queryKey: ['me', 'username-suggestion'],
    queryFn: profileApi.suggestUsername,
    enabled: !touched,
    staleTime: Number.POSITIVE_INFINITY,
  });
  useEffect(() => {
    if (!touched && suggestion.data) setUsername(suggestion.data.username);
  }, [touched, suggestion.data]);

  const save = useMutation({
    mutationFn: async (input: { displayName: string; username: string }) => {
      if (input.displayName !== user?.displayName) {
        await profileApi.update({ displayName: input.displayName });
      }
      return (await profileApi.setUsername(input.username)).profile;
    },
    onSuccess: (profile) => {
      applyProfile(queryClient, profile);
      void navigate({ to: '/chats' });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setClientError(t('auth.nameRequired'));
      return;
    }
    if (check.status.state === 'problem' || !check.username) {
      setClientError(t('profile.username.fix'));
      return;
    }
    setClientError('');
    save.mutate({ displayName: parsed.data, username: check.username });
  }

  const error = clientError || (save.isError ? authErrorMessage(save.error, t) : '');

  return (
    <AuthCard title={t('auth.nameTitle')} subtitle={t('auth.nameSubtitle')}>
      <form className="space-y-3" onSubmit={submit} noValidate>
        <label htmlFor="display-name" className="text-sm font-medium">
          {t('auth.nameLabel')}
        </label>
        <Input
          id="display-name"
          autoComplete="name"
          autoFocus
          maxLength={50}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('auth.namePlaceholder')}
          aria-invalid={Boolean(clientError) && !displayNameSchema.safeParse(name).success}
        />
        <label htmlFor="username" className="block pt-1 text-sm font-medium">
          {t('profile.username.label')}
        </label>
        <UsernameField
          id="username"
          value={username}
          onChange={(value) => {
            setTouched(true);
            setUsername(value);
          }}
          status={check.status}
        />
        {error ? <FormError id="name-error">{error}</FormError> : null}
        <Button type="submit" className="w-full" size="lg" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t('auth.nameContinue')}
        </Button>
      </form>
    </AuthCard>
  );
}
