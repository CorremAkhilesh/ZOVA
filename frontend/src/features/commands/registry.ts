import {
  Archive,
  Bookmark,
  CheckCheck,
  Keyboard,
  Languages,
  Lock,
  type LucideIcon,
  MessageSquarePlus,
  MonitorSmartphone,
  Settings,
  Star,
  SunMoon,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNewChat } from '@/features/chats/new-chat-store';
import { useNewGroup } from '@/features/groups/rules';
import type { LocalDb } from '@/features/sync/local-db';
import { markAllRead, savedMessagesChatId, switchLanguage, toggleTheme } from './actions';
import { useChatListView } from './chat-list-view';
import { useShortcutsHelp } from './shortcuts-store';

export type AppPath = '/chats' | '/starred' | '/settings' | '/settings/devices';

export interface CommandContext {
  go: (to: AppPath) => void;
  openChat: (chatId: string) => void;
  db: LocalDb | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface Command {
  id: string;
  /** Translation key of the name. */
  label: string;
  /** English words that also find it, whatever the app's language. */
  keywords: readonly string[];
  icon: LucideIcon;
  /** Written with "Mod" for Ctrl or ⌘. */
  shortcut?: string;
  /** Listed, but not available yet. */
  soon?: boolean;
  run: (context: CommandContext) => void | Promise<void>;
}

export const COMMANDS: readonly Command[] = [
  {
    id: 'new-chat',
    label: 'commands.newChat',
    keywords: ['new chat', 'message', 'start conversation', 'person'],
    icon: MessageSquarePlus,
    shortcut: 'Mod+N',
    run: () => useNewChat.getState().open(),
  },
  {
    id: 'new-group',
    label: 'commands.newGroup',
    keywords: ['new group', 'create group', 'team'],
    icon: Users,
    run: () => useNewGroup.getState().setOpen(true),
  },
  {
    id: 'saved-messages',
    label: 'commands.savedMessages',
    keywords: ['saved messages', 'notes', 'self', 'bookmark'],
    icon: Bookmark,
    run: async ({ db, openChat }) => openChat(await savedMessagesChatId(db)),
  },
  {
    id: 'go-starred',
    label: 'commands.goStarred',
    keywords: ['starred', 'star', 'favourite', 'favorite'],
    icon: Star,
    run: ({ go }) => go('/starred'),
  },
  {
    id: 'go-archived',
    label: 'commands.goArchived',
    keywords: ['archived', 'archive'],
    icon: Archive,
    run: ({ go }) => {
      useChatListView.getState().showArchived();
      go('/chats');
    },
  },
  {
    id: 'mark-all-read',
    label: 'commands.markAllRead',
    keywords: ['mark all as read', 'read all', 'unread', 'clear'],
    icon: CheckCheck,
    run: async ({ db, t }) => {
      const count = await markAllRead(db);
      toast(count > 0 ? t('commands.markedRead', { count }) : t('commands.nothingUnread'));
    },
  },
  {
    id: 'toggle-theme',
    label: 'commands.toggleTheme',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'night'],
    icon: SunMoon,
    run: () => toggleTheme(),
  },
  {
    id: 'switch-language',
    label: 'commands.switchLanguage',
    keywords: ['language', 'hindi', 'english', 'translate'],
    icon: Languages,
    run: () => switchLanguage(),
  },
  {
    id: 'go-settings',
    label: 'commands.goSettings',
    keywords: ['settings', 'preferences', 'options'],
    icon: Settings,
    run: ({ go }) => go('/settings'),
  },
  {
    id: 'go-devices',
    label: 'commands.goDevices',
    keywords: ['devices', 'sessions', 'log out', 'sign out'],
    icon: MonitorSmartphone,
    run: ({ go }) => go('/settings/devices'),
  },
  {
    id: 'lock-app',
    label: 'commands.lockApp',
    keywords: ['lock', 'pin', 'privacy'],
    icon: Lock,
    soon: true,
    run: ({ t }) => {
      toast(t('commands.lockSoon'));
    },
  },
  {
    id: 'shortcuts',
    label: 'commands.shortcuts',
    keywords: ['keyboard shortcuts', 'hotkeys', 'keys', 'help'],
    icon: Keyboard,
    shortcut: 'Mod+/',
    run: () => useShortcutsHelp.getState().show(),
  },
];
