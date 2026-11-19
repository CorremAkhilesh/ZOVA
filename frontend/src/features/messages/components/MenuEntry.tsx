import { type LucideIcon, RotateCw, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useSyncStore } from '@/features/sync/store';
import { type MenuRequest, useMessageUi } from '../store';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-background';

/** One row of the message menu. */
export function Entry(props: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  const Icon = props.icon;
  return (
    <DropdownMenu.Item
      className={props.danger ? `${ITEM} text-danger` : ITEM}
      onSelect={props.onSelect}
    >
      <Icon className="size-4" aria-hidden />
      {props.label}
    </DropdownMenu.Item>
  );
}

/** Not sent: try again (unless its file is gone), or delete it from this device. */
export function UnsentEntries({ request }: { request: MenuRequest }) {
  const { t } = useTranslation();
  const { message, items } = request;
  const set = useMessageUi((state) => state.set);
  const canRetry = message.status === 'failed' && message.failReason !== 'fileLost';
  return (
    <div>
      {canRetry && message.clientMsgId ? (
        <Entry
          icon={RotateCw}
          label={t('messages.retry')}
          onSelect={() => void useSyncStore.getState().client?.retry(message.clientMsgId ?? '')}
        />
      ) : null}
      <Entry
        danger
        icon={Trash2}
        label={t('messages.delete')}
        onSelect={() => set({ deleting: items })}
      />
    </div>
  );
}
