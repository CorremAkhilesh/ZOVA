import { recentPeople } from '@/features/people/recent-people';
import { wipeLocalDatabases } from './local-db';
import { useSyncStore } from './store';
import { announceSessionEnded } from './tabs';

/**
 * Shared PCs: when a session ends for any reason, nothing of that user's stays on this browser.
 * Stops the running client first, so nothing writes while the databases are deleted.
 */
export async function clearLocalUserData(): Promise<void> {
  const { client } = useSyncStore.getState();
  client?.stop();
  useSyncStore.setState({ client: null, socket: 'connecting', sync: 'syncing' });
  recentPeople.clear();
  // Other tabs check with the server and sign out too.
  announceSessionEnded();
  await wipeLocalDatabases();
}
