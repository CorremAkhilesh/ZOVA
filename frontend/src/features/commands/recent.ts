/** Commands run on this device, most recent first. Lost storage only means no "recent" list. */
export const RECENT_COMMANDS_KEY = 'zuvo.recent-commands';
export const RECENT_COMMANDS_MAX = 5;

export function loadRecentCommands(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_COMMANDS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === 'string')
      .slice(0, RECENT_COMMANDS_MAX);
  } catch {
    return [];
  }
}

/** Puts `id` first and returns the new list (kept even when it cannot be stored). */
export function recordRecentCommand(id: string): string[] {
  const next = [id, ...loadRecentCommands().filter((other) => other !== id)].slice(
    0,
    RECENT_COMMANDS_MAX,
  );
  try {
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the list just isn't remembered.
  }
  return next;
}
