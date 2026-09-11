/** NFL: ESPN game summaries, graded by the football evaluator. */

import { nflGetSummary } from '../nfl/espnApi.js';
import { extractNflSnapshot, extractNflLine, EMPTY_NFL_LINE, type NflSnapshot, type NflLine } from '../nfl/stats.js';
import { nflValue, evaluateNflLeg } from '../nfl/evaluator.js';
import { nflLegProbability } from '../nfl/winProbability.js';
import { PROP_BY_KEY, type PropDef } from '../../shared/props.js';
import type { SportAdapter } from './types.js';

const liveColumns = (s: NflSnapshot) => ({
  status: s.status,
  detailedState: s.detailedState,
  homeScore: s.homeScore,
  awayScore: s.awayScore,
  homeLogo: s.homeLogo,
  awayLogo: s.awayLogo,
  period: s.period,
  clock: s.clock,
  possessionTeamId: s.possessionTeamId,
  down: s.down,
  distance: s.distance,
  yardsToEndzone: s.yardsToEndzone,
  downDistanceText: s.downDistanceText,
  isRedZone: s.isRedZone,
  lastPlay: s.lastPlay,
  homeLinescores: s.homeLinescores,
  awayLinescores: s.awayLinescores,
  homeWinProb: s.homeWinProb,
  // Keep the pregame line once it's been seen; books pull it at kickoff.
  ...(s.marketTotal != null ? { marketTotal: s.marketTotal } : {}),
  ...(s.marketSpread != null ? { marketSpread: s.marketSpread } : {}),
});

/**
 * Football's "coming up": is this player's unit on the field right now?
 * Offense needs the ball; a defender plays while the other team has it.
 */
function fieldStatus(def: PropDef, s: NflSnapshot, teamId: number | null): string | null {
  if (s.status === 'Preview') return 'GAME_NOT_STARTED';
  if (s.status === 'Final') return 'GAME_FINAL';
  if (s.status === 'Other') return 'POSTPONED';
  if (def.scope === 'game') return null;
  if (/halftime/i.test(s.detailedState)) return 'HALFTIME';
  if (s.possessionTeamId == null || teamId == null) return 'BETWEEN_PLAYS';

  const hasBall = s.possessionTeamId === teamId;
  if (def.category === 'defense') return hasBall ? 'OFF_FIELD' : 'ON_DEFENSE';
  if (def.category === 'kicking') {
    if (!hasBall) return 'OFF_FIELD';
    return (s.yardsToEndzone ?? 100) <= 40 ? 'IN_FG_RANGE' : 'ON_OFFENSE';
  }
  if (!hasBall) return 'OFF_FIELD';
  return s.isRedZone ? 'RED_ZONE' : 'ON_OFFENSE';
}

export const nflAdapter: SportAdapter<NflSnapshot> = {
  sport: 'nfl',
  recheckSettledWhileLive: true,

  fetchFeed: (gamePk) => nflGetSummary(gamePk),

  snapshot: (feed) => extractNflSnapshot(feed),

  gameRow: (s) => ({
    gameDate: s.gameDate ? new Date(s.gameDate) : new Date(),
    officialDate: (s.gameDate || new Date().toISOString()).slice(0, 10),
    homeTeamId: s.homeTeamId, homeName: s.homeName, homeAbbrev: s.homeAbbrev,
    awayTeamId: s.awayTeamId, awayName: s.awayName, awayAbbrev: s.awayAbbrev,
    ...liveColumns(s),
  }),

  gameUpdate: liveColumns,

  async evaluate(bets, feed, s) {
    const out = new Map<string, Record<string, unknown>>();
    const lines = new Map<number, NflLine>();

    for (const bet of bets) {
      const def = PROP_BY_KEY[bet.betType];
      if (!def) continue;

      let line: NflLine = EMPTY_NFL_LINE;
      if (def.scope !== 'game' && bet.playerId != null) {
        line = lines.get(bet.playerId) ?? extractNflLine(feed, bet.playerId);
        lines.set(bet.playerId, line);
      }
      const teamId = def.scope === 'game' ? bet.teamId : (line.teamId ?? bet.teamId);

      let value: number;
      try {
        value = nflValue(bet.betType, line, s, teamId, bet.source);
      } catch (err) {
        console.error(`[nfl] bet ${bet.id}: ${(err as Error).message}`);
        continue;
      }

      const ev = evaluateNflLeg(bet, def, value, s);
      const prob = await nflLegProbability(
        { ...bet, status: ev.status, athleteId: bet.playerId },
        def,
        value,
        s,
      ).catch((err) => {
        console.error(`[nfl] win prob for ${bet.id}: ${(err as Error).message}`);
        return { probability: 0, paceValue: null };
      });

      out.set(bet.id, {
        currentValue: value,
        status: ev.status,
        // A side has no "distance to the line" -- its bar is its chance to cover.
        progress: def.sides === 'team' ? prob.probability : ev.progress,
        winProbability: prob.probability,
        paceValue: prob.paceValue,
        fieldStatus: fieldStatus(def, s, teamId),
        statsSnapshot: def.scope === 'game' ? null : JSON.stringify({ nfl: line }),
        chancesLeft: null,
      });
    }
    return out;
  },
};
