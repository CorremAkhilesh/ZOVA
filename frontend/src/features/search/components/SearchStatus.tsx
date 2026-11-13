import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { modKeyLabel } from '@/features/commands/platform';
import type { useMessageSearch } from '../use-message-search';

const LINE = 'px-2.5 py-2 text-sm text-text-muted';

/** Under the message results: searching, failed, none, or "More results". */
export function MessageStatus({ messages }: { messages: ReturnType<typeof useMessageSearch> }) {
  const { t } = useTranslation();
  if (messages.loading) {
    return (
      <p role="status" className={LINE}>
        {t('search.searching')}
      </p>
    );
  }
  if (messages.failed) {
    return (
      <p role="alert" className={LINE}>
        {t('search.serverFailed')}
      </p>
    );
  }
  if (messages.hits.length === 0) return <p className={LINE}>{t('search.noMessages')}</p>;
  if (!messages.hasMore) return null;
  return (
    <Button variant="ghost" size="sm" onClick={messages.loadMore} disabled={messages.loadingMore}>
      {t('search.more')}
    </Button>
  );
}

/** The hint under the list when nothing is searched yet, or "no commands" in command mode. */
export function PaletteHint({ commandMode }: { commandMode: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="px-2.5 py-3 text-sm text-text-muted">
      {commandMode ? t('commands.none') : t('search.commandHint', { mod: modKeyLabel() })}
    </p>
  );
}
