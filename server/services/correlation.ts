/**
 * Same-game parlay correlation.
 *
 * Multiplying leg probabilities assumes the legs are independent. They aren't
 * when they ride the same game: if Buffalo runs away with it, the spread, the
 * first quarter and Josh Allen's rushing yards all tend to land together, so
 * the chance of hitting every one of them is better than the product.
 * Sportsbooks price same-game parlays this way too, which is why they pay less
 * than the multiplied odds.
 *
 * Each leg gets a latent score built from factors the legs share -- how much
 * scoring the game produces, which way the margin runs, how each team's
 * passing and running games go, how one player's own day goes -- plus noise of
 * its own. The leg wins when that score clears a threshold set so that, taken
 * alone, it still hits exactly as often as its own win probability says. The
 * numbers on each row therefore don't move; only the joint does.
 *
 * The loadings below are judgement, not fitted values: they say which way
 * things move together and roughly how hard, which is most of the distance
 * between this and multiplying.
 */

import { PROP_BY_KEY } from '../../shared/props.js';
// Plain maths that happens to live with the football model.
import { normInv } from '../nfl/winProbability.js';

/** Draws per estimate; 20k keeps the sampling error near a fifth of a point. */
const DRAWS = 20_000;
/** Most of a leg that shared factors may explain -- the rest is its own day. */
const MAX_SHARED = 0.9;

export interface CorrelatedLeg {
  id: string;
  probability: number;
  betType: string;
  direction: string;
  gameKey: string;
  teamId: number | null;
  playerKey: string | null;
  homeTeamId: number;
  awayTeamId: number;
}

type Loads = Record<string, number>;

/**
 * What a leg leans on. Positive means the leg is helped when that factor runs
 * high: more scoring in the game, the home side pulling ahead, a team's
 * passing game working, one player having a day.
 */
function loadingsFor(leg: CorrelatedLeg): Loads {
  const def = PROP_BY_KEY[leg.betType];
  const g = leg.gameKey;
  const team = leg.teamId;
  const opponent = team == null ? null : team === leg.homeTeamId ? leg.awayTeamId : leg.homeTeamId;
  // The margin factor runs home-positive, so an away pick reads it backwards.
  const side = team == null ? 0 : team === leg.homeTeamId ? 1 : -1;

  const L: Loads = {};
  const add = (key: string | null, w: number) => {
    if (key && w) L[key] = (L[key] ?? 0) + w;
  };
  const total = `${g}:total`;
  const margin = `${g}:margin`;
  const pass = team != null ? `${g}:pass:${team}` : null;
  const rush = team != null ? `${g}:rush:${team}` : null;
  const offense = team != null ? `${g}:offense:${team}` : null;
  const oppPass = opponent != null ? `${g}:pass:${opponent}` : null;
  const oppOffense = opponent != null ? `${g}:offense:${opponent}` : null;
  const player = leg.playerKey ? `player:${leg.playerKey}` : null;

  switch (leg.betType) {
    // ---- football game lines ----
    case 'NFL_GAME_TOTAL': add(total, 0.85); break;
    case 'NFL_1Q_TOTAL':   add(total, 0.4); break;
    case 'NFL_TEAM_TOTAL': add(total, 0.5); add(pass, 0.35); add(rush, 0.3); add(margin, 0.3 * side); break;
    case 'NFL_SPREAD':
    case 'NFL_MONEYLINE':  add(margin, 0.85 * side); break;
    // One quarter is a small, noisy slice of the same margin.
    case 'NFL_1Q_WINNER':
    case 'NFL_1Q_SPREAD':  add(margin, 0.45 * side); break;
    // An interception is the passing game going wrong, so it doesn't ride volume.
    case 'NFL_INTERCEPTIONS_THROWN': add(player, 0.35); add(pass, 0.2); add(margin, -0.35 * side); break;
    case 'NFL_PASS_TDS': add(pass, 0.45); add(player, 0.35); add(total, 0.35); add(margin, 0.2 * side); break;

    default:
      switch (def?.category) {
        // A quarterback throws more when he's chasing and less when he's cruising.
        case 'passing':   add(pass, 0.7); add(player, 0.35); add(total, 0.15); add(margin, -0.15 * side); break;
        case 'rushing':   add(rush, 0.6); add(player, 0.45); add(total, 0.1); add(margin, 0.25 * side); break;
        case 'receiving': add(pass, 0.5); add(player, 0.55); add(total, 0.15); break;
        case 'kicking':   add(total, 0.25); add(player, 0.3); add(margin, 0.15 * side); break;
        case 'defense':   add(player, 0.4); add(oppPass, 0.15); add(margin, -0.15 * side); break;
        case 'fantasy':   add(pass, 0.3); add(rush, 0.2); add(player, 0.5); add(total, 0.2); break;
        // Baseball: a hitter needs his own lineup working.
        case 'batting':   add(offense, 0.35); add(player, 0.45); add(total, 0.2); break;
        // A pitcher's day is the other lineup's day, backwards.
        case 'pitching':  add(player, 0.5); add(oppOffense, -0.4); add(total, -0.25); break;
      }
  }

  // An under is the same story told backwards.
  if (leg.direction === 'UNDER') for (const k of Object.keys(L)) L[k] = -L[k];

  const shared = Object.values(L).reduce((a, w) => a + w * w, 0);
  if (shared > MAX_SHARED) {
    const scale = Math.sqrt(MAX_SHARED / shared);
    for (const k of Object.keys(L)) L[k] *= scale;
  }
  return L;
}

/** Deterministic PRNG, so the same slip prices the same twice running. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(parts: string[]): number {
  let h = 2166136261;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/** One standard normal, Box-Muller. */
function normal(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * The chance every leg lands. Legs with nothing in common multiply exactly;
 * legs sharing a game are simulated together.
 */
export function correlatedParlayProbability(legs: CorrelatedLeg[]): number {
  if (legs.length === 0) return 0;
  const p = legs.map((l) => Math.min(1, Math.max(0, l.probability)));
  const product = p.reduce((a, x) => a * x, 1);
  if (legs.length === 1 || product === 0) return product;

  const loads = legs.map(loadingsFor);
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const L of loads) {
    for (const key of Object.keys(L)) {
      if (seen.has(key)) shared.add(key);
      seen.add(key);
    }
  }
  // Nothing in common: independence is the right answer, exactly.
  if (shared.size === 0) return product;

  const keys = [...shared];
  const slot = new Map(keys.map((k, i) => [k, i]));
  // A factor only one leg leans on is indistinguishable from that leg's own
  // noise, so it stays folded into the remainder below.
  const terms = loads.map((L) => Object.entries(L)
    .filter(([k]) => shared.has(k))
    .map(([k, w]) => [slot.get(k) as number, w] as const));
  const own = terms.map((ts) => Math.sqrt(Math.max(0, 1 - ts.reduce((a, [, w]) => a + w * w, 0))));
  // Clearing this is as likely as the leg's own win probability.
  const bar = p.map((x) => (x >= 1 ? -Infinity : normInv(1 - x)));

  const rnd = mulberry32(seedFrom(legs.map((l) => l.id)));
  const f = new Array<number>(keys.length);
  let hits = 0;
  for (let d = 0; d < DRAWS; d++) {
    for (let k = 0; k < keys.length; k++) f[k] = normal(rnd);
    let all = true;
    for (let i = 0; i < legs.length; i++) {
      // Every leg draws whether or not the slip is already dead, so the
      // random stream -- and the answer -- stays the same run to run.
      let z = own[i] * normal(rnd);
      for (const [k, w] of terms[i]) z += w * f[k];
      if (z <= bar[i]) all = false;
    }
    if (all) hits++;
  }
  return hits / DRAWS;
}
