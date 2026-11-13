import { useQueryClient } from '@tanstack/react-query';
import {
  CAPTION_MAX,
  type CreateScheduledBody,
  type Mention,
  type ScheduledMessage,
} from '@zuvo/protocol';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SCHEDULED_KEY, scheduledApi } from '../api';
import { scheduleErrorText } from '../errors';
import { formatSendAt } from '../time';
import { useSendAt } from '../use-send-at';
import { SendAtFields } from './SendAtFields';

/** What the composer hands over: its text, and in a group who it mentions. */
export interface ScheduleDraft {
  text: string;
  mentions?: Mention[] | undefined;
  mentionsEveryone?: boolean | undefined;
}

export type ScheduleDialogProps =
  | {
      mode: 'create';
      chatId: string;
      draft: ScheduleDraft;
      onDone: () => void;
      onClose: () => void;
    }
  | { mode: 'edit'; item: ScheduledMessage; onClose: () => void };

const TEXT_MAX = 4096;

function createBody(chatId: string, draft: ScheduleDraft, sendAt: Date): CreateScheduledBody {
  return {
    chatId,
    text: draft.text,
    sendAt: sendAt.toISOString(),
    ...(draft.mentions?.length ? { mentions: draft.mentions } : {}),
    ...(draft.mentionsEveryone ? { mentionsEveryone: true } : {}),
  };
}

/** Pick when a message goes (and, for one already scheduled, change its text). */
export default function ScheduleDialog(props: ScheduleDialogProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const editing = props.mode === 'edit' ? props.item : null;
  const sendAt = useSendAt(editing ? new Date(editing.sendAt) : null);
  const [text, setText] = useState(editing?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const textMax = editing?.media ? CAPTION_MAX : TEXT_MAX;
  const textMissing = editing !== null && !editing.media && text.trim().length === 0;

  async function save(at: Date) {
    if (props.mode === 'create') {
      await scheduledApi.create(createBody(props.chatId, props.draft, at));
      props.onDone();
      return;
    }
    const changes: { text?: string; sendAt?: string } = {};
    if (text !== (props.item.text ?? '')) changes.text = text;
    if (at.getTime() !== Date.parse(props.item.sendAt)) changes.sendAt = at.toISOString();
    if (changes.text !== undefined || changes.sendAt !== undefined) {
      await scheduledApi.update(props.item.id, changes);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Rendered from inside the composer: its form must not see this submit too (portals keep the tree).
    event.stopPropagation();
    if (textMissing) return;
    const at = sendAt.resolve();
    if (!at) return;
    setBusy(true);
    setFailure(null);
    try {
      await save(at);
      void queryClient.invalidateQueries({ queryKey: SCHEDULED_KEY });
      toast.success(
        t(editing ? 'scheduled.saved' : 'scheduled.done', {
          time: formatSendAt(at, i18n.language, sendAt.zone),
        }),
      );
      props.onClose();
    } catch (error) {
      setFailure(scheduleErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  const preview = props.mode === 'create' ? props.draft.text : null;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent title={t(editing ? 'scheduled.editTitle' : 'scheduled.title')}>
        <form className="flex min-h-0 flex-col gap-4" onSubmit={submit} noValidate>
          {preview !== null ? (
            <p className="line-clamp-3 rounded-xl border-l-4 border-brand bg-surface px-3 py-2 text-sm break-words">
              {preview}
            </p>
          ) : (
            <div className="space-y-1">
              <label htmlFor={`${id}-text`} className="text-sm font-medium">
                {t(editing?.media ? 'scheduled.caption' : 'scheduled.text')}
              </label>
              <textarea
                id={`${id}-text`}
                value={text}
                maxLength={textMax}
                rows={3}
                aria-invalid={textMissing}
                onChange={(event) => setText(event.target.value)}
                className="w-full resize-none rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
              />
            </div>
          )}
          <SendAtFields sendAt={sendAt} />
          {failure ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {failure}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || textMissing}>
              {t(editing ? 'common.save' : 'scheduled.schedule')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
