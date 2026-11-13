import type { CreateUploadBody } from '@zuvo/protocol';
import { useCallback, useState } from 'react';
import { useMessageUi } from '@/features/messages/store';
import { scheduleMedia } from '@/features/scheduled/schedule-media';
import { useSyncStore } from '@/features/sync/store';
import { uuidv7 } from '@/lib/uuid';
import type { PickedFile } from './components/PreviewSheet';
import { toPicked } from './components/PreviewSheet';
import { type PreparedFile, prepareFile } from './process';
import { useAppConfig } from './use-app-config';

const isVisual = (kind: CreateUploadBody['kind']) => kind === 'image' || kind === 'video';

export const toUploadInfo = (file: PreparedFile): CreateUploadBody => ({
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
  const config = useAppConfig();
  const addFiles = useCallback(
    (files: File[]) => setPicked((current) => [...current, ...toPicked(files)]),
    [],
  );

  const send = useCallback(
    async (input: { items: PickedFile[]; asDocument: boolean; viewOnce?: boolean }) => {
      const { items, asDocument } = input;
      const client = useSyncStore.getState().client;
      if (!client) return;
      const prepared = await Promise.all(items.map((item) => prepareFile(item.file, asDocument)));
      const visual = prepared.filter((file) => isVisual(file.kind));
      const albumId = visual.length > 1 ? uuidv7() : undefined;
      // Still one photo or video once prepared (a huge picture goes as a document instead).
      const viewOnce = input.viewOnce === true && prepared.length === 1 && visual.length === 1;
      // An album answers once, with its first item.
      let replyTo = useMessageUi.getState().replies[chatId];
      useMessageUi.getState().setReply(chatId, undefined);
      for (const [index, file] of prepared.entries()) {
        await client.sendMedia({
          chatId,
          replyTo,
          caption: items[index]?.caption.trim() ?? '',
          file: file.file,
          poster: file.poster,
          albumId: isVisual(file.kind) ? albumId : undefined,
          info: toUploadInfo(file),
          ...(viewOnce ? { viewOnce } : {}),
        });
        replyTo = undefined;
      }
    },
    [chatId],
  );

  /** "Schedule message" from the preview sheet: each file goes as its own message, at `at`. */
  const schedule = useCallback(
    async (
      input: { items: PickedFile[]; asDocument: boolean },
      at: Date,
      onProgress: (fraction: number) => void,
    ) => {
      const prepared = await Promise.all(
        input.items.map((item) => prepareFile(item.file, input.asDocument)),
      );
      await scheduleMedia(
        chatId,
        prepared.map((file, index) => ({
          file: file.file,
          info: toUploadInfo(file),
          poster: file.poster,
          caption: input.items[index]?.caption ?? '',
        })),
        at,
        onProgress,
      );
    },
    [chatId],
  );

  return {
    picked,
    setPicked,
    addFiles,
    send,
    schedule,
    clear: useCallback(() => setPicked([]), []),
    // Unknown while offline. The server still decides, and the message then says why it failed.
    maxBytes: config?.media.maxFileBytes ?? null,
  };
}
