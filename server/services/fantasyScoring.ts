/**
 * Configurable fantasy scoring engine (spec §7).
 *
 * Scoring lives in DATA, not in the UI and not scattered through the
 * evaluator. Every format is a plain object of stat -> points, editable at
 * runtime from the Settings screen and persisted in the Setting table.
 * Changing a format re-scores every open bet on the next poll.
 */

import type { BattingStats, PitchingStats } from './statExtractor.js';

export interface BattingScoring {
  single: number;
  double: number;
  triple: number;
  homeRun: number;
  run: number;
  rbi: number;
  walk: number;
  hitByPitch: number;
  stolenBase: number;
  caughtStealing: number;
  strikeout: number;
}

export interface PitchingScoring {
  inningPitched: number;
  strikeout: number;
  earnedRun: number;
  hitAllowed: number;
  walkAllowed: number;
  hitBatsman: number;
}

export interface ScoringFormat {
  label: string;
  batting: BattingScoring;
  pitching: PitchingScoring;
}

/**
 * Shipped defaults. `default` mirrors the plain config in the spec; the
 * sportsbook formats are seeded with their common published values and are
 * meant to be edited in Settings if a book changes its rules.
 */
export const DEFAULT_SCORING: Record<string, ScoringFormat> = {
  default: {
    label: 'Simple (1 pt / base)',
    batting: {
      single: 1, double: 2, triple: 3, homeRun: 4,
      run: 1, rbi: 1, walk: 1, hitByPitch: 1,
      stolenBase: 2, caughtStealing: 0, strikeout: 0,
    },
    pitching: {
      inningPitched: 3, strikeout: 1, earnedRun: -1,
      hitAllowed: 0, walkAllowed: 0, hitBatsman: 0,
    },
  },
  underdog: {
    label: 'Underdog Fantasy',
    batting: {
      single: 3, double: 6, triple: 8, homeRun: 10,
      run: 3, rbi: 3, walk: 3, hitByPitch: 3,
      stolenBase: 4, caughtStealing: 0, strikeout: 0,
    },
    pitching: {
      inningPitched: 3, strikeout: 3, earnedRun: -3,
      hitAllowed: 0, walkAllowed: 0, hitBatsman: 0,
    },
  },
  draftkings: {
    label: 'DraftKings',
    batting: {
      single: 3, double: 5, triple: 8, homeRun: 10,
      run: 2, rbi: 2, walk: 2, hitByPitch: 2,
      stolenBase: 5, caughtStealing: -2, strikeout: 0,
    },
    pitching: {
      inningPitched: 2.25, strikeout: 2, earnedRun: -2,
      hitAllowed: -0.6, walkAllowed: -0.6, hitBatsman: -0.6,
    },
  },
  fanduel: {
    label: 'FanDuel',
    batting: {
      single: 3, double: 6, triple: 9, homeRun: 12,
      run: 3.2, rbi: 3.5, walk: 3, hitByPitch: 3,
      stolenBase: 6, caughtStealing: 0, strikeout: 0,
    },
    pitching: {
      inningPitched: 3, strikeout: 3, earnedRun: -3,
      hitAllowed: 0, walkAllowed: 0, hitBatsman: 0,
    },
  },
};

/** Runtime copy; swapped wholesale by loadScoring() at boot and on edit. */
let activeScoring: Record<string, ScoringFormat> = structuredClone(DEFAULT_SCORING);

export function getScoringConfigs(): Record<string, ScoringFormat> {
  return activeScoring;
}

export function setScoringConfigs(next: Record<string, ScoringFormat>): void {
  activeScoring = next;
}

/**
 * A bet's `source` selects the scoring format ("underdog" -> Underdog rules).
 * Sources without their own format fall back to `default`.
 */
export function formatForSource(source: string): ScoringFormat {
  return activeScoring[source] ?? activeScoring.default ?? DEFAULT_SCORING.default;
}

export function scoreBatting(stats: BattingStats, source: string): number {
  const c = formatForSource(source).batting;
  const pts =
    stats.singles * c.single +
    stats.doubles * c.double +
    stats.triples * c.triple +
    stats.homeRuns * c.homeRun +
    stats.runs * c.run +
    stats.rbi * c.rbi +
    stats.walks * c.walk +
    stats.hitByPitch * c.hitByPitch +
    stats.stolenBases * c.stolenBase +
    stats.caughtStealing * c.caughtStealing +
    stats.strikeOuts * c.strikeout;
  return round2(pts);
}

export function scorePitching(stats: PitchingStats, source: string): number {
  const c = formatForSource(source).pitching;
  const pts =
    // outs/3 rather than the "3.2" IP string, so partial innings score fairly
    (stats.outs / 3) * c.inningPitched +
    stats.strikeOuts * c.strikeout +
    stats.earnedRuns * c.earnedRun +
    stats.hitsAllowed * c.hitAllowed +
    stats.walks * c.walkAllowed +
    stats.hitBatsmen * c.hitBatsman;
  return round2(pts);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
