import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocalDb } from '@/features/chats/queries';
import { commandQuery, findCommands } from '@/features/commands/find-commands';
import { loadRecentCommands, recordRecentCommand } from '@/features/commands/recent';
import { COMMANDS, type Command, type CommandContext } from '@/features/commands/registry';
import type { SearchOption } from './components/SearchResults';

/** Commands shown next to search results when the query is not in command mode. */
const MIXED_MAX = 4;

/**
 * The palette's commands for what was typed: ">…" lists only commands, an empty query lists them
 * all (recent first), anything else adds the best few above the search results.
 */
export function useCommandOptions(q: string, filtered: boolean, onBeforeRun: () => void) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const db = useLocalDb();
  const [recent] = useState(loadRecentCommands);
  const query = commandQuery(q);
  const commandMode = query !== null;

  const options = useMemo<SearchOption[]>(() => {
    if (filtered && !commandMode) return [];
    const found = findCommands(COMMANDS, query ?? q, (command) => t(command.label), recent);
    const shown = commandMode || !q.trim() ? found : found.slice(0, MIXED_MAX);
    return shown.map((command) => ({ kind: 'command', id: command.id, command }));
  }, [commandMode, filtered, q, query, recent, t]);

  const run = (command: Command) => {
    onBeforeRun();
    recordRecentCommand(command.id);
    const context: CommandContext = {
      go: (to) => void navigate({ to }),
      openChat: (chatId) => void navigate({ to: '/chats/$chatId', params: { chatId } }),
      db,
      t: (key, options) => (options ? t(key, options) : t(key)),
    };
    Promise.resolve()
      .then(() => command.run(context))
      .catch(() => toast.error(t('commands.failed')));
  };

  return { commandMode, options, run };
}
