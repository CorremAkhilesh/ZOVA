import { CircleDashed, MessageCircle, Phone, Settings } from 'lucide-react';

export const NAV_ITEMS = [
  { to: '/chats', labelKey: 'nav.chats', icon: MessageCircle },
  { to: '/updates', labelKey: 'nav.updates', icon: CircleDashed },
  { to: '/calls', labelKey: 'nav.calls', icon: Phone },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
] as const;
