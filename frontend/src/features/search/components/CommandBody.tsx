import { useTranslation } from 'react-i18next';
import { formatKeys } from '@/features/commands/platform';
import type { Command } from '@/features/commands/registry';

/** A command's row in the palette: icon, name, "coming soon" and its shortcut. */
export function CommandBody({ command }: { command: Command }) {
  const { t } = useTranslation();
  const Icon = command.icon;
  return (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-text-muted">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{t(command.label)}</span>
      {command.soon ? (
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-text-muted">
          {t('commands.soon')}
        </span>
      ) : null}
      {command.shortcut ? (
        <kbd className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs text-text-muted pointer-coarse:hidden">
          {formatKeys(command.shortcut)}
        </kbd>
      ) : null}
    </>
  );
}
