import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ProfileCard } from '@/features/people/components/ProfileCard';
import { usersApi } from '@/features/profile/api';
import { useMentionProfile } from './mention-marks';

/** The profile card of someone mentioned in a message. */
export default function MentionProfileDialog({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const close = useMentionProfile((state) => state.close);
  const { data, isError } = useQuery({
    queryKey: ['users', userId],
    queryFn: async () => (await usersApi.get(userId)).user,
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent title={t('mentions.profile')} hideTitle className="max-w-sm">
        {data ? (
          <ProfileCard person={data} />
        ) : (
          <p role={isError ? 'alert' : 'status'} className="text-sm text-text-muted">
            {t(isError ? 'mentions.profileFailed' : 'common.loading')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
