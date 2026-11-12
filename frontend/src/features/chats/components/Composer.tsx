import { MESSAGE_TEXT_MAX } from '@zuvo/protocol';
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortcut } from '@/features/formatting/composer-shortcut';
import { FormattingHint } from '@/features/formatting/FormattingHint';
import { ComposerLinkPreview } from '@/features/link-previews/LinkPreviewCard';
import { useLinkPreviewDraft } from '@/features/link-previews/use-link-preview-draft';
import { AttachMenu } from '@/features/media/components/AttachMenu';
import { useMentionPicker } from '@/features/mentions/use-mention-picker';
import { ComposerBanner } from '@/features/messages/components/ComposerBanner';
import { useComposerActions } from '@/features/messages/use-composer-actions';
import { usePollComposer } from '@/features/polls/use-poll-composer';
import { SendButton } from '@/features/scheduled/components/SendButton';
import { useSyncStore } from '@/features/sync/store';
import { MicButton } from '@/features/voice/components/MicButton';
import { MicBlockedDialog, MicExplainDialog } from '@/features/voice/components/MicDialogs';
import { RecordingBar } from '@/features/voice/components/RecordingBar';
import { useVoiceNote } from '@/features/voice/use-voice-note';
import { useIsDesktop } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { TypingSender } from '../typing-sender';
import { useDraft } from '../use-draft';
import { EmojiPicker } from './EmojiPicker';

/** The counter appears this close to the limit. */
const COUNTER_FROM = 200;

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

  // Grows with the text, up to the field's max height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` changes the content being measured
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

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

  return (
    // Same horizontal padding and max width as the message column, so they line up.
    <div className="glass border-t pt-2 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] md:px-8">
      <div className="mx-auto max-w-3xl">
        <MicExplainDialog
          open={voice.explaining}
          onAllow={voice.allowMic}
          onClose={voice.closeExplaining}
        />
        <MicBlockedDialog open={voice.blockedOpen} onClose={voice.closeBlocked} />
        <ComposerBanner chatId={chatId} />
        {poll.dialog}
        <ComposerLinkPreview preview={link.preview} loading={link.loading} onRemove={link.remove} />
        {mention.picker}
        {recorder.problem && recorder.problem !== 'blocked' ? (
          <p role="status" className="mb-1 text-xs font-medium text-text-muted">
            {t(`voice.problems.${recorder.problem}`)}
          </p>
        ) : null}
        {remaining <= COUNTER_FROM ? (
          <p
            role="status"
            className={cn(
              'mb-1 text-right text-xs tabular-nums',
              remaining < 0 ? 'font-semibold text-danger' : 'text-text-muted',
            )}
          >
            {remaining < 0
              ? t('conversation.tooLong', { count: -remaining })
              : t('conversation.charsLeft', { count: remaining })}
          </p>
        ) : null}
        <form className="flex items-end gap-1.5" onSubmit={onSubmit}>
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
            />
          ) : (
            <>
              <EmojiPicker onPick={insertEmoji} />
              <AttachMenu onFiles={onFiles} onPoll={poll.open} />
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
                className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border bg-surface px-4 py-2.5 text-[15px] text-text outline-none placeholder:text-text-muted focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
              />
            </>
          )}
          {hasText || actions.editing ? (
            <SendButton
              chatId={chatId}
              disabled={!canSend}
              takeDraft={() => (actions.editing ? null : { text, ...mention.payload(text) })}
              onScheduled={() => update('')}
            />
          ) : recorder.active && recorder.locked ? null : (
            <MicButton
              disabled={client === null}
              onClick={() => void voice.begin(true)}
              onHoldStart={() => void voice.begin(false)}
              onHoldEnd={recorder.finish}
              onSlideCancel={recorder.cancel}
              onSlideLock={recorder.lock}
            />
          )}
        </form>
        {/* Desktop only: phones have no keyboard shortcuts, and little room. */}
        {showHint ? <FormattingHint id="composer-hint" className="mt-1 pl-24" /> : null}
      </div>
    </div>
  );
}
