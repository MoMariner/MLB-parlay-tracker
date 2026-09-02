/**
 * Player headshots (spec §17). Derived from the MLB player ID -- never a
 * hard-coded per-player URL. Used by search results, the selection panel,
 * the bet preview and the live bet card.
 */

export type PhotoSize = 'sm' | 'md' | 'lg';

/**
 * MLB serves two headshot crops:
 *   /headshot/67/current  -- 2:3 PORTRAIT. Squeezing it into a round frame
 *                            crops ~a third of the height and clips faces.
 *   /spots/{n}            -- 1:1, pre-cropped head-and-shoulders, already
 *                            circular with a transparent surround.
 * The avatars are round, so spots is the right source. Requested at 2x the
 * rendered size so the circles stay sharp on retina displays.
 */
const SPOT_PX: Record<PhotoSize, number> = { sm: 120, md: 180, lg: 240 };

export function getPlayerPhoto(playerId: number, size: PhotoSize = 'md'): string {
  return `https://midfield.mlbstatic.com/v1/people/${playerId}/spots/${SPOT_PX[size]}`;
}

/**
 * Local fallback, only for demo players and genuine network failures --
 * MLB answers unknown IDs with its own round grey silhouette.
 */
export const PLAYER_PHOTO_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="32" fill="#1e2a3a"/>
      <circle cx="32" cy="25" r="10.5" fill="#42566e"/>
      <path d="M13 57c2.5-10 9.5-15 19-15s16.5 5 19 15a32 32 0 0 1-38 0z" fill="#42566e"/>
    </svg>`.replace(/\s+/g, ' '),
  );

export function getTeamLogo(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}
