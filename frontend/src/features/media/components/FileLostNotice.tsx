import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSyncStore } from '@/features/sync/store';
import { fileTargetFor } from '../file-targets';

const ACTION = 'font-semibold text-danger underline-offset-2 hover:underline';

/**
 * A file message whose file is no longer on this device (the tab closed, site data was cleared, or
 * the browser cannot read it any more). It can never be sent as it is: remove it, or pick the file
 * again, which removes this one and opens the send sheet with the new pick.
 */
export function FileLostNotice({ chatId, clientMsgId }: { chatId: string; clientMsgId: string }) {
  const { t } = useTranslation();
  const client = useSyncStore((state) => state.client);
  const input = useRef<HTMLInputElement>(null);
  const target = fileTargetFor(chatId);

  const remove = () => client?.cancelMedia(clientMsgId);
  const chosen = async (files: File[]) => {
    if (files.length === 0 || !target) return;
    await remove();
    target(files);
  };

  return (
    <div className="mt-0.5 w-full text-right text-xs">
      <p role="alert" className="text-danger">
        {t('media.fileLost')}
      </p>
      <div className="mt-0.5 flex justify-end gap-3">
        <button type="button" className={ACTION} onClick={() => void remove()}>
          {t('media.fileLostRemove')}
        </button>
        {target ? (
          <>
            <button type="button" className={ACTION} onClick={() => input.current?.click()}>
              {t('media.fileLostChoose')}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-hidden="true"
              tabIndex={-1}
              data-testid="choose-again-input"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                void chosen(files);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
