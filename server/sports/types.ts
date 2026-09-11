/**
 * The poller is sport-agnostic: it fetches one feed per game and hands it to
 * that sport's adapter, which knows how to read the situation and grade legs.
 */

import type { Bet, Player } from '@prisma/client';
import type { Sport } from '../../shared/props.js';

export type LegBet = Bet & { player: Player | null };

export type GameStatus = 'Preview' | 'Live' | 'Final' | 'Other';

export interface SportAdapter<S extends { status: GameStatus } = any> {
  sport: Sport;
  fetchFeed(gamePk: number): Promise<unknown>;
  snapshot(feed: any): S;
  /** Full Game row, written when a bet first references the game. */
  gameRow(s: S): Record<string, unknown>;
  /** The live columns refreshed on every poll. */
  gameUpdate(s: S): Record<string, unknown>;
  /** Grade every leg on this game from the single feed: bet id -> columns to write. */
  evaluate(bets: LegBet[], feed: any, s: S): Promise<Map<string, Record<string, unknown>>>;
  /**
   * Keep grading settled legs until the game ends. Football needs this: a
   * yardage over can fall back under, and a touchdown can be overturned.
   */
  recheckSettledWhileLive: boolean;
}
