import { Link } from '@tanstack/react-router';
import {
  ChevronRight,
  CircleHelp,
  Download,
  Info,
  type LucideIcon,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useHelpText } from '../content';
import { HelpPage } from './HelpPage';

type HelpPath = '/help/install' | '/help/faq' | '/help/privacy' | '/help/contact' | '/help/about';

const TOPICS: readonly { to: HelpPath; key: string; icon: LucideIcon }[] = [
  { to: '/help/install', key: 'install', icon: Download },
  { to: '/help/faq', key: 'faq', icon: CircleHelp },
  { to: '/help/privacy', key: 'privacy', icon: ShieldCheck },
  { to: '/help/contact', key: 'contact', icon: Mail },
  { to: '/help/about', key: 'about', icon: Info },
];

/** /help: one card per topic. */
export function HelpHome() {
  const { text } = useHelpText();
  return (
    <HelpPage title={text('menuTitle')} description={text('home.subtitle')} back="settings">
      <nav aria-label={text('home.topics')}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TOPICS.map(({ to, key, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex h-full items-center gap-4 rounded-2xl border bg-surface p-5 shadow-sm transition-colors hover:bg-background"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand-text">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{text(`cards.${key}.title`)}</span>
                  <span className="block text-sm text-text-muted">{text(`cards.${key}.hint`)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </HelpPage>
  );
}
