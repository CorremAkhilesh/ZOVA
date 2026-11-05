import { useEffect, useState } from 'react';
import { useLocalDb } from '@/features/chats/queries';
import type { LocalDb } from '@/features/sync/local-db';
import { asBlob, toStorable } from '@/features/sync/stored-bytes';
import { mediaContentUrl } from './api';

export type ThumbnailState = { url: string | null; missing: boolean };

async function fetchThumbnail(id: string): Promise<Blob | 'missing' | null> {
  const response = await fetch(mediaContentUrl(id, 'thumb'), { credentials: 'include' });
  if (response.status === 404) return 'missing';
  return response.ok ? response.blob() : null;
}

/** A full or wiped database only means fetching it again next time. */
async function keep(db: LocalDb | null, mediaId: string, blob: Blob) {
  if (!db) return;
  await db.thumbs.put({ mediaId, blob: await toStorable(db, blob) }).catch(() => undefined);
}

/**
 * A thumbnail from Dexie, or fetched and kept there, so a chat scrolls without the network and
 * sign-out wipes them along with everything else. Null until it is ready.
 */
export function useThumbnail(mediaId: string | undefined, available: boolean): ThumbnailState {
  const db = useLocalDb();
  const [state, setState] = useState<ThumbnailState>({ url: null, missing: false });

  useEffect(() => {
    if (!db || !mediaId || !available) return;
    let cancelled = false;
    let url: string | null = null;
    const show = (blob: Blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setState({ url, missing: false });
    };
    async function load(id: string) {
      const cached = await db?.thumbs.get(id).catch(() => undefined);
      if (cached) return show(asBlob(cached.blob));
      const blob = await fetchThumbnail(id);
      if (blob === 'missing') {
        if (!cancelled) setState({ url: null, missing: true });
      } else if (blob) {
        show(blob);
        await keep(db, id, blob);
      }
    }
    // Offline with nothing cached: the blurred placeholder stays.
    void load(mediaId).catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [available, db, mediaId]);

  return state;
}

/** The file still waiting to be uploaded, shown in place of the thumbnail it will get. */
export function useLocalPreview(clientMsgId: string | null | undefined, active: boolean) {
  const db = useLocalDb();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!db || !clientMsgId || !active) return;
    let cancelled = false;
    let created: string | null = null;
    void db.files
      .get(clientMsgId)
      .then((stored) => {
        const source = stored?.poster ?? stored?.file;
        if (!source || cancelled) return;
        created = URL.createObjectURL(asBlob(source));
        setUrl(created);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [active, clientMsgId, db]);
  return url;
}
