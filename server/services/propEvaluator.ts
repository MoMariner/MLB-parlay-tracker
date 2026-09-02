/**
 * Prop engine (spec §23).
 *
 * One calculator per prop, plus evaluateBet() which turns a bet + a live stat
 * line into { currentValue, status, progress }.
 */

import type { BattingStats, PitchingStats, PlayerGameState, GameSnapshot } from './statExtractor.js';
import { scoreBatting, scorePitching } from './fantasyScoring.js';
import { PROP_BY_KEY } from '../../shared/props.js';
import type { BetStatus, Direction } from '../../shared/props.js';

// ---- Batting calculators -------------------------------------------------

export function calculateHits(b: BattingStats): number { return b.hits; }
export function calculateHomeRuns(b: BattingStats): number { return b.homeRuns; }
export function calculateRBIs(b: BattingStats): number { return b.rbi; }
export function calculateRuns(b: BattingStats): number { return b.runs; }
export function calculateWalks(b: BattingStats): number { return b.walks; }
export function calculateAtBats(b: BattingStats): number { return b.atBats; }
export function calculateStolenBases(b: BattingStats): number { return b.stolenBases; }

/** Spec §5 -- 1B=1, 2B=2, 3B=3, HR=4. */
export function calculateTotalBases(b: BattingStats): number {
  return b.singles + b.doubles * 2 + b.triples * 3 + b.homeRuns * 4;
}

/** Spec §6. */
export function calculateHitsRunsRBIs(b: BattingStats): number {
  return b.hits + b.runs + b.rbi;
}

/** Batter strikeouts (distinct from a pitcher's). */
export function calculateStrikeouts(b: BattingStats): number { return b.strikeOuts; }

/** Spec §7 -- delegates to the configurable scoring engine. */
export function calculateFantasyPoints(b: BattingStats, source: string): number {
  return scoreBatting(b, source);
}

// ---- Pitching calculators ------------------------------------------------

export function calculatePitcherStrikeouts(p: PitchingStats): number { return p.strikeOuts; }
export function calculatePitchCount(p: PitchingStats): number { return p.pitches; }
export function calculateHitsAllowed(p: PitchingStats): number { return p.hitsAllowed; }
export function calculateRunsAllowed(p: PitchingStats): number { return p.runsAllowed; }
export function calculateEarnedRuns(p: PitchingStats): number { return p.earnedRuns; }
export function calculatePitcherWalks(p: PitchingStats): number { return p.walks; }
export function calculateOutsRecorded(p: PitchingStats): number { return p.outs; }
export function calculateInningsPitched(p: PitchingStats): number { return p.inningsPitched; }
export function calculatePitcherFantasyPoints(p: PitchingStats, source: string): number {
  return scorePitching(p, source);
}

// ---- Dispatch ------------------------------------------------------------

type Calculator = (state: PlayerGameState, source: string) => number;

const CALCULATORS: Record<string, Calculator> = {
  HITS:            (s) => calculateHits(s.batting),
  HOME_RUNS:       (s) => calculateHomeRuns(s.batting),
  RBIS:            (s) => calculateRBIs(s.batting),
  RUNS:            (s) => calculateRuns(s.batting),
  TOTAL_BASES:     (s) => calculateTotalBases(s.batting),
  STOLEN_BASES:    (s) => calculateStolenBases(s.batting),
  WALKS:           (s) => calculateWalks(s.batting),
  STRIKEOUTS:      (s) => calculateStrikeouts(s.batting),
  AT_BATS:         (s) => calculateAtBats(s.batting),
  HITS_RUNS_RBIS:  (s) => calculateHitsRunsRBIs(s.batting),
  FANTASY_POINTS:  (s, src) => calculateFantasyPoints(s.batting, src),

  PITCHER_STRIKEOUTS:     (s) => calculatePitcherStrikeouts(s.pitching),
  PITCHER_PITCHES:        (s) => calculatePitchCount(s.pitching),
  PITCHER_HITS_ALLOWED:   (s) => calculateHitsAllowed(s.pitching),
  PITCHER_RUNS_ALLOWED:   (s) => calculateRunsAllowed(s.pitching),
  PITCHER_EARNED_RUNS:    (s) => calculateEarnedRuns(s.pitching),
  PITCHER_WALKS:          (s) => calculatePitcherWalks(s.pitching),
  PITCHER_OUTS:           (s) => calculateOutsRecorded(s.pitching),
  PITCHER_INNINGS:        (s) => calculateInningsPitched(s.pitching),
  PITCHER_FANTASY_POINTS: (s, src) => calculatePitcherFantasyPoints(s.pitching, src),
};

export function calculateProp(betType: string, state: PlayerGameState, source: string): number {
  const calc = CALCULATORS[betType];
  if (!calc) throw new Error(`Unknown prop type: ${betType}`);
  return calc(state, source);
}

export interface EvaluatableBet {
  betType: string;
  source: string;
  direction: Direction | string;
  line: number;
}

export interface Evaluation {
  currentValue: number;
  status: BetStatus;
  progress: number;
  /** Value that would win an OVER, or the ceiling an UNDER must stay below. */
  target: number;
  /** True once the result can no longer change (stats are monotonic). */
  clinched: boolean;
}

/**
 * Smallest value that wins an OVER. Half-point lines need the next whole
 * number; whole-number lines need one more than the line (equal = push).
 */
function overTarget(line: number, decimal: boolean): number {
  if (decimal) return line;
  return Number.isInteger(line) ? line + 1 : Math.ceil(line);
}

export function evaluateBet(
  bet: EvaluatableBet,
  state: PlayerGameState,
  snapshot: GameSnapshot,
): Evaluation {
  const currentValue = calculateProp(bet.betType, state, bet.source);
  const def = PROP_BY_KEY[bet.betType];
  const decimal = def?.decimal ?? false;
  const isOver = bet.direction === 'OVER';
  const target = isOver ? overTarget(bet.line, decimal) : bet.line;

  const progress = target > 0 ? Math.min(1, Math.max(0, currentValue / target)) : 0;

  // Game hasn't started: nothing can have happened yet.
  if (snapshot.status === 'Preview') {
    return { currentValue, status: 'PENDING', progress: 0, target, clinched: false };
  }

  // Counting stats only go up, so an OVER that has cleared its line is won for
  // good, and an UNDER that has been passed is lost for good -- even mid-game.
  if (currentValue > bet.line) {
    return {
      currentValue,
      status: isOver ? 'WON' : 'LOST',
      progress: 1,
      target,
      clinched: true,
    };
  }

  if (snapshot.status === 'Final') {
    if (currentValue === bet.line) {
      return { currentValue, status: 'PUSH', progress, target, clinched: true };
    }
    // currentValue < line at final
    return {
      currentValue,
      status: isOver ? 'LOST' : 'WON',
      progress,
      target,
      clinched: true,
    };
  }

  return { currentValue, status: 'LIVE', progress, target, clinched: false };
}
