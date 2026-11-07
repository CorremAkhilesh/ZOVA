import { useQuery } from '@tanstack/react-query';
import type { PublicProfile } from '@zuvo/protocol';
import { ArrowLeft, Flag, ShieldBan, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useBlockToggle, useIsBlocked } from '@/features/moderation/blocks';
import { useModeration } from '@/features/moderation/store';
import { usersApi } from '@/features/profile/api';

/** A person's public profile, as their privacy settings allow. */
export function ProfileCard({ person, onBack }: { person: PublicProfile; onBack?: () => void }) {
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
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="size-4" aria-hidden />
          {t('people.back')}
        </Button>
      ) : null}
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
      {profile.deactivated ? null : <ProfileActions person={profile} />}
    </div>
  );
}

/** Block / Unblock and Report, under someone's profile. */
function ProfileActions({ person }: { person: PublicProfile }) {
  const { t } = useTranslation();
  const blocked = useIsBlocked(person.id);
  const toggle = useBlockToggle();
  const { askBlock, openReport } = useModeration.getState();
  return (
    <div className="flex justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="text-danger"
        disabled={blocked === undefined}
        onClick={() => (blocked ? toggle.mutate({ user: person, block: false }) : askBlock(person))}
      >
        {blocked ? (
          <ShieldCheck className="size-4" aria-hidden />
        ) : (
          <ShieldBan className="size-4" aria-hidden />
        )}
        {t(blocked ? 'blocks.unblock' : 'blocks.block')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-danger"
        onClick={() => openReport({ target: { kind: 'user', userId: person.id }, person })}
      >
        <Flag className="size-4" aria-hidden />
        {t('report.report')}
      </Button>
    </div>
  );
}
