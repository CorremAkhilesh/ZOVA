import type { TFunction } from 'i18next';
import { usePlayer } from './player';
import type { TrackLabels } from './track';

/** The words a track is named with: a note's sender, or "You". */
export const trackLabels = (t: TFunction): TrackLabels => ({
  voice: t('voice.preview'),
  you: t('chats.you'),
  unknown: t('chats.unknownPerson'),
});

/** What the player is doing, as far as this message is concerned. */
export function useTrackState(key: string, mediaId: string | undefined) {
  const active = usePlayer((state) => state.track?.key === key);
  const playing = usePlayer((state) => active && state.playing);
  const loading = usePlayer((state) => active && state.loading);
  const position = usePlayer((state) => (active ? state.position : 0));
  const known = usePlayer((state) => (active ? state.track?.duration : undefined));
  const speed = usePlayer((state) => state.speed);
  const failed = usePlayer((state) => Boolean(mediaId && state.failed.has(mediaId)));
  return { active, playing, loading, position, known, speed, failed };
}
