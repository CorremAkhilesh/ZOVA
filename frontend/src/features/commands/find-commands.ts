import { matchScore } from './fuzzy';
import type { Command } from './registry';

/** In command mode (">"), what follows the ">"; otherwise null. */
export function commandQuery(q: string): string | null {
  const trimmed = q.trimStart();
  return trimmed.startsWith('>') ? trimmed.slice(1).trim() : null;
}

/**
 * The commands for a query, best first. With no query: the recent ones (most recent first), then
 * the rest in their usual order.
 */
export function findCommands(
  commands: readonly Command[],
  query: string,
  labelOf: (command: Command) => string,
  recent: readonly string[] = [],
): Command[] {
  if (!query.trim()) {
    const byId = new Map(commands.map((command) => [command.id, command]));
    const first = recent.flatMap((id) => byId.get(id) ?? []);
    return [...first, ...commands.filter((command) => !first.includes(command))];
  }
  return commands
    .map((command, order) => ({
      command,
      order,
      score: matchScore(query, labelOf(command), command.keywords),
    }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.command);
}
