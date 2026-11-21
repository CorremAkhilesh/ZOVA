import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_PEOPLE_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type AnnouncementLevel,
  type PublicProfile,
} from '@zuvo/protocol';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, FULL_SCREEN_ON_PHONE } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { authErrorMessage } from '@/features/auth/errors';
import { PeopleSelect } from '@/features/groups/components/PeopleSelect';
import { REASON_MIN } from '../admin/users/ReasonDialog';
import { announcementsApi } from './api';

const FIELD =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20';
const CHECK = 'tap-target flex items-center gap-2 text-sm';

/** "2026-11-28T18:30" in the reader's time zone, for a datetime-local input. */
const localValue = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Admin → Announcements → New: what, to whom, how (banner and/or message), and why. */
export function NewAnnouncementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<AnnouncementLevel>('info');
  const [everyone, setEveryone] = useState(true);
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [banner, setBanner] = useState(true);
  const [until, setUntil] = useState('');
  const [message, setMessage] = useState(false);
  const [reason, setReason] = useState('');
  const endsAt = banner && until ? new Date(until).toISOString() : null;
  const ready =
    title.trim() !== '' &&
    body.trim() !== '' &&
    (banner || message) &&
    (everyone || people.length > 0) &&
    reason.trim().length >= REASON_MIN;

  const create = useMutation({
    mutationFn: () =>
      announcementsApi.create({
        title: title.trim(),
        body: body.trim(),
        level,
        audience: everyone
          ? { kind: 'all' }
          : { kind: 'some', userIds: people.map((person) => person.id) },
        banner,
        endsAt,
        message,
        reason: reason.trim(),
      }),
    onSuccess: ({ announcement }) => {
      toast.success(t('adminPanel.announcements.sent', { count: announcement.recipients }));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      onClose();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !create.isPending) create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent
        title={t('adminPanel.announcements.newTitle')}
        description={t('adminPanel.announcements.newHint')}
        className={`overflow-y-auto md:max-w-lg ${FULL_SCREEN_ON_PHONE}`}
      >
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-title`} className="block text-sm font-medium">
              {t('adminPanel.announcements.titleLabel')}
            </label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={ANNOUNCEMENT_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-body`} className="block text-sm font-medium">
              {t('adminPanel.announcements.bodyLabel')}
            </label>
            <textarea
              id={`${id}-body`}
              value={body}
              rows={4}
              maxLength={ANNOUNCEMENT_BODY_MAX}
              onChange={(event) => setBody(event.target.value)}
              className={FIELD}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t('adminPanel.announcements.levelLabel')}
            </legend>
            <div className="flex flex-wrap gap-4">
              {(['info', 'warning'] as const).map((value) => (
                <label key={value} className={CHECK}>
                  <input
                    type="radio"
                    name={`${id}-level`}
                    checked={level === value}
                    onChange={() => setLevel(value)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {t(`adminPanel.announcements.level.${value}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('adminPanel.announcements.toLabel')}</legend>
            <div className="flex flex-wrap gap-4">
              {[true, false].map((value) => (
                <label key={String(value)} className={CHECK}>
                  <input
                    type="radio"
                    name={`${id}-to`}
                    checked={everyone === value}
                    onChange={() => setEveryone(value)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {t(
                    value ? 'adminPanel.announcements.everyone' : 'adminPanel.announcements.chosen',
                  )}
                </label>
              ))}
            </div>
            {everyone ? null : (
              <PeopleSelect selected={people} onChange={setPeople} max={ANNOUNCEMENT_PEOPLE_MAX} />
            )}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t('adminPanel.announcements.howLabel')}
            </legend>
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={banner}
                onChange={(event) => setBanner(event.target.checked)}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t('adminPanel.announcements.asBanner')}
            </label>
            {banner ? (
              <div className="ml-6 space-y-1">
                <label htmlFor={`${id}-until`} className="block text-sm">
                  {t('adminPanel.announcements.untilLabel')}
                </label>
                <input
                  id={`${id}-until`}
                  type="datetime-local"
                  value={until}
                  min={localValue(Date.now() + 60_000)}
                  onChange={(event) => setUntil(event.target.value)}
                  className={`${FIELD} h-11 w-auto`}
                />
                <p className="text-xs text-text-muted">{t('adminPanel.announcements.untilHint')}</p>
              </div>
            ) : null}
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={message}
                onChange={(event) => setMessage(event.target.checked)}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t('adminPanel.announcements.asMessage')}
            </label>
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-reason`} className="block text-sm font-medium">
              {t('adminPanel.reason.label')}
            </label>
            <textarea
              id={`${id}-reason`}
              value={reason}
              rows={2}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby={`${id}-reason-hint`}
              className={FIELD}
            />
            <p id={`${id}-reason-hint`} className="text-xs text-text-muted">
              {t('adminPanel.reason.hint')}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || create.isPending}>
              {t('adminPanel.announcements.send')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
