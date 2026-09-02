/**
 * Prop configuration system (spec §4, §13, §14).
 *
 * A prop is defined by WHAT STAT it measures. Where the bet was placed
 * ("Underdog", "DraftKings", ...) is a separate `source` field, NOT a
 * different prop -- see BET_SOURCES below. That keeps "Underdog Hits" and
 * "Hits" pointing at one calculator instead of duplicating the catalog.
 *
 * To add a prop later: append one entry here. The API, the evaluator, the
 * bet-type picker and the bet card all read from this list.
 */

export type PropCategory = 'batting' | 'pitching';

export interface PropDef {
  key: string;
  label: string;
  /** Compact label for bet cards, e.g. "H+R+RBI". */
  short: string;
  category: PropCategory;
  /** Typical lines offered for this prop, used for the quick-pick buttons. */
  commonLines: number[];
  /** Whether the value can be fractional (fantasy points). */
  decimal?: boolean;
  /** Longer explanation shown under the prop card. */
  help?: string;
}

export const PROPS: PropDef[] = [
  // ---- Batting ----
  { key: 'HITS',            label: 'Hits',              short: 'HITS',    category: 'batting',  commonLines: [0.5, 1.5, 2.5] },
  { key: 'HOME_RUNS',       label: 'Home Runs',         short: 'HR',      category: 'batting',  commonLines: [0.5, 1.5] },
  { key: 'RBIS',            label: 'RBIs',              short: 'RBI',     category: 'batting',  commonLines: [0.5, 1.5, 2.5] },
  { key: 'RUNS',            label: 'Runs',              short: 'R',       category: 'batting',  commonLines: [0.5, 1.5] },
  { key: 'TOTAL_BASES',     label: 'Total Bases',       short: 'TB',      category: 'batting',  commonLines: [0.5, 1.5, 2.5, 3.5],
    help: 'Single = 1, Double = 2, Triple = 3, Home Run = 4' },
  { key: 'STOLEN_BASES',    label: 'Stolen Bases',      short: 'SB',      category: 'batting',  commonLines: [0.5, 1.5] },
  { key: 'WALKS',           label: 'Walks',             short: 'BB',      category: 'batting',  commonLines: [0.5, 1.5] },
  { key: 'STRIKEOUTS',      label: 'Strikeouts',        short: 'K',       category: 'batting',  commonLines: [0.5, 1.5, 2.5] },
  { key: 'AT_BATS',         label: 'At Bats',           short: 'AB',      category: 'batting',  commonLines: [2.5, 3.5, 4.5] },
  { key: 'HITS_RUNS_RBIS',  label: 'Hits + Runs + RBIs', short: 'H+R+RBI', category: 'batting', commonLines: [1.5, 2.5, 3.5, 4.5],
    help: 'Hits + Runs + RBIs combined' },
  { key: 'FANTASY_POINTS',  label: 'Fantasy Points',    short: 'FP',      category: 'batting',  commonLines: [6.5, 8.5, 10.5, 12.5], decimal: true,
    help: 'Scored with the configurable engine in Settings' },

  // ---- Pitching ----
  { key: 'PITCHER_STRIKEOUTS',   label: 'Strikeouts',      short: 'K',    category: 'pitching', commonLines: [4.5, 5.5, 6.5, 7.5] },
  { key: 'PITCHER_PITCHES',      label: 'Pitches',         short: 'PC',   category: 'pitching', commonLines: [79.5, 84.5, 89.5, 94.5] },
  { key: 'PITCHER_HITS_ALLOWED', label: 'Hits Allowed',    short: 'HA',   category: 'pitching', commonLines: [3.5, 4.5, 5.5] },
  { key: 'PITCHER_RUNS_ALLOWED', label: 'Runs Allowed',    short: 'RA',   category: 'pitching', commonLines: [1.5, 2.5, 3.5] },
  { key: 'PITCHER_EARNED_RUNS',  label: 'Earned Runs',     short: 'ER',   category: 'pitching', commonLines: [1.5, 2.5, 3.5] },
  { key: 'PITCHER_WALKS',        label: 'Walks',           short: 'BB',   category: 'pitching', commonLines: [1.5, 2.5] },
  { key: 'PITCHER_OUTS',         label: 'Outs Recorded',   short: 'OUTS', category: 'pitching', commonLines: [14.5, 15.5, 17.5, 18.5] },
  { key: 'PITCHER_INNINGS',      label: 'Innings Pitched', short: 'IP',   category: 'pitching', commonLines: [4.5, 5.5, 6.5], decimal: true },
  { key: 'PITCHER_FANTASY_POINTS', label: 'Fantasy Points', short: 'FP',  category: 'pitching', commonLines: [12.5, 15.5, 18.5], decimal: true,
    help: 'Scored with the configurable engine in Settings' },
];

export const PROP_BY_KEY: Record<string, PropDef> = Object.fromEntries(
  PROPS.map((p) => [p.key, p]),
);

export function propsFor(category: PropCategory): PropDef[] {
  return PROPS.filter((p) => p.category === category);
}

/**
 * Where the bet was placed. Purely a label + (for fantasy props) a pointer at
 * a scoring config -- it never changes which MLB statistic is tracked (spec §4).
 */
export const BET_SOURCES = [
  { key: 'manual',     label: 'Manual' },
  { key: 'underdog',   label: 'Underdog' },
  { key: 'draftkings', label: 'DraftKings' },
  { key: 'fanduel',    label: 'FanDuel' },
  { key: 'betmgm',     label: 'BetMGM' },
] as const;

export type BetSource = (typeof BET_SOURCES)[number]['key'];

export type Direction = 'OVER' | 'UNDER';

export type BetStatus = 'PENDING' | 'LIVE' | 'WON' | 'LOST' | 'PUSH' | 'VOID';

/**
 * Which prop categories to offer for a player, from their MLB position.
 *
 * Only the props that actually apply: a pitcher gets pitching props, a
 * position player gets batting props. Offering both to everyone meant
 * scrolling past nine irrelevant cards to reach the one you wanted.
 *
 * Two-way players are the genuine exception and keep both menus.
 */
export function categoriesForPosition(
  position?: string | null,
  positionType?: string | null,
): PropCategory[] {
  const pos = (position ?? '').toUpperCase();
  const type = (positionType ?? '').toLowerCase();

  if (pos === 'TWP' || type.includes('two-way')) return ['batting', 'pitching'];
  if (pos === 'P' || pos === 'SP' || pos === 'RP' || type === 'pitcher') return ['pitching'];
  return ['batting'];
}
