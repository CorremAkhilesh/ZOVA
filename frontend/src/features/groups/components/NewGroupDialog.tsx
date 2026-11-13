import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AVATAR_MIME_TYPES,
  GROUP_DESCRIPTION_MAX,
  GROUP_MEMBERS_MAX,
  GROUP_NAME_MAX,
  type PublicProfile,
} from '@zuvo/protocol';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { authErrorMessage } from '@/features/auth/errors';
import { useLocalDb } from '@/features/chats/queries';
import { applyChats } from '@/features/sync/apply';
import { groupsApi } from '../api';
import { useNewGroup } from '../rules';
import { PeopleSelect } from './PeopleSelect';

/** New group: who is in it, then what it is called. */
export function NewGroupDialog() {
  const { t } = useTranslation();
  const open = useNewGroup((state) => state.isOpen);
  const setOpen = useNewGroup((state) => state.setOpen);
  const [step, setStep] = useState<'people' | 'details'>('people');
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const db = useLocalDb();
  const navigate = useNavigate();

  const close = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setStep('people');
    setPeople([]);
    setName('');
    setDescription('');
    setPhoto(null);
  };

  const create = useMutation({
    mutationFn: async () => {
      let chat = await groupsApi.create({
        name: name.trim(),
        description: description.trim(),
        memberIds: people.map((person) => person.id),
      });
      // The group exists either way: a photo that fails should not lose it.
      if (photo) {
        chat = await groupsApi.setPhoto(chat.id, photo).catch((error: unknown) => {
          toast.error(authErrorMessage(error, t));
          return chat;
        });
      }
      if (db) await applyChats(db, [chat]);
      return chat.id;
    },
    onSuccess: (chatId) => {
      close(false);
      void navigate({ to: '/chats/$chatId', params: { chatId } });
    },
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={step === 'people' ? t('groups.newTitle') : t('groups.detailsTitle')}
        className="max-w-lg"
      >
        {step === 'people' ? (
          <>
            <PeopleSelect selected={people} onChange={setPeople} max={GROUP_MEMBERS_MAX - 1} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-text-muted">
                {t('groups.memberPicked', { count: people.length })}
              </p>
              <Button onClick={() => setStep('details')}>{t('groups.next')}</Button>
            </div>
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <div className="space-y-1">
              <label htmlFor="new-group-name" className="block text-sm font-medium">
                {t('groups.name')}
              </label>
              <Input
                id="new-group-name"
                value={name}
                maxLength={GROUP_NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <label className="block space-y-1 text-sm font-medium">
              {t('groups.description')}
              <textarea
                value={description}
                maxLength={GROUP_DESCRIPTION_MAX}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full resize-none rounded-lg border bg-surface px-3 py-2 text-sm font-normal outline-none focus-visible:border-brand-text"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Camera className="size-4" aria-hidden />
              {photo ? photo.name : t('groups.addPhoto')}
              <input
                type="file"
                accept={AVATAR_MIME_TYPES.join(',')}
                className="sr-only"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              />
            </label>
            {create.isError ? (
              <p role="alert" className="text-sm text-danger">
                {authErrorMessage(create.error, t)}
              </p>
            ) : null}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('people')}>
                {t('groups.back')}
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {t('groups.create')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
