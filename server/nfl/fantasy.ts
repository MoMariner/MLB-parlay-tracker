/**
 * NFL fantasy scoring. Like the MLB engine, formats are data -- editable in
 * Settings -- and a bet's source picks which one scores it.
 *
 * Two-point conversions aren't broken out per player in ESPN's box score, so
 * they aren't scored; every other component of the published formats is.
 */

import type { NflLine } from './stats.js';

export interface NflScoring {
  label: string;
  passYard: number;
  passTouchdown: number;
  interception: number;
  rushYard: number;
  rushTouchdown: number;
  reception: number;
  recYard: number;
  recTouchdown: number;
  fumbleLost: number;
  returnTouchdown: number;
  bonus300PassYards: number;
  bonus100RushYards: number;
  bonus100RecYards: number;
}

const HALF_PPR: Omit<NflScoring, 'label'> = {
  passYard: 0.04, passTouchdown: 4, interception: -1,
  rushYard: 0.1, rushTouchdown: 6,
  reception: 0.5, recYard: 0.1, recTouchdown: 6,
  fumbleLost: -2, returnTouchdown: 6,
  bonus300PassYards: 0, bonus100RushYards: 0, bonus100RecYards: 0,
};

export const DEFAULT_NFL_SCORING: Record<string, NflScoring> = {
  default:    { label: 'Half PPR', ...HALF_PPR },
  underdog:   { label: 'Underdog Fantasy', ...HALF_PPR },
  draftkings: {
    label: 'DraftKings',
    ...HALF_PPR,
    reception: 1, fumbleLost: -1,
    bonus300PassYards: 3, bonus100RushYards: 3, bonus100RecYards: 3,
  },
  fanduel:    { label: 'FanDuel', ...HALF_PPR },
};

let active: Record<string, NflScoring> = structuredClone(DEFAULT_NFL_SCORING);

export function getNflScoringConfigs(): Record<string, NflScoring> {
  return active;
}

export function setNflScoringConfigs(next: Record<string, NflScoring>): void {
  active = next;
}

export function nflFormatForSource(source: string): NflScoring {
  return active[source] ?? active.default ?? DEFAULT_NFL_SCORING.default;
}

export function scoreNflFantasy(l: NflLine, source: string): number {
  const c = nflFormatForSource(source);
  const pts =
    l.passing.yards * c.passYard +
    l.passing.touchdowns * c.passTouchdown +
    l.passing.interceptions * c.interception +
    l.rushing.yards * c.rushYard +
    l.rushing.touchdowns * c.rushTouchdown +
    l.receiving.receptions * c.reception +
    l.receiving.yards * c.recYard +
    l.receiving.touchdowns * c.recTouchdown +
    l.fumbles.lost * c.fumbleLost +
    (l.returns.kickTouchdowns + l.returns.puntTouchdowns) * c.returnTouchdown +
    (l.passing.yards >= 300 ? c.bonus300PassYards : 0) +
    (l.rushing.yards >= 100 ? c.bonus100RushYards : 0) +
    (l.receiving.yards >= 100 ? c.bonus100RecYards : 0);
  return Math.round(pts * 100) / 100;
}
