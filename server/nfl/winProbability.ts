/**
 * Live win probability for NFL legs.
 *
 * Player props: the rest of the game is modelled from the player's per-game
 * history, scaled by how much clock is left. With little history the model
 * leans on the bet's own line, which a book sets near the median outcome.
 *
 * Game lines: final margin and total are close to normal around the market's
 * pregame spread and total, with a spread of ~13.5 points over a full game
 * that shrinks with the square root of the time left. Once a game is live,
 * ESPN publishes its own play-by-play win probability, which already knows
 * possession, field position and timeouts -- that anchors the moneyline, and
 * the spread is priced consistently off it.
 *
 * Estimates, not a sportsbook price. Legs are treated as independent.
 */

import type { PropDef } from '../../shared/props.js';
import type { NflSnapshot } from './stats.js';
import { getNflGameRows, statFromRow } from './rates.js';

/** Standard deviation of NFL final margin around the spread, full game. */
const MARGIN_SD = 13.45;
/** ...of the combined total around the market total. */
const TOTAL_SD = 13.5;
/** ...of one team's points around its implied total. */
const TEAM_SD = 9.7;
const LEAGUE_TOTAL = 44.5;

function clockSeconds(clock: string | null): number {
  const m = clock?.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Share of regulation still to play, 0..1. Overtime counts its own clock. */
export function remainingFraction(s: NflSnapshot): number {
  if (s.status === 'Preview') return 1;
  if (s.status !== 'Live') return 0;
  const period = s.period ?? 1;
  const secs = clockSeconds(s.clock);
  const remaining = period <= 4 ? (4 - period) * 900 + secs : secs;
  return Math.min(1, Math.max(0, remaining / 3600));
}

export function elapsedFraction(s: NflSnapshot): number {
  if (s.status === 'Preview') return 0;
  if (s.status !== 'Live') return 1;
  return 1 - remainingFraction(s);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** P(N <= k) for N ~ Poisson(lambda). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

export interface NflProbability {
  probability: number;
  /** Where the stat is heading at its current rate. */
  paceValue: number | null;
}

interface LegInput {
  betType: string;
  direction: string;
  line: number;
  teamId: number | null;
  source: string;
  status: string;
  athleteId: number | null;
}

function pace(value: number, s: NflSnapshot): number | null {
  if (s.status === 'Final') return Math.round(value);
  const e = elapsedFraction(s);
  if (s.status !== 'Live' || e < 0.1) return null;
  return Math.round(value / e);
}

export async function nflLegProbability(
  leg: LegInput,
  def: PropDef,
  value: number,
  s: NflSnapshot,
): Promise<NflProbability> {
  if (leg.status === 'WON') return { probability: 1, paceValue: pace(value, s) };
  if (leg.status === 'LOST' || leg.status === 'PUSH' || leg.status === 'VOID') {
    return { probability: 0, paceValue: pace(value, s) };
  }

  const f = remainingFraction(s);
  const isOver = leg.direction !== 'UNDER';
  const sdScale = Math.sqrt(Math.max(f, 1e-6));

  // ---- Spread and moneyline ----
  if (def.sides === 'team') {
    const pickedHome = leg.teamId === s.homeTeamId;
    const spread = def.key === 'NFL_SPREAD' ? leg.line : 0;
    if (f <= 0) return { probability: value + spread > 0 ? 1 : 0, paceValue: null };
    const sd = MARGIN_SD * sdScale;

    // Live: anchor on ESPN's win probability for the home side.
    if (s.status === 'Live' && s.homeWinProb != null) {
      const z = normInv(Math.min(0.999, Math.max(0.001, s.homeWinProb)));
      const p = pickedHome ? normCdf(z + spread / sd) : normCdf(spread / sd - z);
      return { probability: clamp01(p), paceValue: null };
    }

    // Otherwise: current margin plus the market's expected margin for the time left.
    const homeMargin = s.homeScore - s.awayScore;
    const expectedHome = s.marketSpread != null ? -s.marketSpread : 0;
    const meanHome = homeMargin + expectedHome * f;
    const p = pickedHome ? normCdf((meanHome + spread) / sd) : normCdf((spread - meanHome) / sd);
    return { probability: clamp01(p), paceValue: null };
  }

  // ---- Totals ----
  if (def.scope === 'game') {
    const total = s.marketTotal ?? (def.key === 'NFL_GAME_TOTAL' ? leg.line : LEAGUE_TOTAL);
    const expectedHome = s.marketSpread != null ? -s.marketSpread : 0;
    let mean: number;
    let sdFull: number;
    if (def.key === 'NFL_TEAM_TOTAL') {
      // Split the total by the spread: a 48 total with a 7-point favorite is 27.5 / 20.5.
      mean = leg.teamId === s.homeTeamId ? (total + expectedHome) / 2 : (total - expectedHome) / 2;
      // Without a market total, trust the posted team line over a league split.
      if (s.marketTotal == null) mean = leg.line;
      sdFull = TEAM_SD;
    } else {
      mean = total;
      sdFull = TOTAL_SD;
    }
    if (f <= 0) return { probability: isOver ? Number(value > leg.line) : Number(value < leg.line), paceValue: pace(value, s) };
    const pOver = 1 - normCdf((leg.line - value - mean * f) / (sdFull * sdScale));
    return { probability: clamp01(isOver ? pOver : 1 - pOver), paceValue: pace(value, s) };
  }

  // ---- Player props ----
  if (f <= 0) return { probability: isOver ? Number(value > leg.line) : Number(value < leg.line), paceValue: pace(value, s) };

  const rows = leg.athleteId != null ? await getNflGameRows(leg.athleteId).catch(() => []) : [];
  const samples = rows.map((r) => statFromRow(leg.betType, r.values, leg.source));
  const n = samples.length;
  const histMean = n ? samples.reduce((a, b) => a + b, 0) / n : 0;
  const histSd = n > 1 ? Math.sqrt(samples.reduce((a, b) => a + (b - histMean) ** 2, 0) / (n - 1)) : 0;

  // Blend history with the line: a posted line is roughly the book's median,
  // and it knows the matchup. History earns more weight the more of it there is.
  const w = n / (n + 4);
  const mean = n ? w * histMean + (1 - w) * leg.line : leg.line;

  let pOver: number;
  if (def.kind === 'long') {
    // Longest play: the chance that at least one remaining play beats the line.
    const pGame = n ? (samples.filter((x) => x > leg.line).length + 0.5) / (n + 1) : 0.35;
    pOver = value > leg.line ? 1 : 1 - Math.pow(1 - pGame, f);
  } else if (def.kind === 'count') {
    const need = leg.line - value;
    if (need < 0) {
      pOver = 1;
    } else {
      const k = Math.floor(need) + 1; // more events needed to clear the line
      const lambda = Math.max(mean, 0.05) * f;
      pOver = 1 - poissonCdf(k - 1, lambda);
    }
  } else {
    // Yardage and points: normal around the rest-of-game expectation, with a
    // floor on the spread so a short, steady history can't look like certainty.
    const sdFull = n >= 3 ? Math.max(histSd, 0.35 * mean + 4) : 0.45 * Math.abs(mean) + 6;
    pOver = 1 - normCdf((leg.line - value - mean * f) / (sdFull * sdScale));
  }

  return { probability: clamp01(isOver ? pOver : 1 - pOver), paceValue: pace(value, s) };
}
