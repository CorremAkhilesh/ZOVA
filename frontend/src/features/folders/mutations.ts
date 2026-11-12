import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatFolderDef } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FOLDERS_KEY, type FolderInput, foldersApi } from './api';
import { folderErrorMessage } from './errors';

type Snapshot = { previous: ChatFolderDef[] | undefined };

/** Shows a change at once; `rollback` puts the list back if the server refuses. */
async function optimistic(
  queryClient: QueryClient,
  change: (folders: ChatFolderDef[]) => ChatFolderDef[],
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: FOLDERS_KEY });
  const previous = queryClient.getQueryData<ChatFolderDef[]>(FOLDERS_KEY);
  if (previous) queryClient.setQueryData(FOLDERS_KEY, change(previous));
  return { previous };
}

function useRollback() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return (error: unknown, context: Snapshot | undefined) => {
    if (context?.previous) queryClient.setQueryData(FOLDERS_KEY, context.previous);
    toast.error(folderErrorMessage(error, t));
  };
}

const replaceFolder = (folders: ChatFolderDef[], folder: ChatFolderDef) =>
  folders.map((item) => (item.id === folder.id ? folder : item));

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FolderInput) => foldersApi.create(input),
    onSuccess: ({ folder }) =>
      queryClient.setQueryData<ChatFolderDef[]>(FOLDERS_KEY, (folders) => [
        ...(folders ?? []).filter((item) => item.id !== folder.id),
        folder,
      ]),
  });
}

export function useUpdateFolder() {
  const queryClient = useQueryClient();
  const rollback = useRollback();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<FolderInput> }) =>
      foldersApi.update(id, changes),
    onMutate: ({ id, changes }) =>
      optimistic(queryClient, (folders) =>
        folders.map((item) => (item.id === id ? { ...item, ...changes } : item)),
      ),
    onSuccess: ({ folder }) =>
      queryClient.setQueryData<ChatFolderDef[]>(FOLDERS_KEY, (folders) =>
        replaceFolder(folders ?? [], folder),
      ),
    onError: (error, _input, context) => rollback(error, context),
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  const rollback = useRollback();
  return useMutation({
    mutationFn: (id: string) => foldersApi.remove(id),
    onMutate: (id) =>
      optimistic(queryClient, (folders) => folders.filter((item) => item.id !== id)),
    onError: (error, _id, context) => rollback(error, context),
  });
}

/** `ids`: every folder id, in the new order. */
export function useReorderFolders() {
  const queryClient = useQueryClient();
  const rollback = useRollback();
  return useMutation({
    mutationFn: (ids: string[]) => foldersApi.reorder(ids),
    onMutate: (ids) =>
      optimistic(queryClient, (folders) =>
        ids.flatMap((id) => folders.find((item) => item.id === id) ?? []),
      ),
    onSuccess: ({ folders }) => queryClient.setQueryData(FOLDERS_KEY, folders),
    onError: (error, _ids, context) => rollback(error, context),
  });
}

/** Swaps a folder with its neighbour; null when it is already at that end. */
export function moveFolder(ids: readonly string[], id: string, by: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to] as string, next[from] as string];
  return next;
}
