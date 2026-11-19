import { MESSAGE_TEXT_MAX } from '@zuvo/protocol';
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortcut } from '@/features/formatting/composer-shortcut';
import { FormattingHint } from '@/features/formatting/FormattingHint';
import { ComposerLinkPreview } from '@/features/link-previews/LinkPreviewCard';
import { useLinkPreviewDraft } from '@/features/link-previews/use-link-preview-draft';
import { AttachMenu } from '@/features/media/components/AttachMenu';
import { CameraButton } from '@/features/media/components/CameraButton';
import { useMentionPicker } from '@/features/mentions/use-mention-picker';
import { ComposerBanner } from '@/features/messages/components/ComposerBanner';
import { useComposerActions } from '@/features/messages/use-composer-actions';
import { usePollComposer } from '@/features/polls/use-poll-composer';
import { ScheduleRecording } from '@/features/scheduled/components/ScheduleRecording';
import { SendButton } from '@/features/scheduled/components/SendButton';
import { useSyncStore } from '@/features/sync/store';
import { MicButton } from '@/features/voice/components/MicButton';
import { MicBlockedDialog, MicExplainDialog } from '@/features/voice/components/MicDialogs';
import { RecordingBar } from '@/features/voice/components/RecordingBar';
import { useVoiceNote } from '@/features/voice/use-voice-note';
import { useIsDesktop } from '@/lib/hooks';
import { TypingSender } from '../typing-sender';
import { useAutoGrow } from '../use-auto-grow';
import { useDraft } from '../use-draft';
import { ComposerAction } from './ComposerAction';
import { ComposerNotices } from './ComposerNotices';
import { EmojiPicker } from './EmojiPicker';

interface ComposerProps {
  chatId: string;
  onSent: () => void;
  onFiles: (files: File[]) => void;
}

/** One sender per open chat. Leaving the chat stops it. */
function useTypingSender(chatId: string) {
  const [sender] = useState(
    () => new TypingSender((typing) => useSyncStore.getState().client?.sendTyping(chatId, typing)),
  );
  useEffect(() => () => sender.stop(), [sender]);
  return sender;
}

export function Composer({ chatId, onSent, onFiles }: ComposerProps) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const client = useSyncStore((state) => state.client);
  const { text, update } = useDraft(chatId);
  const typing = useTypingSender(chatId);
  const field = useRef<HTMLTextAreaElement>(null);
  const hasText = text.trim().length > 0;
  const remaining = MESSAGE_TEXT_MAX - text.length;
  const canSend = hasText && remaining >= 0 && client !== null;
  const voice = useVoiceNote(chatId, onSent);
  const { recorder } = voice;
  const actions = useComposerActions(chatId, text, update, field);
  const link = useLinkPreviewDraft(text, !actions.editing);
  const mention = useMentionPicker(chatId, text, field, update);
  const poll = usePollComposer(chatId, onSent);
  const showHint = isDesktop && hasText && !recorder.active;

  // One line to six, then it scrolls inside (see use-auto-grow.ts).
  useAutoGrow(field, text);

  function send() {
    if (!canSend) return;
    const mentions = mention.payload(text);
    if (actions.finishEdit(mentions)) return;
    void client?.sendText(chatId, text, actions.takeReply(), { link: link.take(), ...mentions });
    typing.stop();
    update('');
    onSent();
    field.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.onKeyDown(event) || actions.onKeyDown(event) || formatShortcut(event, update))
      return;
    // isComposing: Enter is confirming a word in a Hindi (or any other) input method.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    // Phones and tablets have no Shift key to hand: Enter makes a new line, the button sends.
    if (!isDesktop) return;
    event.preventDefault();
    send();
  }

  function insertEmoji(emoji: string) {
    const element = field.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    update(`${text.slice(0, start)}${emoji}${text.slice(end)}`);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  const mode =
    hasText || actions.editing ? 'send' : recorder.active && recorder.locked ? 'none' : 'mic';
  return (
    // Same horizontal padding and max width as the message column, so they line up.
    <div className="glass border-t pt-2 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] md:px-8">
      <div className="mx-auto max-w-3xl">
        <MicExplainDialog
          open={voice.explaining}
          onAllow={voice.allowMic}
          onClose={voice.closeExplaining}
        />
        <MicBlockedDialog open={voice.blockedOpen} onClose={voice.closeBlocked} />
        <ScheduleRecording
          recording={voice.toSchedule}
          schedule={voice.schedule}
          onClose={voice.dropScheduled}
        />
        <ComposerBanner chatId={chatId} />
        {poll.dialog}
        <ComposerLinkPreview preview={link.preview} loading={link.loading} onRemove={link.remove} />
        {mention.picker}
        <ComposerNotices textLength={text.length} problem={recorder.problem} />
        <form className="flex items-end gap-2" onSubmit={onSubmit}>
          {recorder.active ? (
            <RecordingBar
              status={recorder.status}
              locked={recorder.locked}
              elapsedMs={recorder.elapsedMs}
              maxMs={voice.maxMs}
              levels={recorder.liveLevels}
              onCancel={recorder.cancel}
              onPause={recorder.pause}
              onResume={recorder.resume}
              onSend={recorder.finish}
              onSchedule={voice.finishForSchedule}
            />
          ) : (
            // One pill: emoji on the left, the text, then attach (and the camera on phones).
            <div className="flex min-h-12 min-w-0 flex-1 items-end rounded-[1.5rem] border bg-surface px-0.5 shadow-xs transition-[border-color,box-shadow] focus-within:border-brand-text focus-within:ring-3 focus-within:ring-brand/20">
              <EmojiPicker onPick={insertEmoji} />
              <label className="sr-only" htmlFor="composer-input">
                {t('conversation.composerPlaceholder')}
              </label>
              <textarea
                id="composer-input"
                ref={field}
                rows={1}
                value={text}
                {...mention.inputProps}
                onSelect={mention.onSelect}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                  mention.onChange();
                  update(event.target.value);
                  typing.input(event.target.value.trim().length > 0);
                }}
                onBlur={() => typing.stop()}
                onPaste={(event) => {
                  const files = [...event.clipboardData.files];
                  if (files.length === 0) return;
                  event.preventDefault();
                  onFiles(files);
                }}
                onKeyDown={onKeyDown}
                aria-describedby={showHint ? 'composer-hint' : undefined}
                placeholder={t('conversation.composerPlaceholder')}
                className="composer-field block min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-[11px] text-[15px] leading-[22px] text-text outline-none placeholder:text-text-muted"
              />
              <AttachMenu onFiles={onFiles} onPoll={poll.open} />
              {/* WhatsApp-like: the camera makes room for the text once there is some. */}
              {isDesktop || hasText ? null : <CameraButton onFiles={onFiles} />}
            </div>
          )}
          <ComposerAction
            mode={mode}
            holding={recorder.active && !recorder.locked && recorder.status === 'recording'}
            send={
              <SendButton
                chatId={chatId}
                disabled={!canSend}
                takeDraft={() => (actions.editing ? null : { text, ...mention.payload(text) })}
                onScheduled={() => update('')}
              />
            }
            mic={
              <MicButton
                disabled={client === null}
                onClick={() => void voice.begin(true)}
                onHoldStart={() => void voice.begin(false)}
                onHoldEnd={recorder.finish}
                onSlideCancel={recorder.cancel}
                onSlideLock={recorder.lock}
              />
            }
          />
        </form>
        {/* Desktop only: phones have no keyboard shortcuts, and little room. */}
        {showHint ? <FormattingHint id="composer-hint" className="mt-1 pl-14" /> : null}
      </div>
    </div>
  );
}
