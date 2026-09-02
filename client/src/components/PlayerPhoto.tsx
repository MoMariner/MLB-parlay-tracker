import { useState } from 'react';
import { getPlayerPhoto, PLAYER_PHOTO_FALLBACK, type PhotoSize } from '../../../shared/photos';

/** Spec §17 -- headshot by player ID, with a graceful fallback. */
export function PlayerPhoto({
  playerId, size = 'md', alt,
}: { playerId: number; size?: PhotoSize; alt: string }) {
  const [failed, setFailed] = useState(false);
  // Demo players (negative IDs) have no MLB headshot at all.
  const src = failed || playerId < 0 ? PLAYER_PHOTO_FALLBACK : getPlayerPhoto(playerId, size);
  return (
    <img
      className={`photo ${size}`}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
