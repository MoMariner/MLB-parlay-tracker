/** Sport-prefixed row keys: "mlb:592450", "nfl:12483", "nfl:401872657". */

import type { Sport } from '../../shared/props.js';

export const playerKey = (sport: Sport, id: number): string => `${sport}:${id}`;
export const gameKey = (sport: Sport, gamePk: number): string => `${sport}:${gamePk}`;

export function parseKey(key: string): { sport: Sport; id: number } {
  const i = key.indexOf(':');
  return { sport: key.slice(0, i) as Sport, id: Number(key.slice(i + 1)) };
}

export const isSport = (v: unknown): v is Sport => v === 'mlb' || v === 'nfl';
