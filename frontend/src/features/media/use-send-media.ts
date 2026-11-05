import type { CreateUploadBody } from '@zuvo/protocol';
import { useCallback, useState } from 'react';
import { useSyncStore } from '@/features/sync/store';
import { uuidv7 } from '@/lib/uuid';
import type { PickedFile } from './components/PreviewSheet';
import { toPicked } from './components/PreviewSheet';
import { type PreparedFile, prepareFile } from './process';

const toUploadInfo = (file: PreparedFile): CreateUploadBody => ({
  kind: file.kind,
  name: file.name,
  mime: file.mime,
  size: file.file.size,
  ...(file.width ? { width: file.width } : {}),
  ...(file.height ? { height: file.height } : {}),
  ...(file.duration ? { duration: file.duration } : {}),
});

/** Files chosen, dropped or pasted, on their way through the preview sheet into the outbox. */
export function useSendMedia(chatId: string) {
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const addFiles = useCallback(
    (files: File[]) => setPicked((current) => [...current, ...toPicked(files)]),
    [],
  );

  const send = useCallback(
    async ({ items, asDocument }: { items: PickedFile[]; asDocument: boolean }) => {
      const client = useSyncStore.getState().client;
      if (!client) return;
      const prepared = await Promise.all(items.map((item) => prepareFile(item.file, asDocument)));
      const visual = prepared.filter((file) => file.kind !== 'document');
      const albumId = visual.length > 1 ? uuidv7() : undefined;
      for (const [index, file] of prepared.entries()) {
        await client.sendMedia({
          chatId,
          caption: items[index]?.caption.trim() ?? '',
          file: file.file,
          poster: file.poster,
          albumId: file.kind === 'document' ? undefined : albumId,
          info: toUploadInfo(file),
        });
      }
    },
    [chatId],
  );

  return { picked, setPicked, addFiles, send, clear: useCallback(() => setPicked([]), []) };
}
