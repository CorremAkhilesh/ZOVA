import { useQuery } from '@tanstack/react-query';
import { formatCallDuration } from '@zuvo/protocol';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { useChat, useChats } from '@/features/chats/queries';
import type { ChatSummary } from '@/features/chats/types';
import { toChatSummary } from '@/features/chats/view';
import { callsApi } from './api';
import { type CallState, elapsedSeconds } from './machine';
import { useCallStore } from './store';

export const callAccessQuery = {
  queryKey: ['calls', 'access'] as const,
  queryFn: callsApi.access,
  staleTime: 5 * 60_000,
};

/** Whether this account has calls (the flag on the server). False until known. */
export function useCallAccess(): boolean {
  return useQuery(callAccessQuery).data === true;
}

/** Re-renders every second while `running`. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

function useSummaryLabels() {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const saved = t('chats.saved');
  const unknown = t('calls.unknownPerson');
  return useMemo(() => ({ me, labels: { saved, unknown } }), [me, saved, unknown]);
}

/** The other person, as this device knows the chat: name and photo. */
export function useCallPeer(chatId: string | undefined) {
  const { me, labels } = useSummaryLabels();
  const row = useChat(chatId ?? '');
  const chat = useMemo(() => (row ? toChatSummary(row, me, labels) : null), [row, me, labels]);
  return { chat, name: chat?.name ?? labels.unknown };
}

/** Every chat on this device, by id, as the screens show them (for the call history). */
export function useChatSummaries(): Map<string, ChatSummary> {
  const { me, labels } = useSummaryLabels();
  const rows = useChats();
  return useMemo(
    () => new Map((rows ?? []).map((row) => [row.id, toChatSummary(row, me, labels)])),
    [rows, me, labels],
  );
}

/** The line under the name: "Calling…", "Ringing…", "2:31", "Reconnecting…", "Call ended". */
export function useCallStatusLine(state: CallState): string {
  const { t } = useTranslation();
  const now = useNow(state.phase === 'active');
  switch (state.phase) {
    case 'outgoing':
      return state.peerRinging ? t('calls.ringing') : t('calls.calling');
    case 'incoming':
      return t('calls.incoming');
    case 'connecting':
      return t('calls.connecting');
    case 'active':
      return state.reconnecting
        ? t('calls.reconnecting')
        : formatCallDuration(elapsedSeconds(state, now));
    case 'ended':
      return t(`calls.endReason.${state.endReason ?? 'answered'}`);
    default:
      return '';
  }
}

export const useCallState = () => useCallStore((store) => store.state);
