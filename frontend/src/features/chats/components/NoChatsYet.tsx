import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Two speech bubbles, in the theme's colors. */
function Illustration() {
  return (
    <svg aria-hidden viewBox="0 0 160 120" className="h-28 w-36">
      <circle cx="80" cy="60" r="56" className="fill-brand-subtle" />
      <path
        d="M44 40a12 12 0 0 1 12-12h46a12 12 0 0 1 12 12v22a12 12 0 0 1-12 12H66L50 86V74.5A12 12 0 0 1 44 62Z"
        className="fill-brand"
      />
      <circle cx="64" cy="51" r="4" className="fill-brand-foreground" />
      <circle cx="79" cy="51" r="4" className="fill-brand-foreground" />
      <circle cx="94" cy="51" r="4" className="fill-brand-foreground" />
      <path
        d="M84 70h40a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10v9l-13-9H84a10 10 0 0 1-10-10V80a10 10 0 0 1 10-10Z"
        className="fill-accent stroke-brand-subtle"
        strokeWidth="3"
      />
    </svg>
  );
}

/** The first thing a new user sees in the chat list, below Saved Messages. */
export function NoChatsYet({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <Illustration />
      <h2 className="text-lg font-semibold">{t('chats.emptyTitle')}</h2>
      <p className="max-w-xs text-sm text-text-muted">{t('chats.emptyBody')}</p>
      <Button onClick={onStart}>{t('chats.startChat')}</Button>
    </div>
  );
}
