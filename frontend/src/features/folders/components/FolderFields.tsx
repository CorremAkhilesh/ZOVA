import type { FolderRules } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** A small set that suits folders. All single emoji the protocol accepts. */
export const FOLDER_EMOJI = [
  '📁',
  '💼',
  '🏠',
  '⭐',
  '❤️',
  '🔥',
  '🎯',
  '📌',
  '📢',
  '💬',
  '👥',
  '👪',
  '🎉',
  '🎓',
  '💡',
  '🛒',
  '✈️',
  '🎮',
  '🎵',
  '📚',
  '💰',
  '🏢',
  '⚽',
  '🤖',
] as const;

export function EmojiField(props: {
  value: string | null;
  onChange: (emoji: string | null) => void;
}) {
  const { t } = useTranslation();
  const options: (string | null)[] = [null, ...FOLDER_EMOJI];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('folders.emoji')}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((emoji) => (
          <label key={emoji ?? 'none'} className="cursor-pointer">
            <input
              type="radio"
              name="folder-emoji"
              className="peer sr-only"
              checked={props.value === emoji}
              onChange={() => props.onChange(emoji)}
              aria-label={emoji ?? t('folders.noEmoji')}
            />
            <span
              aria-hidden
              className={cn(
                'flex h-9 min-w-9 items-center justify-center rounded-lg border px-1.5 text-lg',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-brand',
                'peer-checked:border-brand peer-checked:bg-brand/10',
                emoji === null && 'text-xs text-text-muted',
              )}
            >
              {emoji ?? t('folders.noEmoji')}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const RULES = ['groups', 'direct', 'unread', 'excludeMuted', 'excludeArchived'] as const;

export function RuleFields(props: { value: FolderRules; onChange: (rules: FolderRules) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('folders.rulesTitle')}</legend>
      {RULES.map((rule) => (
        <label key={rule} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={props.value[rule]}
            onChange={(event) => props.onChange({ ...props.value, [rule]: event.target.checked })}
            className="mt-1 size-4 accent-brand"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm">{t(`folders.rules.${rule}`)}</span>
            <span className="block text-xs text-text-muted">{t(`folders.rules.${rule}Hint`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
