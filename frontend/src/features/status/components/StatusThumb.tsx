import type { PublicProfile, Status } from '@zuvo/protocol';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { mediaContentUrl } from '@/features/media/api';
import { backgroundStyle } from '../text-styles';

/**
 * Inside the ring: the latest status itself, small. A photo or video: its thumbnail; text: its colour
 * with the first words; nothing to show (or the file is gone): the person's photo.
 */
export function StatusThumb(props: { user: PublicProfile; latest: Status | undefined }) {
  const { latest, user } = props;
  const [failed, setFailed] = useState(false);
  const avatar = (
    <Avatar name={user.displayName} src={user.avatar?.small} className="size-11" aria-hidden />
  );
  if (!latest) return avatar;
  if (latest.kind === 'text') {
    return (
      <span
        aria-hidden
        data-testid="status-thumb"
        className="grid size-11 place-items-center overflow-hidden rounded-full p-1 text-center text-[7px] leading-[1.15] font-semibold break-words text-white"
        style={latest.style ? backgroundStyle(latest.style.background) : undefined}
      >
        <span className="line-clamp-3">{latest.text}</span>
      </span>
    );
  }
  if (latest.media?.hasThumbnail && !failed) {
    return (
      <img
        aria-hidden
        alt=""
        data-testid="status-thumb"
        src={mediaContentUrl(latest.media.id, 'thumb')}
        onError={() => setFailed(true)}
        className="size-11 rounded-full bg-background object-cover"
      />
    );
  }
  return avatar;
}
