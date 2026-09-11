/** MLB: the existing statsapi pipeline, unchanged, behind the adapter interface. */

import { getGameFeed } from '../services/mlbApi.js';
import { extractGameSnapshot, extractPlayerState, type GameSnapshot, type PlayerGameState } from '../services/statExtractor.js';
import { evaluateBet } from '../services/propEvaluator.js';
import { estimateWinProbability } from '../services/winProbability.js';
import { projectWorkload } from '../services/pitcherWorkload.js';
import { advanceDemo, buildDemoFeed, isDemoGame } from '../services/demoMode.js';
import { PROP_BY_KEY } from '../../shared/props.js';
import type { SportAdapter } from './types.js';

const liveColumns = (s: GameSnapshot) => ({
  status: s.status,
  detailedState: s.detailedState,
  homeScore: s.homeScore,
  awayScore: s.awayScore,
  inning: s.inning,
  inningState: s.inningState,
  outs: s.outs,
  balls: s.balls,
  strikes: s.strikes,
  onFirst: s.onFirst,
  onSecond: s.onSecond,
  onThird: s.onThird,
  currentPitcherId: s.currentPitcherId,
  currentPitcherName: s.currentPitcherName,
});

export const mlbAdapter: SportAdapter<GameSnapshot> = {
  sport: 'mlb',
  recheckSettledWhileLive: false,

  async fetchFeed(gamePk) {
    if (isDemoGame(gamePk)) {
      advanceDemo();
      return buildDemoFeed();
    }
    return getGameFeed(gamePk);
  },

  snapshot: (feed) => extractGameSnapshot(feed),

  gameRow: (s) => ({
    gameDate: s.gameDate ? new Date(s.gameDate) : new Date(),
    officialDate: (s.gameDate || new Date().toISOString()).slice(0, 10),
    homeTeamId: s.homeTeamId, homeName: s.homeName, homeAbbrev: s.homeAbbrev,
    awayTeamId: s.awayTeamId, awayName: s.awayName, awayAbbrev: s.awayAbbrev,
    ...liveColumns(s),
  }),

  gameUpdate: liveColumns,

  async evaluate(bets, feed, snapshot) {
    const out = new Map<string, Record<string, unknown>>();
    // One extraction per player, shared across that player's legs.
    const stateByPlayer = new Map<number, PlayerGameState>();

    for (const bet of bets) {
      if (bet.playerId == null) continue;
      let state = stateByPlayer.get(bet.playerId);
      if (!state) {
        state = extractPlayerState(feed, bet.playerId, snapshot);
        stateByPlayer.set(bet.playerId, state);
      }

      let evaluation;
      try {
        evaluation = evaluateBet(bet, state, snapshot);
      } catch (err) {
        console.error(`[mlb] bet ${bet.id}: ${(err as Error).message}`);
        continue;
      }

      let odds = { probability: 0, chancesLeft: 0, decided: false };
      try {
        odds = await estimateWinProbability(
          { ...bet, status: evaluation.status, currentValue: evaluation.currentValue },
          state,
          snapshot,
          bet.playerId,
        );
      } catch (err) {
        console.error(`[mlb] win prob for ${bet.id}: ${(err as Error).message}`);
      }

      let workload: { moreInnings: number; note: string; shortLeash: boolean } | null = null;
      if (PROP_BY_KEY[bet.betType]?.category === 'pitching') {
        try {
          const w = await projectWorkload(
            bet.playerId,
            { outs: state.pitching.outs, pitches: state.pitching.pitches, earnedRuns: state.pitching.earnedRuns },
            snapshot.status === 'Live',
          );
          workload = { moreInnings: w.moreInnings, note: w.note, shortLeash: w.shortLeash };
        } catch (err) {
          console.error(`[mlb] workload for ${bet.id}: ${(err as Error).message}`);
        }
      }

      out.set(bet.id, {
        currentValue: evaluation.currentValue,
        status: evaluation.status,
        progress: evaluation.progress,
        statsSnapshot: JSON.stringify({
          batting: state.batting,
          pitching: state.pitching,
          found: state.found,
          position: state.positionAbbrev,
          isCurrentPitcher: state.isCurrentPitcher,
        }),
        battingStatus: state.battingStatus.status,
        battersAway: state.battingStatus.battersAway ?? null,
        expectedInning: state.battingStatus.expectedInning ?? null,
        expectedHalf: state.battingStatus.expectedHalf ?? null,
        expectedInningsLeft: workload?.moreInnings ?? null,
        workloadNote: workload?.note || null,
        shortLeash: workload?.shortLeash ?? false,
        winProbability: odds.probability,
        chancesLeft: odds.chancesLeft,
      });
    }
    return out;
  },
};
