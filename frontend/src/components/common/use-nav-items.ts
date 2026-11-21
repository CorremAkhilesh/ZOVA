import { useAppConfig } from '@/features/media/use-app-config';
import { NAV_ITEMS } from './nav-items';

/** The main tabs; Updates goes away when status is switched off in Admin → Settings. */
export function useNavItems() {
  const statusOn = useAppConfig()?.features.status !== false;
  return NAV_ITEMS.filter((item) => statusOn || item.to !== '/updates');
}

/** The most people a group may have now (the server says; never above the protocol's limit). */
export function useGroupMax(protocolMax: number): number {
  const fromServer = useAppConfig()?.features.groupMaxMembers;
  return Math.min(protocolMax, fromServer ?? protocolMax);
}
