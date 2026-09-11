/**
 * Per-game history from ESPN game logs -- the "how much does he usually do"
 * input to the NFL win-probability model.
 *
 * Early in a season a player has one or two games, which says little. When
 * the current season is thin, last season's regular season is folded in.
 */

import { nflGetGameLog } from './espnApi.js';
import { unpack, EMPTY_NFL_LINE, type NflLine } from './stats.js';
import { scoreNflFantasy } from './fantasy.js';

export interface NflGameRow {
  season: number;
  values: Record<string, number>;
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<number, { at: number; rows: NflGameRow[] }>();

/** Football seasons straddle New Year: January and February belong to last year. */
export function currentNflSeason(d = new Date()): number {
  return d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear();
}

function parseRegularSeason(log: any): { season: number | null; rows: NflGameRow[] } {
  const names: string[] = log?.names ?? [];
  const rows: NflGameRow[] = [];
  let season: number | null = null;

  for (const st of log?.seasonTypes ?? []) {
    // Playoff games distort a per-game rate (fewer, higher-leverage games).
    if (!/regular/i.test(st?.displayName ?? '')) continue;
    const year = Number(String(st.displayName).match(/(\d{4})/)?.[1]) || null;
    season = year ?? season;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        const values: Record<string, number> = {};
        names.forEach((n, i) => Object.assign(values, unpack(n, ev.stats?.[i])));
        rows.push({ season: year ?? 0, values });
      }
    }
  }
  return { season, rows };
}

export async function getNflGameRows(athleteId: number): Promise<NflGameRow[]> {
  const hit = cache.get(athleteId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const latest = await nflGetGameLog(athleteId).catch(() => null);
  const { season, rows: current } = parseRegularSeason(latest);
  let rows = current;

  if (rows.length < 6) {
    const prevSeason = (season ?? currentNflSeason()) - 1;
    const prev = await nflGetGameLog(athleteId, prevSeason).catch(() => null);
    rows = [...rows, ...parseRegularSeason(prev).rows];
  }

  rows = rows.slice(0, 17);
  cache.set(athleteId, { at: Date.now(), rows });
  return rows;
}

/** A game-log row as a box-score line, so fantasy points score identically. */
function rowAsLine(v: Record<string, number>): NflLine {
  const n = (k: string) => v[k] ?? 0;
  return {
    ...structuredClone(EMPTY_NFL_LINE),
    found: true,
    passing: {
      completions: n('completions'), attempts: n('passingAttempts'), yards: n('passingYards'),
      touchdowns: n('passingTouchdowns'), interceptions: n('interceptions'), sacks: n('sacks'),
    },
    rushing: { attempts: n('rushingAttempts'), yards: n('rushingYards'), touchdowns: n('rushingTouchdowns'), long: n('longRushing') },
    receiving: {
      receptions: n('receptions'), targets: n('receivingTargets'), yards: n('receivingYards'),
      touchdowns: n('receivingTouchdowns'), long: n('longReception'),
    },
    fumbles: { fumbles: n('fumbles'), lost: n('fumblesLost') },
  };
}

/** What a prop would have read in one historical game. */
export function statFromRow(betType: string, v: Record<string, number>, source: string): number {
  const n = (k: string) => v[k] ?? 0;
  switch (betType) {
    case 'NFL_PASS_YARDS':           return n('passingYards');
    case 'NFL_PASS_TDS':             return n('passingTouchdowns');
    case 'NFL_PASS_COMPLETIONS':     return n('completions');
    case 'NFL_PASS_ATTEMPTS':        return n('passingAttempts');
    case 'NFL_INTERCEPTIONS_THROWN': return n('interceptions');
    case 'NFL_PASS_RUSH_YARDS':      return n('passingYards') + n('rushingYards');
    case 'NFL_RUSH_YARDS':           return n('rushingYards');
    case 'NFL_RUSH_ATTEMPTS':        return n('rushingAttempts');
    case 'NFL_RUSH_TDS':             return n('rushingTouchdowns');
    case 'NFL_LONGEST_RUSH':         return n('longRushing');
    case 'NFL_RUSH_REC_YARDS':       return n('rushingYards') + n('receivingYards');
    case 'NFL_REC_YARDS':            return n('receivingYards');
    case 'NFL_RECEPTIONS':           return n('receptions');
    case 'NFL_REC_TDS':              return n('receivingTouchdowns');
    case 'NFL_LONGEST_REC':          return n('longReception');
    case 'NFL_ANYTIME_TD':           return n('rushingTouchdowns') + n('receivingTouchdowns');
    case 'NFL_FG_MADE':              return n('fieldGoalsMade');
    case 'NFL_KICKING_POINTS':       return n('totalKickingPoints');
    case 'NFL_XP_MADE':              return n('extraPointsMade');
    case 'NFL_TACKLES':              return n('totalTackles');
    case 'NFL_SACKS':                return n('sacks');
    case 'NFL_DEF_INTERCEPTIONS':    return n('interceptions');
    case 'NFL_FANTASY_POINTS':       return scoreNflFantasy(rowAsLine(v), source);
    default:                         return 0;
  }
}
