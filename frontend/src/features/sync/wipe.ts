import { useAuthFlow } from '@/features/auth/flow-store';
import { forgetDrafts } from '@/features/drafts/draft-sync';
import { recentPeople } from '@/features/people/recent-people';
import { resetLiveStatus } from './live-status';
import { hasPendingWipe, type WipeResult, wipeLocalDatabases } from './local-db';
import { INITIAL_SYNC_STATE, useSyncStore } from './store';
import { announceSessionEnded } from './tabs';

/**
 * Shared PCs: when a session ends for any reason, nothing of that user's stays on this browser.
 * Stops the running client first, so nothing writes while the databases are deleted.
 */
export async function clearLocalUserData(): Promise<WipeResult> {
  const { client } = useSyncStore.getState();
  client?.stop();
  useSyncStore.setState(INITIAL_SYNC_STATE);
  resetLiveStatus();
  recentPeople.clear();
  forgetDrafts();
  // Other tabs check with the server and sign out too.
  announceSessionEnded();
  return wipeAndReport();
}

/** On start: finishes a wipe that a blocked delete left unfinished last time. */
export async function finishPendingWipe(): Promise<void> {
  if (hasPendingWipe()) await wipeAndReport();
}

async function wipeAndReport(): Promise<WipeResult> {
  const result = await wipeLocalDatabases();
  // Shown on the sign-in screen, whichever way the session ended.
  useAuthFlow.getState().setWipeIncomplete(!result.complete);
  return result;
}
