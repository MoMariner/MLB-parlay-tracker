/**
 * ESPN NFL client.
 *
 * ESPN has no official stats API; these are the public site endpoints its own
 * apps use. They are picky about clients: curl gets 403 for most User-Agents,
 * but Node's own fetch is accepted as-is -- so no custom headers are sent.
 */

import { firstNameMatches, splitName, uniqueBy } from '../services/nameSearch.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const WEB = 'https://site.web.api.espn.com/apis/common/v3';

export interface NflPlayer {
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

/** Same shape the game picker already renders for MLB, plus football extras. */
export interface NflGameCard {
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
  homeLogo: string | null;
  awayLogo: string | null;
  inning: null;
  inningState: null;
  period: number | null;
  clock: string | null;
  marketTotal: number | null;
  marketSpread: number | null;
  oddsDetails: string | null;
}

interface CacheEntry { at: number; value: unknown }
const cache = new Map<string, CacheEntry>();

async function espnGet<T>(url: string, ttlMs: number): Promise<T> {
  const hit = cache.get(url);
  const now = Date.now();
  if (ttlMs > 0 && hit && now - hit.at < ttlMs) return hit.value as T;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url.replace(/^https:\/\/[^/]+/, '')}`);
  const value = (await res.json()) as T;
  if (ttlMs > 0) cache.set(url, { at: now, value });
  return value;
}

export function nflStatus(status: any): NflGameCard['status'] {
  const state = status?.type?.state;
  if (state === 'pre') return 'Preview';
  if (state === 'in') return 'Live';
  // "post" also covers postponed and cancelled games, which never complete.
  if (state === 'post') return status?.type?.completed === false ? 'Other' : 'Final';
  return 'Other';
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return num((v as any).value ?? (v as any).displayValue);
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function teamLogo(team: any): string | null {
  return team?.logo ?? team?.logos?.[0]?.href
    ?? (team?.abbreviation ? `https://a.espncdn.com/i/teamlogos/nfl/500/${String(team.abbreviation).toLowerCase()}.png` : null);
}

/** Map a scoreboard or schedule event onto the shared game-card shape. */
function mapEvent(e: any): NflGameCard | null {
  const c = e?.competitions?.[0];
  if (!c) return null;
  const home = c.competitors?.find((x: any) => x.homeAway === 'home');
  const away = c.competitors?.find((x: any) => x.homeAway === 'away');
  if (!home || !away) return null;
  const status = c.status ?? e.status;
  const odds = (c.odds ?? [])[0] ?? {};
  const date: string = e.date ?? c.date ?? '';

  return {
    gamePk: Number(e.id),
    gameDate: date,
    officialDate: date.slice(0, 10),
    status: nflStatus(status),
    detailedState: status?.type?.shortDetail ?? status?.type?.description ?? '',
    homeTeamId: Number(home.team?.id),
    homeName: home.team?.shortDisplayName ?? home.team?.displayName ?? '',
    homeAbbrev: home.team?.abbreviation ?? '',
    awayTeamId: Number(away.team?.id),
    awayName: away.team?.shortDisplayName ?? away.team?.displayName ?? '',
    awayAbbrev: away.team?.abbreviation ?? '',
    homeScore: num(home.score),
    awayScore: num(away.score),
    homeLogo: teamLogo(home.team),
    awayLogo: teamLogo(away.team),
    inning: null,
    inningState: null,
    period: num(status?.period),
    clock: status?.displayClock ?? null,
    marketTotal: num(odds.overUnder),
    marketSpread: num(odds.spread),
    oddsDetails: odds.details ?? null,
  };
}

// ---------------------------------------------------------------------------

const detailCache = new Map<number, { at: number; value: NflPlayer | null }>();

export async function nflGetPlayer(id: number): Promise<NflPlayer | null> {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  const data = await espnGet<any>(`${WEB}/sports/football/nfl/athletes/${id}`, 5 * 60_000);
  const a = data?.athlete;
  const value: NflPlayer | null = a ? {
    id: Number(a.id),
    fullName: a.displayName ?? a.fullName ?? '',
    teamId: num(a.team?.id),
    teamName: a.team?.displayName ?? null,
    teamAbbrev: a.team?.abbreviation ?? null,
    position: a.position?.abbreviation ?? null,
    positionType: a.position?.name ?? null,
    active: a.active !== false,
    jerseyNumber: a.jersey ?? null,
  } : null;
  detailCache.set(id, { at: Date.now(), value });
  return value;
}

/** One search request: NFL players only, in ESPN's relevance order. */
async function espnSearch(query: string, limit: number): Promise<any[]> {
  const data = await espnGet<any>(
    `${WEB}/search?query=${encodeURIComponent(query)}&limit=${limit}&mode=prefix&type=player&sport=football&league=nfl`,
    60_000,
  );
  return (data?.items ?? []).filter((i: any) => i.league === 'nfl' && i.type === 'player');
}

/**
 * Name search. The search index carries no position, so the top results are
 * enriched with a (cached) detail lookup -- the position badge is what tells
 * a QB named "Smith" apart from a receiver named "Smith".
 */
export async function nflSearchPlayers(query: string, limit = 8): Promise<NflPlayer[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // ESPN matches only the name as listed, so "matt stafford" misses Matthew
  // Stafford. Search the surname too and keep the first names that fit.
  const split = splitName(q);
  const [direct, sameSurname] = await Promise.all([
    espnSearch(q, limit * 2),
    split ? espnSearch(split.surname, 50).catch(() => []) : [],
  ]);
  const nicknamed = split
    ? sameSurname.filter((i) => firstNameMatches(split.first, [String(i.displayName ?? '').split(' ')[0]]))
    : [];
  const items = uniqueBy([...direct, ...nicknamed], (i) => String(i.id));
  // Active players first; retired ones rarely have a prop.
  items.sort((a, b) => Number(b.isActive !== false) - Number(a.isActive !== false));

  const top = items.slice(0, limit);
  const detailed = await Promise.all(top.map((i) => nflGetPlayer(Number(i.id)).catch(() => null)));
  return top.map((i, idx) => detailed[idx] ?? {
    id: Number(i.id),
    fullName: i.displayName,
    teamId: null,
    teamName: i.teamRelationships?.[0]?.displayName ?? null,
    teamAbbrev: null,
    position: null,
    positionType: null,
    active: i.isActive !== false,
    jerseyNumber: i.jersey ?? null,
  });
}

/** A player's games: anything live or recent, then the next few weeks. */
export async function nflGetPlayerGames(id: number): Promise<NflGameCard[]> {
  const player = await nflGetPlayer(id);
  if (!player?.teamId) return [];
  const data = await espnGet<any>(`${SITE}/teams/${player.teamId}/schedule`, 60_000);
  const now = Date.now();
  const games: NflGameCard[] = (data?.events ?? [])
    .map(mapEvent)
    .filter((g: NflGameCard | null): g is NflGameCard => {
      if (!g) return false;
      const t = new Date(g.gameDate).getTime();
      return t > now - 2 * 86_400_000 && t < now + 22 * 86_400_000;
    })
    .sort((a: NflGameCard, b: NflGameCard) => a.gameDate.localeCompare(b.gameDate));
  if (!games.some((g) => g.status === 'Live')) return games;

  // The team schedule leaves a game's score blank until it's final. The
  // scoreboard has it live -- same URL and cache as the slate, so this is
  // usually free.
  const board = await espnGet<any>(`${SITE}/scoreboard`, 30_000).catch(() => null);
  const live = new Map<number, NflGameCard>();
  for (const e of board?.events ?? []) {
    const g = mapEvent(e);
    if (g) live.set(g.gamePk, g);
  }
  return games.map((g) => live.get(g.gamePk) ?? g);
}

/** The current week's slate, with market totals and spreads for game lines. */
export async function nflGetSlate(): Promise<NflGameCard[]> {
  const data = await espnGet<any>(`${SITE}/scoreboard`, 30_000);
  const games: NflGameCard[] = (data?.events ?? [])
    .map(mapEvent)
    .filter((g: NflGameCard | null): g is NflGameCard => g != null)
    .sort((a: NflGameCard, b: NflGameCard) => a.gameDate.localeCompare(b.gameDate));

  // The scoreboard drops a game's odds at kickoff, but the game summary keeps
  // them (pickcenter). Backfill so a live game still offers its market spread
  // and total as the default line -- one cached request per live game.
  await Promise.all(games
    .filter((g) => g.status === 'Live' && g.marketTotal == null && g.marketSpread == null)
    .map(async (g) => {
      try {
        const summary = await espnGet<any>(`${SITE}/summary?event=${g.gamePk}`, 10 * 60_000);
        const pick = (summary?.pickcenter ?? [])[0] ?? {};
        g.marketTotal = num(pick.overUnder);
        g.marketSpread = num(pick.spread);
        g.oddsDetails = pick.details ?? g.oddsDetails;
      } catch {
        // No line to offer; the picker falls back to typed-in lines.
      }
    }));

  return games;
}

/** Full game summary -- box score, drives, win probability. Never cached. */
export async function nflGetSummary(eventId: number): Promise<any> {
  return espnGet<any>(`${SITE}/summary?event=${eventId}`, 0);
}

/** Per-game log for one season (defaults to ESPN's latest). */
export async function nflGetGameLog(id: number, season?: number): Promise<any> {
  const q = season ? `?season=${season}` : '';
  return espnGet<any>(`${WEB}/sports/football/nfl/athletes/${id}/gamelog${q}`, 60 * 60_000);
}

export async function nflCheckApi(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${SITE}/scoreboard`);
    return { ok: res.ok, latencyMs: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}
