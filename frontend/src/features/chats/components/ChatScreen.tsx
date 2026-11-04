import { useQuery } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NotFound, Placeholder } from '@/components/common/StatusScreens';
import { Skeleton } from '@/components/ui/skeleton';
import { applyChats } from '@/features/sync/apply';
import type { LocalDb } from '@/features/sync/local-db';
import { ApiClientError } from '@/lib/api-client';
import { chatsApi } from '../api';
import { useChat, useLocalDb } from '../queries';
import { Conversation } from './Conversation';

function useFetchMissingChat(db: LocalDb | null, chatId: string, missing: boolean) {
  const fetched = useQuery({
    queryKey: ['chats', chatId],
    queryFn: () => chatsApi.getChat(chatId),
    enabled: missing,
    retry: false,
    gcTime: 0,
  });
  const { data } = fetched;
  useEffect(() => {
    if (data && db) void applyChats(db, [data]);
  }, [data, db]);
  return fetched;
}

/** Opens a chat from Dexie. One this device has never seen (a shared link) is fetched first. */
export function ChatScreen({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const chat = useChat(chatId);
  const { error } = useFetchMissingChat(db, chatId, chat === null);

  if (chat) return <Conversation chat={chat} />;
  if (error instanceof ApiClientError && error.isNetworkError) {
    return (
      <Placeholder
        title={t('conversation.notOfflineTitle')}
        body={t('conversation.notOfflineBody')}
        icon={<CloudOff className="size-9" aria-hidden />}
      />
    );
  }
  if (error) return <NotFound />;
  return (
    <div className="flex h-full flex-col gap-3 p-4" aria-busy="true">
      <h2 className="sr-only">{t('conversation.messages')}</h2>
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="ml-auto h-16 w-2/3" />
    </div>
  );
}
