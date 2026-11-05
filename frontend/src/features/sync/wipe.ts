import { recentPeople } from '@/features/people/recent-people';
import { resetLiveStatus } from './live-status';
import { wipeLocalDatabases } from './local-db';
import { INITIAL_SYNC_STATE, useSyncStore } from './store';
import { announceSessionEnded } from './tabs';

/**
 * Shared PCs: when a session ends for any reason, nothing of that user's stays on this browser.
 * Stops the running client first, so nothing writes while the databases are deleted.
 */
export async function clearLocalUserData(): Promise<void> {
  const { client } = useSyncStore.getState();
  client?.stop();
  useSyncStore.setState(INITIAL_SYNC_STATE);
  resetLiveStatus();
  recentPeople.clear();
  // Other tabs check with the server and sign out too.
  announceSessionEnded();
  await wipeLocalDatabases();
}
