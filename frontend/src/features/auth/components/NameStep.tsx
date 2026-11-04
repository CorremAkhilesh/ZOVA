import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { displayNameSchema } from '@zuvo/protocol';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '../api';
import { authErrorMessage } from '../errors';
import { sessionQuery, setSignedIn } from '../session';
import { AuthCard, FormError } from './AuthCard';

/** First login: choose a display name (the full profile comes later). */
export function NameStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [clientError, setClientError] = useState('');

  const save = useMutation({
    mutationFn: (displayName: string) => authApi.updateProfile(displayName),
    onSuccess: ({ user }) => {
      const state = queryClient.getQueryData(sessionQuery.queryKey);
      if (state?.status === 'signed-in') {
        setSignedIn(queryClient, { ...state.data, user, needsProfile: false });
      }
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
    setClientError('');
    save.mutate(parsed.data);
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
          aria-invalid={Boolean(error)}
          {...(error ? { 'aria-describedby': 'name-error' } : {})}
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
