import { FOLDER_CHATS_MAX, FOLDERS_MAX } from '@zuvo/protocol';
import { Check, ChevronRight, FolderPlus, Folders } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ChatSummary } from '@/features/chats/types';
import { useFolders } from '../api';
import { useUpdateFolder } from '../mutations';
import { folderLabel } from '../rules';
import { useFolderEditor } from '../store';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-background data-[disabled]:opacity-50';

/** "Add to folder ›" in a chat's menu: tick or untick it in my folders, or start a new one. */
export function FolderMenuEntries({ chat }: { chat: ChatSummary }) {
  const { t } = useTranslation();
  const { data: folders = [] } = useFolders();
  const update = useUpdateFolder();
  const openEditor = useFolderEditor((state) => state.open);
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={ITEM}>
        <Folders className="size-4" aria-hidden />
        <span className="flex-1">{t('folders.addTo')}</span>
        <ChevronRight className="size-4 text-text-muted" aria-hidden />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          collisionPadding={8}
          className="z-[1500] max-h-80 w-56 overflow-y-auto rounded-xl border bg-surface p-1.5 shadow-lg"
        >
          {folders.map((folder) => {
            const picked = folder.chatIds.includes(chat.id);
            return (
              <DropdownMenu.CheckboxItem
                key={folder.id}
                className={ITEM}
                checked={picked}
                onSelect={() => {
                  if (!picked && folder.chatIds.length >= FOLDER_CHATS_MAX) {
                    toast.error(t('folders.chatLimit', { max: FOLDER_CHATS_MAX }));
                    return;
                  }
                  const chatIds = picked
                    ? folder.chatIds.filter((id) => id !== chat.id)
                    : [...folder.chatIds, chat.id];
                  update.mutate({ id: folder.id, changes: { chatIds } });
                }}
              >
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="min-w-0 flex-1 truncate">{folderLabel(folder)}</span>
              </DropdownMenu.CheckboxItem>
            );
          })}
          {folders.length > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
          <DropdownMenu.Item
            className={ITEM}
            disabled={folders.length >= FOLDERS_MAX}
            onSelect={() => openEditor({ folder: null, pick: [chat.id] })}
          >
            <FolderPlus className="size-4" aria-hidden />
            {t('folders.newEllipsis')}
          </DropdownMenu.Item>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
