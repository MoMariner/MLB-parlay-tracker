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

export type Sport = 'mlb' | 'nfl';

export type PropCategory =
  | 'batting' | 'pitching'
  | 'passing' | 'rushing' | 'receiving' | 'scoring' | 'kicking' | 'defense' | 'fantasy' | 'game';

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
  /** Defaults to 'mlb'. */
  sport?: Sport;
  /** 'player' props track one athlete; 'game' lines track the scoreboard. */
  scope?: 'player' | 'game';
  /**
   * How a side is chosen: over/under a number, a team (spread, moneyline),
   * or a team AND over/under (team total).
   */
  sides?: 'overUnder' | 'team' | 'teamOverUnder';
  /** Team-sided markets whose line handicaps the margin, i.e. spreads. */
  handicap?: boolean;
  /** Only this period's scoring counts, e.g. 1 for first-quarter markets. */
  period?: number;
  /** Shapes the win-probability model: counts, yardage, longest play, points. */
  kind?: 'count' | 'yards' | 'long' | 'points';
  /**
   * True when the stat can only ever go up, so clearing an OVER is final.
   * Yardage is NOT monotonic in football -- a run for a loss takes yards away.
   */
  monotonic?: boolean;
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


/**
 * NFL catalog. Keys are prefixed so they can never collide with MLB's.
 * Yardage and fantasy props are non-monotonic: a sack, a loss on a carry or a
 * lost fumble can pull the number back under the line.
 */
export const NFL_PROPS: PropDef[] = [
  // ---- Passing ----
  { key: 'NFL_PASS_YARDS',           label: 'Passing Yards',           short: 'PASS YDS',      category: 'passing',   sport: 'nfl', kind: 'yards', monotonic: false, commonLines: [199.5, 224.5, 249.5, 274.5] },
  { key: 'NFL_PASS_TDS',             label: 'Passing Touchdowns',      short: 'PASS TD',       category: 'passing',   sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [0.5, 1.5, 2.5] },
  { key: 'NFL_PASS_COMPLETIONS',     label: 'Pass Completions',        short: 'CMP',           category: 'passing',   sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [17.5, 20.5, 23.5] },
  { key: 'NFL_PASS_ATTEMPTS',        label: 'Pass Attempts',           short: 'ATT',           category: 'passing',   sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [29.5, 33.5, 36.5] },
  { key: 'NFL_INTERCEPTIONS_THROWN', label: 'Interceptions Thrown',    short: 'INT',           category: 'passing',   sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [0.5, 1.5] },
  { key: 'NFL_PASS_RUSH_YARDS',      label: 'Passing + Rushing Yards', short: 'PASS+RUSH YDS', category: 'passing',   sport: 'nfl', kind: 'yards', monotonic: false, commonLines: [224.5, 249.5, 274.5] },

  // ---- Rushing ----
  { key: 'NFL_RUSH_YARDS',     label: 'Rushing Yards',             short: 'RUSH YDS',     category: 'rushing', sport: 'nfl', kind: 'yards', monotonic: false, commonLines: [29.5, 49.5, 69.5, 89.5] },
  { key: 'NFL_RUSH_ATTEMPTS',  label: 'Rush Attempts',             short: 'CAR',          category: 'rushing', sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [9.5, 14.5, 17.5] },
  { key: 'NFL_RUSH_TDS',       label: 'Rushing Touchdowns',        short: 'RUSH TD',      category: 'rushing', sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [0.5, 1.5] },
  { key: 'NFL_LONGEST_RUSH',   label: 'Longest Rush',              short: 'LONG',         category: 'rushing', sport: 'nfl', kind: 'long',  monotonic: true,  commonLines: [9.5, 14.5, 19.5] },
  { key: 'NFL_RUSH_REC_YARDS', label: 'Rushing + Receiving Yards', short: 'RUSH+REC YDS', category: 'rushing', sport: 'nfl', kind: 'yards', monotonic: false, commonLines: [49.5, 74.5, 99.5] },

  // ---- Receiving ----
  { key: 'NFL_REC_YARDS',   label: 'Receiving Yards',      short: 'REC YDS', category: 'receiving', sport: 'nfl', kind: 'yards', monotonic: false, commonLines: [39.5, 54.5, 69.5, 84.5] },
  { key: 'NFL_RECEPTIONS',  label: 'Receptions',           short: 'REC',     category: 'receiving', sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [3.5, 4.5, 5.5, 6.5] },
  { key: 'NFL_REC_TDS',     label: 'Receiving Touchdowns', short: 'REC TD',  category: 'receiving', sport: 'nfl', kind: 'count', monotonic: true,  commonLines: [0.5, 1.5] },
  { key: 'NFL_LONGEST_REC', label: 'Longest Reception',    short: 'LONG',    category: 'receiving', sport: 'nfl', kind: 'long',  monotonic: true,  commonLines: [14.5, 19.5, 24.5] },

  // ---- Scoring ----
  { key: 'NFL_ANYTIME_TD', label: 'Anytime Touchdown', short: 'TD', category: 'scoring', sport: 'nfl', kind: 'count', monotonic: true, commonLines: [0.5, 1.5],
    help: 'Rushing, receiving or return TD. Passing TDs don\u2019t count.' },

  // ---- Kicking ----
  { key: 'NFL_FG_MADE',        label: 'Field Goals Made',  short: 'FG',    category: 'kicking', sport: 'nfl', kind: 'count',  monotonic: true, commonLines: [0.5, 1.5, 2.5] },
  { key: 'NFL_KICKING_POINTS', label: 'Kicking Points',    short: 'K PTS', category: 'kicking', sport: 'nfl', kind: 'points', monotonic: true, commonLines: [5.5, 6.5, 7.5, 8.5] },
  { key: 'NFL_XP_MADE',        label: 'Extra Points Made', short: 'XP',    category: 'kicking', sport: 'nfl', kind: 'count',  monotonic: true, commonLines: [1.5, 2.5, 3.5] },

  // ---- Defense ----
  { key: 'NFL_TACKLES',           label: 'Tackles + Assists', short: 'TKL',  category: 'defense', sport: 'nfl', kind: 'count', monotonic: true, commonLines: [3.5, 5.5, 7.5] },
  { key: 'NFL_SACKS',             label: 'Sacks',             short: 'SACK', category: 'defense', sport: 'nfl', kind: 'count', monotonic: true, decimal: true, commonLines: [0.5] },
  { key: 'NFL_DEF_INTERCEPTIONS', label: 'Interceptions',     short: 'INT',  category: 'defense', sport: 'nfl', kind: 'count', monotonic: true, commonLines: [0.5] },

  // ---- Fantasy ----
  { key: 'NFL_FANTASY_POINTS', label: 'Fantasy Points', short: 'FP', category: 'fantasy', sport: 'nfl', kind: 'points', monotonic: false, decimal: true,
    commonLines: [9.5, 12.5, 15.5, 18.5], help: 'Scored with the configurable engine in Settings' },

  // ---- Game lines (no player) ----
  { key: 'NFL_GAME_TOTAL', label: 'Total Points', short: 'TOTAL',      category: 'game', sport: 'nfl', scope: 'game', sides: 'overUnder',     kind: 'points', monotonic: true,
    commonLines: [40.5, 44.5, 48.5], help: 'Both teams combined' },
  { key: 'NFL_TEAM_TOTAL', label: 'Team Total',   short: 'TEAM TOTAL', category: 'game', sport: 'nfl', scope: 'game', sides: 'teamOverUnder', kind: 'points', monotonic: true,
    commonLines: [17.5, 20.5, 23.5, 27.5], help: 'One team\u2019s points' },
  { key: 'NFL_SPREAD',     label: 'Spread',       short: 'SPREAD',     category: 'game', sport: 'nfl', scope: 'game', sides: 'team', handicap: true, kind: 'points', monotonic: false,
    commonLines: [-7.5, -3.5, -2.5, 2.5, 3.5, 7.5], help: 'The margin to beat: +2.5 wins by 3, -2.5 can lose by 2' },
  { key: 'NFL_MONEYLINE',  label: 'Moneyline',    short: 'ML',         category: 'game', sport: 'nfl', scope: 'game', sides: 'team',          kind: 'points', monotonic: false,
    commonLines: [0], help: 'Pick the winner' },

  // ---- First quarter. Graded the moment Q1 ends, not at the final whistle. ----
  { key: 'NFL_1Q_WINNER', label: '1st Quarter Winner', short: '1Q WIN',    category: 'game', sport: 'nfl', scope: 'game', sides: 'team', period: 1, kind: 'points', monotonic: false,
    commonLines: [0], help: 'Most points in Q1; a tied quarter pushes' },
  { key: 'NFL_1Q_SPREAD', label: '1st Quarter Spread', short: '1Q SPREAD', category: 'game', sport: 'nfl', scope: 'game', sides: 'team', handicap: true, period: 1, kind: 'points', monotonic: false,
    commonLines: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5], help: 'Spread on Q1 scoring alone' },
  { key: 'NFL_1Q_TOTAL',  label: '1st Quarter Total',  short: '1Q TOTAL',  category: 'game', sport: 'nfl', scope: 'game', sides: 'overUnder', period: 1, kind: 'points', monotonic: true,
    commonLines: [7.5, 9.5, 10.5, 11.5], help: 'Both teams combined in Q1' },
];

export const ALL_PROPS: PropDef[] = [...PROPS, ...NFL_PROPS];

export const PROP_BY_KEY: Record<string, PropDef> = Object.fromEntries(
  ALL_PROPS.map((p) => [p.key, p]),
);

export function sportOf(p: PropDef | undefined): Sport {
  return p?.sport ?? 'mlb';
}

export function propsFor(category: PropCategory, sport: Sport = 'mlb'): PropDef[] {
  return ALL_PROPS.filter((p) => p.category === category && sportOf(p) === sport);
}

/**
 * NFL prop menus by position -- a quarterback sees passing first, a kicker
 * sees kicking only, and defenders see defensive stats rather than yardage.
 */
export function nflCategoriesForPosition(position?: string | null): PropCategory[] {
  const pos = (position ?? '').toUpperCase();
  if (pos === 'QB') return ['passing', 'rushing', 'scoring', 'fantasy'];
  if (pos === 'RB' || pos === 'FB') return ['rushing', 'receiving', 'scoring', 'fantasy'];
  if (pos === 'WR' || pos === 'TE') return ['receiving', 'rushing', 'scoring', 'fantasy'];
  if (pos === 'K' || pos === 'PK') return ['kicking'];
  if (['LB', 'ILB', 'OLB', 'MLB', 'DE', 'DT', 'NT', 'DL', 'EDGE', 'CB', 'S', 'SS', 'FS', 'DB'].includes(pos)) {
    return ['defense'];
  }
  return ['rushing', 'receiving', 'scoring'];
}

export const CATEGORY_LABELS: Record<PropCategory, string> = {
  batting: 'Batting Props', pitching: 'Pitching Props',
  passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', scoring: 'Scoring',
  kicking: 'Kicking', defense: 'Defense', fantasy: 'Fantasy', game: 'Game Lines',
};

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

export type Direction = 'OVER' | 'UNDER' | 'TEAM';

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
