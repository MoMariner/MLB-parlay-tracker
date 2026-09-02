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

export interface StatsSnapshot {
  batting: BattingStats;
  pitching: PitchingStats;
  found: boolean;
  position: string | null;
  isCurrentPitcher: boolean;
}

export interface Bet {
  id: string;
  playerId: number;
  gamePk: number;
  teamId: number;
  betType: string;
  source: string;
  direction: 'OVER' | 'UNDER';
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
  winProbability: number | null;
  chancesLeft: number | null;
  parlayId: string | null;
  settledAt: string | null;
  createdAt: string;
  player: {
    id: number; fullName: string; teamId: number | null; teamName: string | null;
    teamAbbrev: string | null; position: string | null; positionType: string | null;
  };
  game: {
    gamePk: number; gameDate: string; status: string; detailedState: string | null;
    homeTeamId: number; homeName: string; homeAbbrev: string;
    awayTeamId: number; awayName: string; awayAbbrev: string;
    homeScore: number | null; awayScore: number | null;
    inning: number | null; inningState: string | null; outs: number | null;
    balls: number | null; strikes: number | null;
    onFirst: boolean; onSecond: boolean; onThird: boolean;
    currentPitcherId: number | null; currentPitcherName: string | null;
  };
}

export interface PropDef {
  key: string; label: string; short: string;
  category: 'batting' | 'pitching';
  commonLines: number[];
  decimal?: boolean;
  help?: string;
}

export interface PropGroup {
  category: 'batting' | 'pitching';
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
