import {
  STATUS_BACKGROUNDS,
  STATUS_FONTS,
  STATUS_TEXT_MAX,
  type StatusBackground,
  type StatusFont,
} from '@zuvo/protocol';
import { Type, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmojiPicker } from '@/features/chats/components/EmojiPicker';
import { useLocalDb } from '@/features/chats/queries';
import { cn } from '@/lib/utils';
import { patchFeed, refreshStatuses, statusApi } from '../feed';
import { BACKGROUND_COLORS, backgroundStyle, FONT_CLASSES, textSizeClass } from '../text-styles';

/** A text status: words on a colour, in one of three letterings, with emoji. Full screen. */
export function TextStatusEditor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const [text, setText] = useState('');
  const [background, setBackground] = useState<StatusBackground>('indigo');
  const [font, setFont] = useState<StatusFont>('sans');
  const [posting, setPosting] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      const { status } = await statusApi.create({
        kind: 'text',
        text: text.trim(),
        style: { background, font },
      });
      if (db) {
        await patchFeed(db, (feed) => ({ ...feed, mine: [...feed.mine, status] }));
        void refreshStatuses(db);
      }
      toast.success(t('updates.posted'));
      onClose();
    } catch {
      toast.error(t('updates.postFailed'));
      setPosting(false);
    }
  };
  const insertEmoji = (emoji: string) => {
    const element = field.current;
    const start = element?.selectionStart ?? text.length;
    setText(
      (current) =>
        `${current.slice(0, start)}${emoji}${current.slice(element?.selectionEnd ?? start)}`,
    );
    requestAnimationFrame(() => element?.focus());
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[1600] flex flex-col pt-[env(safe-area-inset-top)] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white outline-none"
          style={backgroundStyle(background)}
        >
          <DialogPrimitive.Title className="sr-only">{t('updates.newText')}</DialogPrimitive.Title>
          <div className="flex items-center gap-2 px-3 py-2">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label={t('common.cancel')}
                className="grid size-11 place-items-center rounded-full hover:bg-white/15"
              >
                <X className="size-6" aria-hidden />
              </button>
            </DialogPrimitive.Close>
            <span className="flex-1" />
            <div className="rounded-full bg-white/15 text-white [&_button]:text-white">
              <EmojiPicker onPick={insertEmoji} />
            </div>
            <button
              type="button"
              aria-label={t('updates.font', { font: t(`updates.fonts.${font}`) })}
              className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/25"
              onClick={() =>
                setFont(
                  STATUS_FONTS[(STATUS_FONTS.indexOf(font) + 1) % STATUS_FONTS.length] ?? 'sans',
                )
              }
            >
              <Type className="size-5" aria-hidden />
            </button>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center px-6">
            <label className="sr-only" htmlFor="status-text">
              {t('updates.textLabel')}
            </label>
            <textarea
              id="status-text"
              ref={field}
              // biome-ignore lint/a11y/noAutofocus: the editor opens to write in it
              autoFocus
              value={text}
              maxLength={STATUS_TEXT_MAX}
              placeholder={t('updates.textPlaceholder')}
              onChange={(event) => setText(event.target.value)}
              className={cn(
                'h-1/2 w-full max-w-xl resize-none bg-transparent text-center text-white outline-none placeholder:text-white/70',
                FONT_CLASSES[font],
                textSizeClass(text),
              )}
            />
          </div>
          <div className="flex items-center gap-3 px-4">
            <fieldset className="flex flex-1 flex-wrap gap-2">
              <legend className="sr-only">{t('updates.background')}</legend>
              {STATUS_BACKGROUNDS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={background === name}
                  aria-label={t(`updates.backgrounds.${name}`)}
                  onClick={() => setBackground(name)}
                  className={cn(
                    'size-9 rounded-full border-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70',
                    background === name ? 'border-white' : 'border-white/30',
                  )}
                  style={{ backgroundColor: BACKGROUND_COLORS[name].from }}
                />
              ))}
            </fieldset>
            <Button
              disabled={posting || !text.trim()}
              onClick={() => void post()}
              className="h-12 rounded-full bg-white px-6 text-base font-semibold text-slate-900 hover:bg-white/90"
            >
              {t('updates.post')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
