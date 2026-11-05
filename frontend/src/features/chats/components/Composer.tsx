import { MESSAGE_TEXT_MAX } from '@zuvo/protocol';
import { Mic, SendHorizontal } from 'lucide-react';
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
import { ComingSoonButton } from '@/components/common/ComingSoonButton';
import { Button } from '@/components/ui/button';
import { AttachMenu } from '@/features/media/components/AttachMenu';
import { useSyncStore } from '@/features/sync/store';
import { useIsDesktop } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useLocalDb } from '../queries';
import { TypingSender } from '../typing-sender';
import { EmojiPicker } from './EmojiPicker';

/** The counter appears this close to the limit. */
const COUNTER_FROM = 200;
const DRAFT_SAVE_MS = 300;

interface ComposerProps {
  chatId: string;
  onSent: () => void;
  onFiles: (files: File[]) => void;
}

/** A draft per chat, in Dexie, so a sign-out wipes it with everything else. */
function useDraft(chatId: string) {
  const db = useLocalDb();
  const [text, setText] = useState('');
  const latest = useRef({ text: '', dirty: false });

  useEffect(() => {
    let cancelled = false;
    void db?.drafts
      .get(chatId)
      .then((draft) => {
        if (!cancelled && draft && !latest.current.dirty) setText(draft.text);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chatId, db]);

  const save = () => {
    if (!latest.current.dirty) return;
    latest.current.dirty = false;
    const { text: value } = latest.current;
    const write = async () => {
      if (value) await db?.drafts.put({ chatId, text: value });
      else await db?.drafts.delete(chatId);
    };
    void write().catch(() => undefined);
  };

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  // Leaving the chat saves right away rather than waiting for the timer.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      saveRef.current();
    },
    [],
  );

  return {
    text,
    update(next: string) {
      setText(next);
      latest.current = { text: next, dirty: true };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveRef.current(), DRAFT_SAVE_MS);
    },
  };
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
    void client?.sendText(chatId, text);
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
          <EmojiPicker onPick={insertEmoji} />
          <AttachMenu onFiles={onFiles} />
          <label className="sr-only" htmlFor="composer-input">
            {t('conversation.composerPlaceholder')}
          </label>
          <textarea
            id="composer-input"
            ref={field}
            rows={1}
            value={text}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
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
            placeholder={t('conversation.composerPlaceholder')}
            className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border bg-surface px-4 py-2.5 text-[15px] text-text outline-none placeholder:text-text-muted focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          />
          {hasText ? (
            <Button
              type="submit"
              size="icon"
              className="rounded-full"
              disabled={!canSend}
              aria-label={t('conversation.send')}
            >
              <SendHorizontal className="size-5" />
            </Button>
          ) : (
            <ComingSoonButton label={t('conversation.voice')} icon={Mic} />
          )}
        </form>
      </div>
    </div>
  );
}
