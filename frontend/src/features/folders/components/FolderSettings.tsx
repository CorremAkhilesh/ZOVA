import { type ChatFolderDef, FOLDERS_MAX } from '@zuvo/protocol';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { useFolders } from '../api';
import { moveFolder, useDeleteFolder, useReorderFolders } from '../mutations';
import { folderLabel } from '../rules';
import { useFolderEditor } from '../store';
import { FolderEditorHost } from './FolderEditorHost';

function FolderRow(props: {
  folder: ChatFolderDef;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { folder } = props;
  const openEditor = useFolderEditor((state) => state.open);
  const name = folderLabel(folder);
  return (
    <li className="flex items-center gap-2 py-2">
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('folders.moveUp', { name: folder.name })}
        disabled={props.first}
        onClick={() => props.onMove(-1)}
      >
        <ArrowUp className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('folders.moveDown', { name: folder.name })}
        disabled={props.last}
        onClick={() => props.onMove(1)}
      >
        <ArrowDown className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('folders.editName', { name: folder.name })}
        onClick={() => openEditor({ folder })}
      >
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-danger"
        aria-label={t('folders.deleteName', { name: folder.name })}
        onClick={props.onDelete}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

function FolderList({ folders }: { folders: ChatFolderDef[] }) {
  const { t } = useTranslation();
  const reorder = useReorderFolders();
  const remove = useDeleteFolder();
  const [deleting, setDeleting] = useState<ChatFolderDef | null>(null);
  const ids = folders.map((folder) => folder.id);
  if (folders.length === 0) {
    return <p className="text-sm text-text-muted">{t('folders.empty')}</p>;
  }
  return (
    <>
      <ul className="divide-y">
        {folders.map((folder, index) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            first={index === 0}
            last={index === folders.length - 1}
            onMove={(by) => {
              const next = moveFolder(ids, folder.id, by);
              if (next) reorder.mutate(next);
            }}
            onDelete={() => setDeleting(folder)}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={t('folders.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('folders.deleteHint')}
        confirmLabel={t('folders.delete')}
        danger
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}

/** Settings → Chats → Folders: my folders in chip order, to edit, reorder or delete. */
export function FolderSettings() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useFolders();
  const openEditor = useFolderEditor((state) => state.open);
  const full = (data?.length ?? 0) >= FOLDERS_MAX;
  return (
    <SettingsSection title={t('folders.settingsTitle')}>
      <FolderEditorHost />
      <p className="text-sm text-text-muted">{t('folders.settingsHint')}</p>
      {isPending ? (
        <div role="status" aria-busy="true" aria-label={t('folders.loading')}>
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <div role="alert" className="flex items-center gap-3">
          <p className="flex-1 text-sm text-danger">{t('folders.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('errors.retry')}
          </Button>
        </div>
      ) : (
        <FolderList folders={data} />
      )}
      {isPending || isError ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={full} onClick={() => openEditor({ folder: null })}>
            <Plus className="size-4" aria-hidden />
            {t('folders.newTitle')}
          </Button>
          {full ? (
            <span className="text-xs text-text-muted">
              {t('folders.limit', { max: FOLDERS_MAX })}
            </span>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
