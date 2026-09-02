/**
 * Live win probability for a prop bet.
 *
 * The estimate answers: given what the player has already done and how much
 * baseball is left, how often does this bet finish on the right side?
 *
 * Three inputs:
 *   1. what they need   -- line minus current value
 *   2. how many more chances they get -- projected from the game state and
 *      their spot in the order
 *   3. how good they are at it -- season per-plate-appearance rates
 *
 * Then Monte Carlo: simulate the remaining chances a few thousand times and
 * count the share that land on the winning side. Simulation (rather than a
 * closed form) keeps one code path for binary props like home runs and
 * compound ones like total bases or fantasy points.
 *
 * This is an ESTIMATE from season rates, not a sportsbook price. It ignores
 * the opposing pitcher, park, platoon splits and weather, and it assumes legs
 * are independent -- two hitters in the SAME game are positively correlated,
 * so a same-game parlay's true odds are a little better than the product.
 */

import type { PlayerGameState, GameSnapshot, BattingStats, PitchingStats } from './statExtractor.js';
import { PROP_BY_KEY } from '../../shared/props.js';
import type { Direction } from '../../shared/props.js';
import { scoreBatting, scorePitching } from './fantasyScoring.js';
import { getSeasonRates, type BattingRates, type PitchingRates } from './seasonStats.js';

const SIMS = 4000;

export interface WinProbability {
  /** 0..1 chance the bet finishes a winner. */
  probability: number;
  /** Projected plate appearances (hitter) or batters faced (pitcher) left. */
  chancesLeft: number;
  /** True when the outcome is already decided and no simulation was needed. */
  decided: boolean;
}

/**
 * Plate appearances a hitter has left.
 *
 * A team bats roughly 4.5 times per inning. From the current inning and the
 * player's distance from the batter at the plate, work out how many more trips
 * their slot gets before the game ends.
 */
export function projectedPlateAppearances(
  snapshot: GameSnapshot,
  battersAway: number | null,
  isPlayersTeamBatting: boolean,
): number {
  if (snapshot.status === 'Final') return 0;
  if (snapshot.status === 'Preview') return 4.3; // full game ahead

  const inning = snapshot.inning ?? 1;
  const outs = snapshot.outs ?? 0;

  // Half-innings this team has left, counting the current one if they're up.
  const inningsLeft = Math.max(0, 9 - inning) + (isPlayersTeamBatting ? 1 : 0.5);
  const outsLeftThisInning = isPlayersTeamBatting ? Math.max(0, 3 - outs) : 3;

  // ~4.5 batters per inning, so ~1.5 batters per out.
  const battersLeft = Math.max(0, (inningsLeft - 1) * 4.5 + outsLeftThisInning * 1.5);

  // Their slot comes up every 9 batters; `battersAway` is the wait for the first.
  const wait = battersAway ?? 4.5;
  if (battersLeft <= wait) {
    // Might not bat again at all -- partial credit for how close they are.
    return Math.max(0, battersLeft / Math.max(wait, 1)) * 0.9;
  }
  return 1 + (battersLeft - wait) / 9;
}

/** Batters a pitcher still faces, from how deep into the game he is. */
export function projectedBattersFaced(snapshot: GameSnapshot, p: PitchingStats): number {
  if (snapshot.status === 'Final') return 0;
  if (snapshot.status === 'Preview') return 24; // ~6 innings for a starter

  // Starters are usually pulled around 100 pitches or the 6th/7th.
  const pitchBudget = Math.max(0, 100 - p.pitches);
  const byPitches = pitchBudget / 3.9; // ~3.9 pitches per batter
  const outsLeft = Math.max(0, 21 - p.outs); // through 7 innings
  const byOuts = outsLeft * 1.28; // ~1.28 batters per out recorded
  return Math.max(0, Math.min(byPitches, byOuts));
}

/** One simulated plate appearance -> the increments it produces. */
function simulatePA(r: BattingRates): BattingStats {
  const u = Math.random();
  let acc = 0;
  const out = blankBatting();

  // Walk / HBP first: they consume a PA but not an at-bat.
  if (u < (acc += r.walk)) { out.walks = 1; out.plateAppearances = 1; return out; }
  if (u < (acc += r.hitByPitch)) { out.hitByPitch = 1; out.plateAppearances = 1; return out; }

  out.plateAppearances = 1;
  out.atBats = 1;

  if (u < (acc += r.homeRun)) { out.hits = 1; out.homeRuns = 1; out.totalBases = 4; out.runs = 1; out.rbi = 1; }
  else if (u < (acc += r.triple)) { out.hits = 1; out.triples = 1; out.totalBases = 3; }
  else if (u < (acc += r.double)) { out.hits = 1; out.doubles = 1; out.totalBases = 2; }
  else if (u < (acc += r.single)) { out.hits = 1; out.singles = 1; out.totalBases = 1; }
  else if (u < (acc += r.strikeout)) { out.strikeOuts = 1; }
  // else: a ball in play that becomes an out -- nothing to record.

  // Runs and RBIs that aren't tied to a home run, approximated per PA.
  if (out.homeRuns === 0) {
    if (Math.random() < r.runNonHr) out.runs += 1;
    if (Math.random() < r.rbiNonHr) out.rbi += 1;
  }
  if (Math.random() < r.stolenBase) out.stolenBases = 1;

  out.hitsRunsRbis = out.hits + out.runs + out.rbi;
  return out;
}

function blankBatting(): BattingStats {
  return {
    atBats: 0, hits: 0, singles: 0, doubles: 0, triples: 0, homeRuns: 0,
    runs: 0, rbi: 0, walks: 0, hitByPitch: 0, strikeOuts: 0,
    stolenBases: 0, caughtStealing: 0, totalBases: 0, plateAppearances: 0, hitsRunsRbis: 0,
  };
}

function addBatting(a: BattingStats, b: BattingStats): BattingStats {
  return {
    atBats: a.atBats + b.atBats, hits: a.hits + b.hits, singles: a.singles + b.singles,
    doubles: a.doubles + b.doubles, triples: a.triples + b.triples, homeRuns: a.homeRuns + b.homeRuns,
    runs: a.runs + b.runs, rbi: a.rbi + b.rbi, walks: a.walks + b.walks,
    hitByPitch: a.hitByPitch + b.hitByPitch, strikeOuts: a.strikeOuts + b.strikeOuts,
    stolenBases: a.stolenBases + b.stolenBases, caughtStealing: a.caughtStealing + b.caughtStealing,
    totalBases: a.totalBases + b.totalBases, plateAppearances: a.plateAppearances + b.plateAppearances,
    hitsRunsRbis: a.hitsRunsRbis + b.hitsRunsRbis,
  };
}

/** Value a batting prop would take for a given stat line. */
function battingValue(betType: string, s: BattingStats, source: string): number {
  switch (betType) {
    case 'HITS': return s.hits;
    case 'HOME_RUNS': return s.homeRuns;
    case 'RBIS': return s.rbi;
    case 'RUNS': return s.runs;
    case 'TOTAL_BASES': return s.totalBases;
    case 'STOLEN_BASES': return s.stolenBases;
    case 'WALKS': return s.walks;
    case 'STRIKEOUTS': return s.strikeOuts;
    case 'AT_BATS': return s.atBats;
    case 'HITS_RUNS_RBIS': return s.hits + s.runs + s.rbi;
    case 'FANTASY_POINTS': return scoreBatting(s, source);
    default: return 0;
  }
}

function pitchingValue(betType: string, s: PitchingStats, source: string): number {
  switch (betType) {
    case 'PITCHER_STRIKEOUTS': return s.strikeOuts;
    case 'PITCHER_PITCHES': return s.pitches;
    case 'PITCHER_HITS_ALLOWED': return s.hitsAllowed;
    case 'PITCHER_RUNS_ALLOWED': return s.runsAllowed;
    case 'PITCHER_EARNED_RUNS': return s.earnedRuns;
    case 'PITCHER_WALKS': return s.walks;
    case 'PITCHER_OUTS': return s.outs;
    case 'PITCHER_INNINGS': return s.inningsPitched;
    case 'PITCHER_FANTASY_POINTS': return scorePitching(s, source);
    default: return 0;
  }
}

/** One simulated batter faced, added onto a pitcher's line. */
function simulateBatterFaced(r: PitchingRates, acc: PitchingStats): void {
  const u = Math.random();
  acc.battersFaced += 1;
  acc.pitches += r.pitchesPerBatter;

  if (u < r.strikeout) { acc.strikeOuts += 1; acc.outs += 1; return; }
  if (u < r.strikeout + r.walk) { acc.walks += 1; return; }
  if (u < r.strikeout + r.walk + r.hit) {
    acc.hitsAllowed += 1;
    if (Math.random() < r.earnedRunPerHit) { acc.runsAllowed += 1; acc.earnedRuns += 1; }
    return;
  }
  acc.outs += 1;
}

function blankPitching(): PitchingStats {
  return {
    outs: 0, inningsPitched: 0, pitches: 0, strikeOuts: 0, hitsAllowed: 0,
    runsAllowed: 0, earnedRuns: 0, walks: 0, hitBatsmen: 0, battersFaced: 0, homeRunsAllowed: 0,
  };
}

export interface ProbabilityInput {
  betType: string;
  source: string;
  direction: Direction | string;
  line: number;
  currentValue: number;
  status: string;
}

/**
 * Estimate the chance a bet finishes a winner.
 * Settled bets short-circuit to 1 or 0 -- no simulation needed.
 */
export async function estimateWinProbability(
  bet: ProbabilityInput,
  state: PlayerGameState,
  snapshot: GameSnapshot,
  playerId: number,
): Promise<WinProbability> {
  if (bet.status === 'WON') return { probability: 1, chancesLeft: 0, decided: true };
  if (bet.status === 'LOST') return { probability: 0, chancesLeft: 0, decided: true };
  if (bet.status === 'PUSH' || bet.status === 'VOID') return { probability: 0, chancesLeft: 0, decided: true };

  const def = PROP_BY_KEY[bet.betType];
  const isOver = bet.direction === 'OVER';
  const isPitching = def?.category === 'pitching';
  const rates = await getSeasonRates(playerId, isPitching ? 'pitching' : 'hitting');

  // No rates (rookie call-up, demo player) -- fall back to the progress bar so
  // the UI still shows something honest rather than a confident fabrication.
  if (!rates) {
    const naive = Math.max(0, Math.min(1, bet.currentValue / Math.max(bet.line, 0.5)));
    return { probability: isOver ? naive * 0.5 : 1 - naive * 0.5, chancesLeft: 0, decided: false };
  }

  if (isPitching) {
    const bf = projectedBattersFaced(snapshot, state.pitching);
    if (bf < 0.5) return settleNow(bet, isOver);
    let wins = 0;
    for (let i = 0; i < SIMS; i++) {
      const acc = blankPitching();
      const n = poisson(bf);
      for (let b = 0; b < n; b++) simulateBatterFaced(rates as PitchingRates, acc);
      const total = combinePitching(state.pitching, acc);
      const value = pitchingValue(bet.betType, total, bet.source);
      if (isOver ? value > bet.line : value < bet.line) wins++;
    }
    return { probability: wins / SIMS, chancesLeft: round1(bf), decided: false };
  }

  const battersAway =
    state.battingStatus.status === 'AT_BAT' ? 0
    : state.battingStatus.status === 'ON_DECK' ? 1
    : state.battingStatus.status === 'COMING_UP' ? 2
    : state.battingStatus.battersAway ?? null;

  const teamBatting = ['AT_BAT', 'ON_DECK', 'COMING_UP', 'BATTERS_AWAY'].includes(state.battingStatus.status);
  const removed = ['PLAYER_REMOVED', 'NOT_IN_LINEUP'].includes(state.battingStatus.status);

  const pa = removed ? 0 : projectedPlateAppearances(snapshot, battersAway, teamBatting);
  if (pa < 0.05) return settleNow(bet, isOver);

  let wins = 0;
  for (let i = 0; i < SIMS; i++) {
    let acc = blankBatting();
    const n = poisson(pa);
    for (let k = 0; k < n; k++) acc = addBatting(acc, simulatePA(rates as BattingRates));
    // Add the simulated rest onto what actually happened so far.
    const total = addBatting(state.batting, acc);
    const value = battingValue(bet.betType, total, bet.source);
    if (isOver ? value > bet.line : value < bet.line) wins++;
  }

  return { probability: wins / SIMS, chancesLeft: round1(pa), decided: false };
}

/** No chances left: the current value is the final value. */
function settleNow(bet: ProbabilityInput, isOver: boolean): WinProbability {
  const wins = isOver ? bet.currentValue > bet.line : bet.currentValue < bet.line;
  return { probability: wins ? 1 : 0, chancesLeft: 0, decided: true };
}

function combinePitching(a: PitchingStats, b: PitchingStats): PitchingStats {
  const outs = a.outs + b.outs;
  return {
    outs, inningsPitched: Math.round((outs / 3) * 100) / 100,
    pitches: a.pitches + b.pitches, strikeOuts: a.strikeOuts + b.strikeOuts,
    hitsAllowed: a.hitsAllowed + b.hitsAllowed, runsAllowed: a.runsAllowed + b.runsAllowed,
    earnedRuns: a.earnedRuns + b.earnedRuns, walks: a.walks + b.walks,
    hitBatsmen: a.hitBatsmen + b.hitBatsmen, battersFaced: a.battersFaced + b.battersFaced,
    homeRunsAllowed: a.homeRunsAllowed + b.homeRunsAllowed,
  };
}

/**
 * Chances left is a projection, not a certainty, so draw the actual count from
 * a Poisson around it. That widens the distribution the way real uncertainty
 * about a hitter's last trip to the plate does.
 */
function poisson(mean: number): number {
  if (mean <= 0) return 0;
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A slip wins only if every leg wins, so multiply. Legs in the same game are
 * positively correlated and this understates those slightly -- flagged in the
 * UI rather than silently fudged.
 */
export function parlayProbability(legProbabilities: number[]): number {
  if (legProbabilities.length === 0) return 0;
  return legProbabilities.reduce((acc, p) => acc * p, 1);
}
