import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AVATAR_MIME_TYPES, type MyProfile } from '@zuvo/protocol';
import { Camera, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { authErrorMessage } from '@/features/auth/errors';
import { profileApi } from '../api';
import { applyProfile } from '../queries';
import { AvatarCropDialog } from './AvatarCropDialog';

/** Raw photos straight from a phone camera can be large; they are downscaled before upload. */
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export function AvatarEditor({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = profile.displayName ?? profile.email;

  const closeCrop = () => {
    if (source) URL.revokeObjectURL(source);
    setSource(null);
  };

  const upload = useMutation({
    mutationFn: (photo: Blob) => profileApi.uploadAvatar(photo, setProgress),
    onSuccess: ({ profile: updated }) => {
      applyProfile(queryClient, updated);
      toast.success(t('profile.photo.updated'));
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
    onSettled: () => setProgress(null),
  });

  const remove = useMutation({
    mutationFn: profileApi.removeAvatar,
    onSuccess: ({ profile: updated }) => {
      applyProfile(queryClient, updated);
      setConfirmRemove(false);
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  function choose(file: File | undefined) {
    if (!file) return;
    const allowed =
      (AVATAR_MIME_TYPES as readonly string[]).includes(file.type) || file.type === 'image/heif';
    if (!allowed) return void toast.error(t('profile.photo.wrongType'));
    if (file.size > MAX_SOURCE_BYTES) return void toast.error(t('profile.photo.tooLarge'));
    setSource(URL.createObjectURL(file));
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={name} src={profile.avatar?.large} className="size-24 text-2xl" />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            <Camera className="size-4" aria-hidden />
            {profile.avatar ? t('profile.photo.change') : t('profile.photo.add')}
          </Button>
          {profile.avatar ? (
            <Button variant="danger-outline" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('profile.photo.remove')}
            </Button>
          ) : null}
        </div>
        {progress !== null ? (
          <div
            role="progressbar"
            aria-label={t('profile.photo.uploading')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1.5 w-48 overflow-hidden rounded-full bg-background"
          >
            <div
              className="h-full bg-brand transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        ) : (
          <p className="text-xs text-text-muted">{t('profile.photo.hint')}</p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={[...AVATAR_MIME_TYPES, 'image/heif'].join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <AvatarCropDialog
        src={source}
        onCancel={closeCrop}
        onCropped={(photo) => {
          closeCrop();
          upload.mutate(photo);
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('profile.photo.removeTitle')}
        description={t('profile.photo.removeBody')}
        confirmLabel={t('profile.photo.remove')}
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
        danger
      />
    </div>
  );
}
