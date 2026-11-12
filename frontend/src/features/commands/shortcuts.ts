/**
 * Every keyboard shortcut in the app, for the shortcuts dialog (keep docs/shortcuts.md in step).
 * Keys use "Mod" for Ctrl (Windows, Linux) or ⌘ (macOS); several keys for one action are "|".
 */
export interface Shortcut {
  keys: string;
  /** Translation key under `shortcuts.items`. */
  label: string;
}

export const SHORTCUT_GROUPS: readonly { id: string; items: readonly Shortcut[] }[] = [
  {
    id: 'general',
    items: [
      { keys: 'Mod+K', label: 'search' },
      { keys: 'Mod+/', label: 'help' },
      { keys: 'Mod+N', label: 'newChat' },
      { keys: 'Esc', label: 'close' },
    ],
  },
  {
    id: 'chats',
    items: [
      { keys: 'Esc', label: 'cancel' },
      { keys: 'Esc', label: 'closeChat' },
      { keys: 'R', label: 'reply' },
      { keys: 'Space', label: 'voicePlay' },
      { keys: '← | →', label: 'voiceSeek' },
      { keys: 'Home | End', label: 'voiceEnds' },
    ],
  },
  {
    id: 'composer',
    items: [
      { keys: 'Enter', label: 'send' },
      { keys: 'Shift+Enter', label: 'newLine' },
      { keys: '↑', label: 'editLast' },
      { keys: 'Mod+B', label: 'bold' },
      { keys: 'Mod+I', label: 'italic' },
    ],
  },
  {
    id: 'search',
    items: [
      { keys: '↑ | ↓', label: 'move' },
      { keys: 'Enter', label: 'open' },
      { keys: '>', label: 'commands' },
      { keys: 'Enter | ↓', label: 'newerMatch' },
      { keys: 'Shift+Enter | ↑', label: 'olderMatch' },
      { keys: 'Esc', label: 'closeSearch' },
    ],
  },
];
