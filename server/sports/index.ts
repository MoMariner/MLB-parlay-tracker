import { mlbAdapter } from './mlbAdapter.js';
import { nflAdapter } from './nflAdapter.js';
import type { SportAdapter } from './types.js';

export const ADAPTERS: Record<string, SportAdapter> = { mlb: mlbAdapter, nfl: nflAdapter };

export function adapterFor(sport: string): SportAdapter {
  const adapter = ADAPTERS[sport];
  if (!adapter) throw new Error(`Unsupported sport: ${sport}`);
  return adapter;
}

export * from './keys.js';
export type { SportAdapter, LegBet, GameStatus } from './types.js';
