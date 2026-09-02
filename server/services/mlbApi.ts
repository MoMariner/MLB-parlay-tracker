/**
 * MLB Stats API client (spec §24 -- everything here hits the real API).
 *
 * Responses are cached briefly so a debounced search box or several bets on
 * one game don't hammer statsapi.
 */

const BASE = 'https://statsapi.mlb.com/api';

export interface MlbPlayer {
  id: number;
  fullName: string;
  teamId: number | null;
  teamName: string | null;
  teamAbbrev: string | null;
  position: string | null;
  positionType: string | null;
  active: boolean;
  jerseyNumber: string | null;
}

export interface MlbGame {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  status: 'Preview' | 'Live' | 'Final' | 'Other';
  detailedState: string;
  homeTeamId: number;
  homeName: string;
  homeAbbrev: string;
  awayTeamId: number;
  awayName: string;
  awayAbbrev: string;
  homeScore: number | null;
  awayScore: number | null;
  inning: number | null;
  inningState: string | null;
}

interface CacheEntry { at: number; value: unknown }
const cache = new Map<string, CacheEntry>();

async function getJson<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;

  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'mlb-bet-tracker/1.0' },
  });
  if (!res.ok) throw new Error(`MLB API ${res.status} ${res.statusText} for ${path}`);
  const value = (await res.json()) as T;
  cache.set(path, { at: now, value });
  return value;
}

function toStatus(abstract: string | undefined): MlbGame['status'] {
  return abstract === 'Preview' || abstract === 'Live' || abstract === 'Final' ? abstract : 'Other';
}

function mapGame(g: any): MlbGame {
  return {
    gamePk: g.gamePk,
    gameDate: g.gameDate,
    officialDate: g.officialDate ?? (g.gameDate ?? '').slice(0, 10),
    status: toStatus(g.status?.abstractGameState),
    detailedState: g.status?.detailedState ?? '',
    homeTeamId: g.teams?.home?.team?.id ?? 0,
    homeName: g.teams?.home?.team?.teamName ?? g.teams?.home?.team?.name ?? '',
    homeAbbrev: g.teams?.home?.team?.abbreviation ?? '',
    awayTeamId: g.teams?.away?.team?.id ?? 0,
    awayName: g.teams?.away?.team?.teamName ?? g.teams?.away?.team?.name ?? '',
    awayAbbrev: g.teams?.away?.team?.abbreviation ?? '',
    homeScore: g.teams?.home?.score ?? null,
    awayScore: g.teams?.away?.score ?? null,
    inning: g.linescore?.currentInning ?? null,
    inningState: g.linescore?.inningState ?? null,
  };
}

/**
 * teamId -> abbreviation. The single-player endpoint's `currentTeam` hydrate
 * only carries {id, name, link}, so abbreviations come from one cached call
 * to the teams list rather than a request per player.
 */
let teamAbbrevs: Map<number, string> | null = null;

async function loadTeamAbbrevs(): Promise<Map<number, string>> {
  if (teamAbbrevs) return teamAbbrevs;
  const data = await getJson<{ teams?: any[] }>('/v1/teams?sportId=1', 24 * 60 * 60_000);
  const map = new Map<number, string>();
  for (const t of data.teams ?? []) {
    if (t?.id && t?.abbreviation) map.set(t.id, t.abbreviation);
  }
  teamAbbrevs = map;
  return map;
}

export async function getTeamAbbrev(teamId: number | null | undefined): Promise<string | null> {
  if (!teamId) return null;
  try {
    return (await loadTeamAbbrevs()).get(teamId) ?? null;
  } catch {
    return null;
  }
}

/** Fill in abbreviations the person endpoint leaves blank. */
export async function withTeamAbbrev(player: MlbPlayer): Promise<MlbPlayer> {
  if (player.teamAbbrev || !player.teamId) return player;
  return { ...player, teamAbbrev: await getTeamAbbrev(player.teamId) };
}

function mapPerson(p: any): MlbPlayer {
  return {
    id: p.id,
    fullName: p.fullName,
    teamId: p.currentTeam?.id ?? null,
    teamName: p.currentTeam?.name ?? null,
    teamAbbrev: p.currentTeam?.abbreviation ?? null,
    position: p.primaryPosition?.abbreviation ?? null,
    positionType: p.primaryPosition?.type ?? null,
    active: p.active === true,
    jerseyNumber: p.primaryNumber ?? null,
  };
}

/**
 * Spec §1 -- name search. The upstream endpoint also returns retired players
 * and minor leaguers, so active big-leaguers are floated to the top and the
 * list is trimmed.
 */
export async function searchPlayers(query: string, limit = 12): Promise<MlbPlayer[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const data = await getJson<{ people?: any[] }>(
    `/v1/people/search?names=${encodeURIComponent(q)}&sportIds=1&hydrate=currentTeam&limit=60`,
    60_000,
  );

  const people = (data.people ?? []).map(mapPerson);
  const lower = q.toLowerCase();

  const ranked = people
    .sort((a, b) => {
      // Active players first, then those on a big-league club, then by how
      // early the query matches their name.
      if (a.active !== b.active) return a.active ? -1 : 1;
      const aTeam = a.teamId ? 0 : 1;
      const bTeam = b.teamId ? 0 : 1;
      if (aTeam !== bTeam) return aTeam - bTeam;
      const ai = a.fullName.toLowerCase().indexOf(lower);
      const bi = b.fullName.toLowerCase().indexOf(lower);
      if (ai !== bi) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      return a.fullName.localeCompare(b.fullName);
    })
    .slice(0, limit);

  return Promise.all(ranked.map(withTeamAbbrev));
}

export async function getPlayer(playerId: number): Promise<MlbPlayer | null> {
  const data = await getJson<{ people?: any[] }>(
    `/v1/people/${playerId}?hydrate=currentTeam`,
    5 * 60_000,
  );
  const p = data.people?.[0];
  return p ? withTeamAbbrev(mapPerson(p)) : null;
}

export async function getSchedule(startDate: string, endDate: string, teamId?: number): Promise<MlbGame[]> {
  const teamParam = teamId ? `&teamId=${teamId}` : '';
  const data = await getJson<{ dates?: any[] }>(
    `/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}${teamParam}&hydrate=team,linescore`,
    30_000,
  );
  const games: MlbGame[] = [];
  for (const d of data.dates ?? []) for (const g of d.games ?? []) games.push(mapGame(g));
  return games.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}

/**
 * Spec §3 -- the games a player could be in. Yesterday through +7 days, so a
 * game still in progress past midnight UTC is still offered.
 */
export async function getPlayerGames(playerId: number, daysAhead = 7): Promise<MlbGame[]> {
  const player = await getPlayer(playerId);
  if (!player?.teamId) return [];
  const start = isoDate(-1);
  const end = isoDate(daysAhead);
  return getSchedule(start, end, player.teamId);
}

/** Full live feed for one game. Never cached -- the poller controls cadence. */
export async function getGameFeed(gamePk: number): Promise<any> {
  const res = await fetch(`${BASE}/v1.1/game/${gamePk}/feed/live`, {
    headers: { Accept: 'application/json', 'User-Agent': 'mlb-bet-tracker/1.0' },
  });
  if (!res.ok) throw new Error(`MLB feed ${res.status} for game ${gamePk}`);
  return res.json();
}

export async function checkApiStatus(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/v1/sports/1`, { headers: { Accept: 'application/json' } });
    return { ok: res.ok, latencyMs: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}

/** Local-calendar date offset by N days, as YYYY-MM-DD. */
export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
