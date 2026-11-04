import { Mic, Paperclip, SendHorizontal, Smile, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from '../types';
import { ME } from '../types';

interface ComposerProps {
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
}

/** Message input. Sending is not wired yet — this step is layout only. */
export function Composer({ replyTo, onCancelReply }: ComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const hasText = text.trim().length > 0;

  return (
    // Same horizontal padding and max width as the message column, so they line up.
    <div className="glass border-t pt-2 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] md:px-8">
      <div className="mx-auto max-w-3xl">
        <AnimatePresence initial={false}>
          {replyTo ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-brand bg-background px-3 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-brand-text">
                    {t('conversation.replyingTo', {
                      name: replyTo.authorId === ME ? t('chats.you') : replyTo.authorName,
                    })}
                  </p>
                  <p className="truncate text-text-muted">{replyTo.text}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onCancelReply}
                  aria-label={t('conversation.cancelReply')}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form className="flex items-end gap-1.5" onSubmit={(event) => event.preventDefault()}>
          <Button type="button" variant="ghost" size="icon" aria-label={t('conversation.emoji')}>
            <Smile className="size-5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t('conversation.attach')}>
            <Paperclip className="size-5" />
          </Button>
          <label className="sr-only" htmlFor="composer-input">
            {t('conversation.composerPlaceholder')}
          </label>
          <textarea
            id="composer-input"
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('conversation.composerPlaceholder')}
            className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border bg-surface px-4 py-2.5 text-[15px] text-text outline-none placeholder:text-text-muted focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={hasText ? 'send' : 'voice'}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              {hasText ? (
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full"
                  aria-label={t('conversation.send')}
                >
                  <SendHorizontal className="size-5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="accent"
                  size="icon"
                  className="rounded-full"
                  aria-label={t('conversation.voice')}
                >
                  <Mic className="size-5" />
                </Button>
              )}
            </motion.div>
          </AnimatePresence>
        </form>
      </div>
    </div>
  );
}
