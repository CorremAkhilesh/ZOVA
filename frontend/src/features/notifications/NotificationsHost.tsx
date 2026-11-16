import { useRouter, useRouterState } from '@tanstack/react-router';
import { pushTagFor } from '@zuvo/protocol';
import { useEffect } from 'react';
import { useChats } from '@/features/chats/queries';
import { OPEN_URL_MESSAGE } from '@/sw/push/handlers';
import { useAppBadge } from './badge';
import { openChatIdFrom, useInAppAlerts } from './use-in-app-alerts';
import { usePushLifecycle } from './use-push-lifecycle';

/** A click on a notification while the app is open: the worker asks this window to open a path. */
export function readOpenUrlMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, url } = data as { type?: unknown; url?: unknown };
  if (type !== OPEN_URL_MESSAGE || typeof url !== 'string') return null;
  return url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/** Notifications already on screen for a chat that is now open are old news. */
async function closeChatNotifications(chatId: string) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const shown = (await registration?.getNotifications({ tag: pushTagFor(chatId) })) ?? [];
    for (const notification of shown) notification.close();
  } catch {
    // No worker or no notifications here.
  }
}

/**
 * In the signed-in shell: the push subscription, the app icon badge, in-app toasts, and opening
 * chats from notification clicks.
 */
export function NotificationsHost() {
  const router = useRouter();
  const openChatId = useRouterState({
    select: (state) => openChatIdFrom(state.location.pathname),
  });
  usePushLifecycle();
  useAppBadge(useChats());
  useInAppAlerts();

  useEffect(() => {
    const container = navigator.serviceWorker;
    if (!container) return;
    const onMessage = (event: MessageEvent) => {
      const url = readOpenUrlMessage(event.data);
      if (url) router.history.push(url);
    };
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, [router]);

  useEffect(() => {
    if (openChatId) void closeChatNotifications(decodeURIComponent(openChatId));
  }, [openChatId]);

  return null;
}
