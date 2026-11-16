import { Smile } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useBackClose } from '@/lib/back-stack';
import { cn } from '@/lib/utils';
import { EMOJI_GROUPS, type EmojiGroup } from '../emoji-data';

/** A small built-in set: works offline, adds almost nothing to the app and sends no requests. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<EmojiGroup>(EMOJI_GROUPS[0]);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={t('conversation.emoji')}>
          <Smile className="size-5" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          aria-label={t('conversation.emoji')}
          // Keep focus on the textarea's caret logic, and the keyboard open on phones.
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="z-[1500] w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-surface p-2 shadow-lg"
        >
          <div role="tablist" aria-label={t('conversation.emoji')} className="mb-2 flex gap-1">
            {EMOJI_GROUPS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={group.id === candidate.id}
                aria-label={t(`emoji.${candidate.id}`)}
                onClick={() => setGroup(candidate)}
                className={cn(
                  'flex-1 rounded-lg py-1 text-lg',
                  group.id === candidate.id ? 'bg-brand-subtle' : 'hover:bg-background',
                )}
              >
                {candidate.icon}
              </button>
            ))}
          </div>
          <div className="grid h-52 grid-cols-7 content-start gap-0.5 overflow-y-auto">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={emoji}
                onClick={() => {
                  onPick(emoji);
                  setOpen(false);
                }}
                className="rounded-lg p-1 text-xl hover:bg-background"
              >
                {emoji}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
