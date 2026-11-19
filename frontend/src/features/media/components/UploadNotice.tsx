import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/features/chats/types';
import { FileLostNotice } from './FileLostNotice';

const LINE = 'mt-0.5 block w-full text-right text-xs';

interface UploadNoticeProps {
  message: ChatMessage;
  onRetry?: ((clientMsgId: string) => void) | undefined;
}

/** Under the bubble: what the person has to do, or know, about a message still on this device. */
export function UploadNotice({ message, onRetry }: UploadNoticeProps) {
  const { t } = useTranslation();
  const { clientMsgId, status, failReason, heldInTab } = message;

  if (status === 'pending' && heldInTab) {
    return (
      <p role="status" className={`${LINE} font-semibold text-text-muted`}>
        {t('media.keepTabOpen')}
      </p>
    );
  }
  if (status !== 'failed' || !clientMsgId) return null;
  if (failReason === 'fileLost') {
    return <FileLostNotice chatId={message.chatId} clientMsgId={clientMsgId} />;
  }
  return (
    <>
      {failReason ? (
        <p role="alert" className={`${LINE} text-danger`}>
          {t(`media.${failReason}`)}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={() => onRetry(clientMsgId)}
          className={`${LINE} font-semibold text-danger`}
        >
          {t('conversation.notSentRetry')}
        </button>
      ) : null}
    </>
  );
}
