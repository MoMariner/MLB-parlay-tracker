/**
 * Season per-opportunity rates, the "how good are they at this" input to the
 * win-probability model. Cached for an hour -- a season line barely moves in
 * one game, and this must not add a request per bet per poll.
 */

const BASE = 'https://statsapi.mlb.com/api';
const TTL_MS = 60 * 60 * 1000;

export interface BattingRates {
  /** All per-plate-appearance. */
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  walk: number;
  hitByPitch: number;
  strikeout: number;
  stolenBase: number;
  /** Runs / RBIs not already implied by a home run, per PA. */
  runNonHr: number;
  rbiNonHr: number;
}

export interface PitchingRates {
  /** Per batter faced. */
  strikeout: number;
  walk: number;
  hit: number;
  earnedRunPerHit: number;
  pitchesPerBatter: number;
}

interface Entry { at: number; value: BattingRates | PitchingRates | null }
const cache = new Map<string, Entry>();

/**
 * League-average fallbacks, used when a player has too few plate appearances
 * for their own rates to mean anything (a September call-up, say).
 */
const LEAGUE_BATTING: BattingRates = {
  single: 0.150, double: 0.045, triple: 0.004, homeRun: 0.031,
  walk: 0.083, hitByPitch: 0.011, strikeout: 0.222, stolenBase: 0.012,
  runNonHr: 0.085, rbiNonHr: 0.075,
};

const LEAGUE_PITCHING: PitchingRates = {
  strikeout: 0.222, walk: 0.083, hit: 0.222,
  earnedRunPerHit: 0.36, pitchesPerBatter: 3.9,
};

function currentSeason(): number {
  const d = new Date();
  // Baseball's season is the calendar year; before April, last year's line is
  // the only meaningful sample.
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

/** Blend a player's own rate toward league average when the sample is thin. */
function shrink(playerRate: number, leagueRate: number, sample: number, stabilizeAt: number): number {
  const w = sample / (sample + stabilizeAt);
  return playerRate * w + leagueRate * (1 - w);
}

async function fetchBattingRates(playerId: number, season: number): Promise<BattingRates | null> {
  const res = await fetch(
    `${BASE}/v1/people/${playerId}/stats?stats=season&group=hitting&season=${season}`,
    { headers: { Accept: 'application/json', 'User-Agent': 'mlb-bet-tracker/1.0' } },
  );
  if (!res.ok) return null;
  const data: any = await res.json();
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  const pa = Number(s?.plateAppearances ?? 0);
  if (!s || pa < 1) return null;

  const hits = Number(s.hits ?? 0);
  const doubles = Number(s.doubles ?? 0);
  const triples = Number(s.triples ?? 0);
  const homeRuns = Number(s.homeRuns ?? 0);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);

  const raw: BattingRates = {
    single: singles / pa,
    double: doubles / pa,
    triple: triples / pa,
    homeRun: homeRuns / pa,
    walk: Number(s.baseOnBalls ?? 0) / pa,
    hitByPitch: Number(s.hitByPitch ?? 0) / pa,
    strikeout: Number(s.strikeOuts ?? 0) / pa,
    stolenBase: Number(s.stolenBases ?? 0) / pa,
    runNonHr: Math.max(0, Number(s.runs ?? 0) - homeRuns) / pa,
    rbiNonHr: Math.max(0, Number(s.rbi ?? 0) - homeRuns) / pa,
  };

  // ~120 PA before a rate is worth trusting on its own.
  const out = {} as BattingRates;
  for (const k of Object.keys(raw) as (keyof BattingRates)[]) {
    out[k] = shrink(raw[k], LEAGUE_BATTING[k], pa, 120);
  }
  return out;
}

async function fetchPitchingRates(playerId: number, season: number): Promise<PitchingRates | null> {
  const res = await fetch(
    `${BASE}/v1/people/${playerId}/stats?stats=season&group=pitching&season=${season}`,
    { headers: { Accept: 'application/json', 'User-Agent': 'mlb-bet-tracker/1.0' } },
  );
  if (!res.ok) return null;
  const data: any = await res.json();
  const s = data?.stats?.[0]?.splits?.[0]?.stat;
  const bf = Number(s?.battersFaced ?? 0);
  if (!s || bf < 1) return null;

  const hits = Number(s.hits ?? 0);
  const raw: PitchingRates = {
    strikeout: Number(s.strikeOuts ?? 0) / bf,
    walk: Number(s.baseOnBalls ?? 0) / bf,
    hit: hits / bf,
    earnedRunPerHit: hits > 0 ? Number(s.earnedRuns ?? 0) / hits : LEAGUE_PITCHING.earnedRunPerHit,
    pitchesPerBatter: Number(s.numberOfPitches ?? 0) > 0
      ? Number(s.numberOfPitches) / bf
      : LEAGUE_PITCHING.pitchesPerBatter,
  };

  return {
    strikeout: shrink(raw.strikeout, LEAGUE_PITCHING.strikeout, bf, 200),
    walk: shrink(raw.walk, LEAGUE_PITCHING.walk, bf, 200),
    hit: shrink(raw.hit, LEAGUE_PITCHING.hit, bf, 200),
    earnedRunPerHit: shrink(raw.earnedRunPerHit, LEAGUE_PITCHING.earnedRunPerHit, bf, 200),
    pitchesPerBatter: raw.pitchesPerBatter,
  };
}

export async function getSeasonRates(
  playerId: number,
  group: 'hitting' | 'pitching',
): Promise<BattingRates | PitchingRates | null> {
  // Demo players have no MLB history; league average keeps the demo honest.
  if (playerId < 0) return group === 'pitching' ? LEAGUE_PITCHING : LEAGUE_BATTING;

  const key = `${playerId}:${group}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const season = currentSeason();
  try {
    const value = group === 'pitching'
      ? await fetchPitchingRates(playerId, season)
      : await fetchBattingRates(playerId, season);
    // A player with no line yet still gets league average rather than nothing.
    const resolved = value ?? (group === 'pitching' ? LEAGUE_PITCHING : LEAGUE_BATTING);
    cache.set(key, { at: now, value: resolved });
    return resolved;
  } catch {
    return group === 'pitching' ? LEAGUE_PITCHING : LEAGUE_BATTING;
  }
}

export { LEAGUE_BATTING, LEAGUE_PITCHING };
