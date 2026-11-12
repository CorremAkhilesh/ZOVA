import { type ChatFolderDef, FOLDERS_MAX } from '@zuvo/protocol';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { folderUnreadCount } from '@/features/chats/chat-utils';
import type { ChatFolder, ChatSummary } from '@/features/chats/types';
import { cn } from '@/lib/utils';
import { folderKey, folderLabel } from '../rules';
import { useFolderEditor } from '../store';

const BUILT_IN: ChatFolder[] = ['all', 'unread', 'personal', 'groups'];

function Chip(props: { label: string; count: number; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const countId = useId();
  return (
    <>
      <button
        type="button"
        role="tab"
        aria-selected={props.selected}
        // The name stays the folder's name; the count is read as its description.
        aria-describedby={props.count > 0 ? countId : undefined}
        onClick={props.onSelect}
        onFocus={(event) =>
          event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' })
        }
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1 text-sm font-medium whitespace-nowrap transition-colors',
          props.selected
            ? 'border-transparent bg-brand text-brand-foreground'
            : 'bg-surface text-text-muted hover:text-text',
        )}
      >
        {props.label}
        {props.count > 0 ? (
          <span
            aria-hidden
            className={cn(
              'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums',
              props.selected ? 'bg-brand-foreground text-brand' : 'bg-brand text-brand-foreground',
            )}
          >
            {props.count > 99 ? '99+' : props.count}
          </span>
        ) : null}
      </button>
      {/* Hidden, but still read as the chip's description. */}
      {props.count > 0 ? (
        <span id={countId} hidden>
          {t('folders.unreadChats', { count: props.count })}
        </span>
      ) : null}
    </>
  );
}

/**
 * The built-in chips, then my folders in my order, then "+". Scrolls sideways by touch, trackpad and
 * Shift+wheel, with no scrollbar: the edges fade where there is more to see.
 */
export function FolderChips(props: {
  folder: ChatFolder;
  onChange: (folder: ChatFolder) => void;
  chats: ChatSummary[];
  folders: readonly ChatFolderDef[];
}) {
  const { t } = useTranslation();
  const { folder, onChange, chats, folders } = props;
  const row = useRef<HTMLDivElement>(null);
  const openEditor = useFolderEditor((state) => state.open);
  const updateEdges = useCallback(() => {
    const element = row.current;
    if (!element) return;
    element.dataset.atStart = String(element.scrollLeft <= 1);
    element.dataset.atEnd = String(
      element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
    );
  }, []);
  useEffect(() => {
    updateEdges();
    const element = row.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [updateEdges]);

  const chips = [
    ...BUILT_IN.map((key) => ({ key, label: t(`chats.folders.${key}`) })),
    ...folders.map((item) => ({ key: folderKey(item.id), label: folderLabel(item) })),
  ];
  return (
    <div
      ref={row}
      onScroll={updateEdges}
      className="chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      <div role="tablist" aria-label={t('chats.foldersLabel')} className="flex gap-2">
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            count={folderUnreadCount(chats, chip.key, folders)}
            selected={folder === chip.key}
            onSelect={() => onChange(chip.key)}
          />
        ))}
      </div>
      {folders.length < FOLDERS_MAX ? (
        <button
          type="button"
          aria-label={t('folders.newTitle')}
          title={t('folders.newTitle')}
          onClick={() => openEditor({ folder: null })}
          className="flex shrink-0 items-center rounded-full border bg-surface px-2.5 py-1 text-text-muted transition-colors hover:text-text"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
