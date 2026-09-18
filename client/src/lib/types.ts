export type Sport = 'mlb' | 'nfl';

export type PropCategory =
  | 'batting' | 'pitching'
  | 'passing' | 'rushing' | 'receiving' | 'scoring' | 'kicking' | 'defense' | 'fantasy' | 'game';

/** A player as returned by search -- MLB or NFL, same shape. */
export interface MlbPlayer {
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

/** A game as listed in a picker. Football games also carry logos, clock and market lines. */
export interface MlbGame {
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
  inning: number | null;
  inningState: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  period?: number | null;
  clock?: string | null;
  marketTotal?: number | null;
  marketSpread?: number | null;
  oddsDetails?: string | null;
}

export interface BattingStats {
  atBats: number; hits: number; singles: number; doubles: number; triples: number;
  homeRuns: number; runs: number; rbi: number; walks: number; hitByPitch: number;
  strikeOuts: number; stolenBases: number; caughtStealing: number;
  totalBases: number; plateAppearances: number; hitsRunsRbis: number;
}

export interface PitchingStats {
  outs: number; inningsPitched: number; pitches: number; strikeOuts: number;
  hitsAllowed: number; runsAllowed: number; earnedRuns: number; walks: number;
  hitBatsmen: number; battersFaced: number; homeRunsAllowed: number;
}

/** MLB stat line stored on a leg. */
export interface StatsSnapshot {
  batting: BattingStats;
  pitching: PitchingStats;
  found: boolean;
  position: string | null;
  isCurrentPitcher: boolean;
}

/** NFL stat line stored on a leg, as { nfl: NflLine }. */
export interface NflLine {
  found: boolean;
  teamId: number | null;
  passing: { completions: number; attempts: number; yards: number; touchdowns: number; interceptions: number; sacks: number };
  rushing: { attempts: number; yards: number; touchdowns: number; long: number };
  receiving: { receptions: number; targets: number; yards: number; touchdowns: number; long: number };
  fumbles: { fumbles: number; lost: number };
  defense: { tackles: number; solo: number; sacks: number; tfl: number; passesDefended: number; qbHits: number; touchdowns: number; interceptions: number };
  kicking: { fgMade: number; fgAttempts: number; xpMade: number; xpAttempts: number; points: number; long: number };
  returns: { kickTouchdowns: number; puntTouchdowns: number };
}

/** The live game a leg rides on, as stored and pushed by the server. */
export interface Game {
  key: string;
  sport: Sport;
  gamePk: number;
  gameDate: string;
  status: string;
  detailedState: string | null;
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
  // MLB
  inning: number | null;
  inningState: string | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  currentPitcherId: number | null;
  currentPitcherName: string | null;
  // NFL
  period: number | null;
  clock: string | null;
  possessionTeamId: number | null;
  down: number | null;
  distance: number | null;
  yardsToEndzone: number | null;
  downDistanceText: string | null;
  isRedZone: boolean;
  lastPlay: string | null;
  homeLinescores: string | null;
  awayLinescores: string | null;
  homeWinProb: number | null;
  marketTotal: number | null;
  marketSpread: number | null;
}

export interface Bet {
  id: string;
  sport: Sport;
  playerKey: string | null;
  playerId: number | null;
  gameKey: string;
  gamePk: number;
  teamId: number | null;
  betType: string;
  source: string;
  direction: 'OVER' | 'UNDER' | 'TEAM';
  line: number;
  odds: number | null;
  stake: number | null;
  status: 'PENDING' | 'LIVE' | 'WON' | 'LOST' | 'PUSH' | 'VOID';
  currentValue: number;
  progress: number;
  statsSnapshot: string | null;
  battingStatus: string | null;
  battersAway: number | null;
  expectedInning: number | null;
  expectedHalf: string | null;
  expectedInningsLeft: number | null;
  workloadNote: string | null;
  shortLeash: boolean;
  fieldStatus: string | null;
  paceValue: number | null;
  winProbability: number | null;
  chancesLeft: number | null;
  parlayId: string | null;
  settledAt: string | null;
  createdAt: string;
  /** Null on game lines (totals, spreads, moneylines). */
  player: {
    id: number; fullName: string; teamId: number | null; teamName: string | null;
    teamAbbrev: string | null; position: string | null; positionType: string | null;
  } | null;
  game: Game;
}

export interface PropDef {
  key: string;
  label: string;
  short: string;
  category: PropCategory;
  commonLines: number[];
  decimal?: boolean;
  help?: string;
  sport?: Sport;
  scope?: 'player' | 'game';
  sides?: 'overUnder' | 'team' | 'teamOverUnder';
  handicap?: boolean;
  period?: number;
  kind?: 'count' | 'yards' | 'long' | 'points';
  monotonic?: boolean;
}

export interface PropGroup {
  category: PropCategory;
  label: string;
  props: PropDef[];
}

export interface AppSettings {
  livePollIntervalMs: number;
  previewPollIntervalMs: number;
  keepSettledOnDashboard: boolean;
  tvMode: boolean;
  demoMode: boolean;
}

export interface ScoringFormat {
  label: string;
  batting: Record<string, number>;
  pitching: Record<string, number>;
}

/** NFL fantasy formats are flat: a label plus stat -> points. */
export type NflScoring = { label: string } & Record<string, number | string>;

export interface ParlayPoint {
  id: string;
  probability: number;
  reason: string | null;
  createdAt: string;
}

export interface Parlay {
  id: string;
  name: string | null;
  source: string;
  odds: number | null;
  stake: number | null;
  payout: number | null;
  status: 'PENDING' | 'LIVE' | 'WON' | 'LOST' | 'PUSH';
  winProbability: number | null;
  settledAt: string | null;
  createdAt: string;
  bets: Bet[];
  history?: ParlayPoint[];
}
