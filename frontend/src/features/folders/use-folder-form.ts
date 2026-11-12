import { type FolderRules, NO_FOLDER_RULES } from '@zuvo/protocol';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { folderErrorMessage } from './errors';
import { useCreateFolder, useDeleteFolder, useUpdateFolder } from './mutations';
import { type FolderEditorRequest, useFolderEditor } from './store';

/**
 * The editor's fields and what Save and Delete do. An edit shows at once and closes (rolled back
 * with a toast if refused); a new folder waits for its id, so a refusal shows in the dialog.
 */
export function useFolderForm(request: FolderEditorRequest) {
  const { t } = useTranslation();
  const close = useFolderEditor((state) => state.close);
  const editing = request.folder;
  const [name, setName] = useState(editing?.name ?? '');
  const [emoji, setEmoji] = useState<string | null>(editing?.emoji ?? null);
  const [rules, setRules] = useState<FolderRules>(editing?.rules ?? NO_FOLDER_RULES);
  const [chatIds, setChatIds] = useState<string[]>(editing?.chatIds ?? request.pick ?? []);
  const [nameError, setNameError] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const remove = useDeleteFolder();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    const input = { name: trimmed, emoji, chatIds, rules };
    if (editing) {
      update.mutate({ id: editing.id, changes: input });
      close();
      return;
    }
    setServerError(null);
    create.mutate(input, {
      onSuccess: () => {
        toast.success(t('folders.created', { name: trimmed }));
        close();
      },
      onError: (error) => setServerError(folderErrorMessage(error, t)),
    });
  };

  return {
    editing,
    close,
    fields: { name, emoji, rules, chatIds },
    setName: (value: string) => {
      setName(value);
      setNameError(false);
    },
    setEmoji,
    setRules,
    setChatIds,
    nameError,
    serverError,
    creating: create.isPending,
    submit,
    deleteFolder: () => {
      if (editing) remove.mutate(editing.id);
      close();
    },
  };
}
