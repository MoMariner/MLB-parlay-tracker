import { useState } from 'react';
import { getPlayerPhoto, PLAYER_PHOTO_FALLBACK, type PhotoSize } from '../../../shared/photos';
import type { Sport } from '../lib/types';

/** Headshot by player id -- MLB spots or ESPN -- with a graceful fallback. */
export function PlayerPhoto({
  playerId, size = 'md', alt, sport = 'mlb',
}: { playerId: number; size?: PhotoSize; alt: string; sport?: Sport }) {
  const [failed, setFailed] = useState(false);
  // Demo players (negative ids) and missing ids have no real headshot.
  const fallback = failed || playerId <= 0;
  const src = fallback ? PLAYER_PHOTO_FALLBACK : getPlayerPhoto(playerId, size, sport);
  return (
    <img
      // ESPN headshots are landscape: `nfl` switches the frame to cover-crop.
      className={`photo ${size}${sport === 'nfl' && !fallback ? ' nfl' : ''}`}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
