import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  type ChatFolderDef,
  chatFolderSchema,
  type FolderRules,
  foldersResponseSchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api-client';

export interface FolderInput {
  name: string;
  emoji: string | null;
  chatIds: string[];
  rules: FolderRules;
}

const folderResponse = z.object({ folder: chatFolderSchema });
const okResponse = z.object({ ok: z.literal(true) });

export const foldersApi = {
  list: () => apiGet('/v1/me/folders', foldersResponseSchema),
  create: (input: FolderInput) => apiPost('/v1/me/folders', input, folderResponse),
  update: (id: string, changes: Partial<FolderInput>) =>
    apiPatch(`/v1/me/folders/${encodeURIComponent(id)}`, changes, folderResponse),
  remove: (id: string) => apiDelete(`/v1/me/folders/${encodeURIComponent(id)}`, okResponse),
  reorder: (ids: string[]) => apiPut('/v1/me/folders/order', { ids }, foldersResponseSchema),
};

export const FOLDERS_KEY = ['me', 'folders'] as const;

/** My folders, in my order. `folders:updated` and a reconnect refetch it. */
export const foldersQuery = queryOptions({
  queryKey: FOLDERS_KEY,
  queryFn: async (): Promise<ChatFolderDef[]> => (await foldersApi.list()).folders,
  staleTime: 60_000,
});

export const useFolders = () => useQuery(foldersQuery);
