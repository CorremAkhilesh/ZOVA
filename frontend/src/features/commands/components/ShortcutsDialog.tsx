import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatKeys, isApplePlatform } from '../platform';
import { SHORTCUT_GROUPS } from '../shortcuts';
import { useShortcutsHelp } from '../shortcuts-store';

/** Ctrl/Cmd+/: every keyboard shortcut, grouped. Loaded the first time it opens. */
export default function ShortcutsDialog() {
  const { t } = useTranslation();
  const hide = useShortcutsHelp((state) => state.hide);
  const apple = isApplePlatform();
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : hide())}>
      <DialogContent title={t('shortcuts.title')} className="max-w-lg">
        <div className="-mx-1 max-h-[65vh] space-y-4 overflow-y-auto px-1">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`shortcuts-${group.id}`}>
              <h3 id={`shortcuts-${group.id}`} className="mb-1.5 text-sm font-semibold">
                {t(`shortcuts.groups.${group.id}`)}
              </h3>
              <dl className="divide-y rounded-xl border text-sm">
                {group.items.map((item) => (
                  <div
                    key={`${item.keys}-${item.label}`}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <dt className="min-w-0 text-text-muted">
                      {t(`shortcuts.items.${item.label}`)}
                    </dt>
                    <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {formatKeys(item.keys, apple)
                        .split(' | ')
                        .map((keys, index) => (
                          <Fragment key={keys}>
                            {index > 0 ? (
                              <span className="text-xs text-text-muted">{t('shortcuts.or')}</span>
                            ) : null}
                            <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs">
                              {keys}
                            </kbd>
                          </Fragment>
                        ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
