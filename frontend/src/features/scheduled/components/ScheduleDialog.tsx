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
  | {
      /** Files or a voice note: uploaded when the time is picked, then scheduled. */
      mode: 'media';
      /** What is being scheduled, in a line ("📷 Photo", "🎤 Voice message (0:12)"). */
      summary: string;
      schedule: (at: Date, onProgress: (fraction: number) => void) => Promise<void>;
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

/** What a new one says, shown above the time; null when editing (the text is a field then). */
function previewOf(props: ScheduleDialogProps): string | null {
  if (props.mode === 'create') return props.draft.text;
  return props.mode === 'media' ? props.summary : null;
}

/** Schedules a new one (text, or files uploaded first), or saves the changes to one waiting. */
async function save(
  props: ScheduleDialogProps,
  at: Date,
  text: string,
  onProgress: (fraction: number) => void,
) {
  if (props.mode === 'create') {
    await scheduledApi.create(createBody(props.chatId, props.draft, at));
    props.onDone();
    return;
  }
  if (props.mode === 'media') {
    onProgress(0);
    await props.schedule(at, onProgress);
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
  const [progress, setProgress] = useState<number | null>(null);
  const textMax = editing?.media ? CAPTION_MAX : TEXT_MAX;
  const textMissing = editing !== null && !editing.media && text.trim().length === 0;

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
      await save(props, at, text, setProgress);
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
      setProgress(null);
    }
  }

  const preview = previewOf(props);
  return (
    // Not while a file is on its way: closing would leave it half done.
    <Dialog open onOpenChange={(open) => (open || progress !== null ? undefined : props.onClose())}>
      <DialogContent title={t(editing ? 'scheduled.editTitle' : 'scheduled.title')}>
        <form className="flex min-h-0 flex-col gap-4" onSubmit={submit} noValidate>
          {preview !== null ? (
            <p className="line-clamp-3 rounded-xl border-l-4 border-brand bg-surface px-3 py-2 text-sm break-words whitespace-pre-line">
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
                className="w-full resize-none rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20"
              />
            </div>
          )}
          <SendAtFields sendAt={sendAt} />
          {progress !== null ? (
            <p role="status" className="text-sm text-text-muted">
              {t('scheduled.uploading', { percent: Math.round(progress * 100) })}
            </p>
          ) : null}
          {failure ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {failure}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={progress !== null}
              onClick={props.onClose}
            >
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
