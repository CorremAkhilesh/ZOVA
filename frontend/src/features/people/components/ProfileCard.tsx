import { useQuery } from '@tanstack/react-query';
import type { PublicProfile } from '@zuvo/protocol';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { usersApi } from '@/features/profile/api';

/** A person's public profile, as their privacy settings allow. Starting a chat comes next. */
export function ProfileCard({ person, onBack }: { person: PublicProfile; onBack: () => void }) {
  const { t } = useTranslation();
  // Fresh copy from the server (the list entry may be stale); the list entry shows meanwhile.
  const { data } = useQuery({
    queryKey: ['users', person.id],
    queryFn: async () => (await usersApi.get(person.id)).user,
    placeholderData: person,
  });
  const profile = data ?? person;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="size-4" aria-hidden />
        {t('people.back')}
      </Button>
      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar
          name={profile.displayName}
          src={profile.avatar?.large}
          className="size-28 text-3xl"
        />
        <div>
          <h3 className="text-xl font-semibold">{profile.displayName}</h3>
          {profile.username ? <p className="text-text-muted">@{profile.username}</p> : null}
        </div>
        {profile.deactivated ? (
          <p className="text-sm text-text-muted">{t('people.deactivated')}</p>
        ) : profile.about ? (
          <p className="text-sm">{profile.about}</p>
        ) : null}
      </div>
      {profile.deactivated ? null : (
        <div className="space-y-1.5">
          <Button className="w-full" disabled aria-describedby="chat-soon">
            <MessageCircle className="size-4" aria-hidden />
            {t('people.message')}
          </Button>
          <p id="chat-soon" className="text-center text-xs text-text-muted">
            {t('people.chatSoon')}
          </p>
        </div>
      )}
    </div>
  );
}
