/**
 * Turns one ESPN game summary into the game situation and per-player stat
 * lines. Pure functions: the poller fetches the summary once per game and
 * calls these for every leg riding on it.
 */

import { nflStatus, teamLogo } from './espnApi.js';

export interface NflSnapshot {
  status: 'Preview' | 'Live' | 'Final' | 'Other';
  detailedState: string;
  gameDate: string;
  homeTeamId: number;
  homeName: string;
  homeAbbrev: string;
  awayTeamId: number;
  awayName: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  homeLogo: string | null;
  awayLogo: string | null;
  period: number | null;
  clock: string | null;
  possessionTeamId: number | null;
  down: number | null;
  distance: number | null;
  yardsToEndzone: number | null;
  downDistanceText: string | null;
  isRedZone: boolean;
  lastPlay: string | null;
  homeLinescores: string | null;
  awayLinescores: string | null;
  homeWinProb: number | null;
  marketTotal: number | null;
  marketSpread: number | null;
}

export interface NflLine {
  found: boolean;
  teamId: number | null;
  passing: { completions: number; attempts: number; yards: number; touchdowns: number; interceptions: number; sacks: number };
  rushing: { attempts: number; yards: number; touchdowns: number; long: number };
  receiving: { receptions: number; targets: number; yards: number; touchdowns: number; long: number };
  fumbles: { fumbles: number; lost: number };
  defense: { tackles: number; solo: number; sacks: number; tfl: number; passesDefended: number; qbHits: number; touchdowns: number; interceptions: number };
  kicking: { fgMade: number; fgAttempts: number; xpMade: number; xpAttempts: number; points: number; long: number };
  returns: { kickTouchdowns: number; puntTouchdowns: number };
}

export const EMPTY_NFL_LINE: NflLine = {
  found: false,
  teamId: null,
  passing: { completions: 0, attempts: 0, yards: 0, touchdowns: 0, interceptions: 0, sacks: 0 },
  rushing: { attempts: 0, yards: 0, touchdowns: 0, long: 0 },
  receiving: { receptions: 0, targets: 0, yards: 0, touchdowns: 0, long: 0 },
  fumbles: { fumbles: 0, lost: 0 },
  defense: { tackles: 0, solo: 0, sacks: 0, tfl: 0, passesDefended: 0, qbHits: 0, touchdowns: 0, interceptions: 0 },
  kicking: { fgMade: 0, fgAttempts: 0, xpMade: 0, xpAttempts: 0, points: 0, long: 0 },
  returns: { kickTouchdowns: 0, puntTouchdowns: 0 },
};

/** "1,357" -> 1357, "--" / "-" / "" -> 0, "-3" -> -3. */
export function statNum(raw: unknown): number {
  if (raw == null) return 0;
  const s = String(raw).replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '--') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Some box-score columns pack two numbers: "completions/passingAttempts" is
 * "20/30", "sacks-sackYardsLost" is "2-13". Only split when the KEY names a
 * pair -- a plain column like receivingYards can legitimately read "-3".
 */
export function unpack(key: string, raw: unknown): Record<string, number> {
  for (const sep of ['/', '-']) {
    if (key.includes(sep)) {
      const names = key.split(sep);
      const values = String(raw ?? '').split(sep);
      return Object.fromEntries(names.map((n, i) => [n, statNum(values[i])]));
    }
  }
  return { [key]: statNum(raw) };
}

/** Clock and quarter from "8:42 - 3rd", "Halftime", "End of 1st", "OT". */
function parseShortDetail(detail: string | undefined): { period: number | null; clock: string | null } {
  if (!detail) return { period: null, clock: null };
  const d = detail.toLowerCase();
  if (d.includes('halftime')) return { period: 2, clock: '0:00' };
  const ord = d.match(/(\d)(st|nd|rd|th)/);
  const clock = detail.match(/(\d{1,2}:\d{2})/)?.[1] ?? null;
  if (d.includes('ot')) return { period: 5, clock };
  if (d.startsWith('end of') && ord) return { period: Number(ord[1]), clock: '0:00' };
  return { period: ord ? Number(ord[1]) : null, clock };
}

export function extractNflSnapshot(summary: any): NflSnapshot {
  const comp = summary?.header?.competitions?.[0] ?? {};
  const status = comp.status ?? {};
  const home = comp.competitors?.find((c: any) => c.homeAway === 'home') ?? {};
  const away = comp.competitors?.find((c: any) => c.homeAway === 'away') ?? {};
  const mapped = nflStatus(status);

  // The in-progress drive's last play ends where the next one starts, which
  // is exactly the current down, distance and field position.
  const drives = summary?.drives ?? {};
  const currentPlays: any[] = drives.current?.plays ?? [];
  const previousDrives: any[] = drives.previous ?? [];
  const lastDrive = previousDrives[previousDrives.length - 1];
  const lastPlay = currentPlays[currentPlays.length - 1]
    ?? lastDrive?.plays?.[lastDrive.plays.length - 1];
  const spot = mapped === 'Live' ? (summary?.situation ?? lastPlay?.end ?? null) : null;

  const parsed = parseShortDetail(status.type?.shortDetail);
  const period = statNum(status.period) || parsed.period || lastPlay?.period?.number || null;
  const clock = status.displayClock ?? parsed.clock ?? lastPlay?.clock?.displayValue ?? null;

  const possessionComp = comp.competitors?.find((c: any) => c.possession === true);
  const possessionTeamId = mapped === 'Live'
    ? Number(possessionComp?.team?.id ?? drives.current?.team?.id ?? spot?.team?.id) || null
    : null;

  const yardsToEndzone = spot?.yardsToEndzone != null ? statNum(spot.yardsToEndzone) : null;

  const wp: any[] = summary?.winprobability ?? [];
  const pick = (summary?.pickcenter ?? [])[0] ?? {};
  const lines = (c: any) => {
    const ls = (c?.linescores ?? []).map((x: any) => statNum(x.displayValue ?? x.value));
    return ls.length ? JSON.stringify(ls) : null;
  };
  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

  return {
    status: mapped,
    detailedState: status.type?.shortDetail ?? status.type?.description ?? '',
    gameDate: comp.date ?? '',
    homeTeamId: Number(home.team?.id) || 0,
    homeName: home.team?.shortDisplayName ?? home.team?.displayName ?? '',
    homeAbbrev: home.team?.abbreviation ?? '',
    awayTeamId: Number(away.team?.id) || 0,
    awayName: away.team?.shortDisplayName ?? away.team?.displayName ?? '',
    awayAbbrev: away.team?.abbreviation ?? '',
    homeScore: statNum(home.score),
    awayScore: statNum(away.score),
    homeLogo: teamLogo(home.team),
    awayLogo: teamLogo(away.team),
    period: mapped === 'Preview' ? null : period,
    clock: mapped === 'Live' ? clock : null,
    possessionTeamId,
    down: spot?.down != null && statNum(spot.down) > 0 ? statNum(spot.down) : null,
    distance: spot?.distance != null ? statNum(spot.distance) : null,
    yardsToEndzone,
    downDistanceText: spot?.downDistanceText ?? null,
    isRedZone: mapped === 'Live' && yardsToEndzone != null && yardsToEndzone > 0 && yardsToEndzone <= 20,
    lastPlay: mapped === 'Live' ? (lastPlay?.text ?? null) : null,
    homeLinescores: lines(home),
    awayLinescores: lines(away),
    homeWinProb: wp.length ? numOrNull(wp[wp.length - 1]?.homeWinPercentage) : null,
    marketTotal: numOrNull(pick.overUnder),
    marketSpread: numOrNull(pick.spread),
  };
}

/**
 * One player's full stat line. Stats are read per CATEGORY, because the same
 * column name means different things in different tables -- "interceptions"
 * is a QB's mistake under passing and a defender's play under interceptions.
 */
export function extractNflLine(summary: any, athleteId: number): NflLine {
  const teams: any[] = summary?.boxscore?.players ?? [];
  const cats: Record<string, Record<string, number>> = {};
  let teamId: number | null = null;

  for (const team of teams) {
    for (const cat of team.statistics ?? []) {
      const row = (cat.athletes ?? []).find((a: any) => Number(a.athlete?.id) === athleteId);
      if (!row) continue;
      teamId = Number(team.team?.id) || teamId;
      const bucket = (cats[cat.name] ??= {});
      (cat.keys ?? []).forEach((key: string, i: number) => Object.assign(bucket, unpack(key, row.stats?.[i])));
    }
  }

  const g = (cat: string, key: string) => cats[cat]?.[key] ?? 0;
  if (Object.keys(cats).length === 0) return { ...structuredClone(EMPTY_NFL_LINE) };

  return {
    found: true,
    teamId,
    passing: {
      completions: g('passing', 'completions'),
      attempts: g('passing', 'passingAttempts'),
      yards: g('passing', 'passingYards'),
      touchdowns: g('passing', 'passingTouchdowns'),
      interceptions: g('passing', 'interceptions'),
      sacks: g('passing', 'sacks'),
    },
    rushing: {
      attempts: g('rushing', 'rushingAttempts'),
      yards: g('rushing', 'rushingYards'),
      touchdowns: g('rushing', 'rushingTouchdowns'),
      long: g('rushing', 'longRushing'),
    },
    receiving: {
      receptions: g('receiving', 'receptions'),
      targets: g('receiving', 'receivingTargets'),
      yards: g('receiving', 'receivingYards'),
      touchdowns: g('receiving', 'receivingTouchdowns'),
      long: g('receiving', 'longReception'),
    },
    fumbles: { fumbles: g('fumbles', 'fumbles'), lost: g('fumbles', 'fumblesLost') },
    defense: {
      tackles: g('defensive', 'totalTackles'),
      solo: g('defensive', 'soloTackles'),
      sacks: g('defensive', 'sacks'),
      tfl: g('defensive', 'tacklesForLoss'),
      passesDefended: g('defensive', 'passesDefended'),
      qbHits: g('defensive', 'QBHits'),
      touchdowns: g('defensive', 'defensiveTouchdowns'),
      interceptions: g('interceptions', 'interceptions'),
    },
    kicking: {
      fgMade: g('kicking', 'fieldGoalsMade'),
      fgAttempts: g('kicking', 'fieldGoalAttempts'),
      xpMade: g('kicking', 'extraPointsMade'),
      xpAttempts: g('kicking', 'extraPointAttempts'),
      points: g('kicking', 'totalKickingPoints'),
      long: g('kicking', 'longFieldGoalMade'),
    },
    returns: {
      kickTouchdowns: g('kickReturns', 'kickReturnTouchdowns'),
      puntTouchdowns: g('puntReturns', 'puntReturnTouchdowns'),
    },
  };
}
