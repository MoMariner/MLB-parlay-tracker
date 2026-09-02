/**
 * Turns one MLB live-feed payload into per-player stat lines (spec §18) and
 * the batting-status badge (spec §16).
 *
 * Everything here is pure: the polling manager fetches the feed ONCE per
 * gamePk and calls these functions for each player that has a bet on it.
 */

export interface BattingStats {
  atBats: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
  strikeOuts: number;
  stolenBases: number;
  caughtStealing: number;
  totalBases: number;
  plateAppearances: number;
  /** Convenience for the H+R+RBI prop (spec §6). */
  hitsRunsRbis: number;
}

export interface PitchingStats {
  outs: number;
  inningsPitched: number;
  pitches: number;
  strikeOuts: number;
  hitsAllowed: number;
  runsAllowed: number;
  earnedRuns: number;
  walks: number;
  hitBatsmen: number;
  battersFaced: number;
  homeRunsAllowed: number;
}

export type BattingStatus =
  | 'AT_BAT'
  | 'ON_DECK'
  | 'COMING_UP'
  | 'BATTERS_AWAY'
  | 'WAITING_FOR_NEXT_AB'
  | 'GAME_FINAL'
  | 'GAME_NOT_STARTED'
  | 'PLAYER_REMOVED'
  | 'NOT_IN_LINEUP';

export interface BattingStatusInfo {
  status: BattingStatus;
  /** Populated for BATTERS_AWAY: how many hitters until this player's spot. */
  battersAway?: number;
  label: string;
  /** Inning this player is projected to bat in next, e.g. 7. */
  expectedInning?: number;
  /** Which half of that inning: 'Top' or 'Bottom'. */
  expectedHalf?: 'Top' | 'Bottom';
}

/**
 * Project which half-inning a hitter is next due up in.
 *
 * Their team bats every other half-inning. Starting from the next half their
 * team hits in, spend the hitters that come before them (`battersAway`) at a
 * typical ~4.4 batters per half-inning, rolling into later innings until their
 * spot lands. Approximate by nature -- a long inning moves everyone up.
 */
export function projectBattingInning(
  currentInning: number,
  isTopInning: boolean,
  outs: number,
  playerBatsTop: boolean,
  isTeamBatting: boolean,
  battersAway: number,
): { inning: number; half: 'Top' | 'Bottom' } {
  const half: 'Top' | 'Bottom' = playerBatsTop ? 'Top' : 'Bottom';

  let inning = currentInning;
  // Batters their team still gets in the half-inning we start counting from.
  let available: number;

  if (isTeamBatting) {
    // Mid-inning: roughly 1.45 hitters per out still to come.
    available = Math.max(0, (3 - outs) * 1.45);
  } else if (playerBatsTop && !isTopInning) {
    // Away hitter while the home team bats -- they lead off next inning.
    inning += 1;
    available = 4.4;
  } else {
    // Home hitter while the away team bats -- they hit in this inning's bottom.
    available = 4.4;
  }

  let remaining = battersAway;
  // Walk forward a full turn at a time until their spot fits.
  for (let guard = 0; guard < 12; guard++) {
    if (remaining < available) return { inning, half };
    remaining -= available;
    inning += 1;
    available = 4.4;
  }
  return { inning, half };
}

export interface GameSnapshot {
  gamePk: number;
  status: 'Preview' | 'Live' | 'Final' | 'Other';
  detailedState: string;
  homeTeamId: number;
  homeName: string;
  homeAbbrev: string;
  awayTeamId: number;
  awayName: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  inning: number | null;
  inningState: string | null;
  isTopInning: boolean | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  currentPitcherId: number | null;
  currentPitcherName: string | null;
  gameDate: string;
}

export interface PlayerGameState {
  found: boolean;
  teamId: number | null;
  positionAbbrev: string | null;
  positionType: string | null;
  batting: BattingStats;
  pitching: PitchingStats;
  battingStatus: BattingStatusInfo;
  /** Current pitcher facing / opposing, for context on the bet card. */
  isCurrentPitcher: boolean;
}

export const EMPTY_BATTING: BattingStats = {
  atBats: 0, hits: 0, singles: 0, doubles: 0, triples: 0, homeRuns: 0,
  runs: 0, rbi: 0, walks: 0, hitByPitch: 0, strikeOuts: 0,
  stolenBases: 0, caughtStealing: 0, totalBases: 0, plateAppearances: 0,
  hitsRunsRbis: 0,
};

export const EMPTY_PITCHING: PitchingStats = {
  outs: 0, inningsPitched: 0, pitches: 0, strikeOuts: 0, hitsAllowed: 0,
  runsAllowed: 0, earnedRuns: 0, walks: 0, hitBatsmen: 0, battersFaced: 0,
  homeRunsAllowed: 0,
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function extractGameSnapshot(feed: any): GameSnapshot {
  const gd = feed?.gameData ?? {};
  const ld = feed?.liveData ?? {};
  const ls = ld.linescore ?? {};
  const abstract = gd.status?.abstractGameState;

  return {
    gamePk: feed?.gamePk ?? gd.game?.pk ?? 0,
    status: abstract === 'Preview' || abstract === 'Live' || abstract === 'Final' ? abstract : 'Other',
    detailedState: gd.status?.detailedState ?? 'Unknown',
    homeTeamId: gd.teams?.home?.id ?? 0,
    homeName: gd.teams?.home?.teamName ?? gd.teams?.home?.name ?? '',
    homeAbbrev: gd.teams?.home?.abbreviation ?? '',
    awayTeamId: gd.teams?.away?.id ?? 0,
    awayName: gd.teams?.away?.teamName ?? gd.teams?.away?.name ?? '',
    awayAbbrev: gd.teams?.away?.abbreviation ?? '',
    homeScore: num(ls.teams?.home?.runs),
    awayScore: num(ls.teams?.away?.runs),
    inning: ls.currentInning ?? null,
    inningState: ls.inningState ?? null,
    isTopInning: typeof ls.isTopInning === 'boolean' ? ls.isTopInning : null,
    outs: typeof ls.outs === 'number' ? ls.outs : null,
    balls: typeof ls.balls === 'number' ? ls.balls : null,
    strikes: typeof ls.strikes === 'number' ? ls.strikes : null,
    // The feed only includes a base when someone is standing on it.
    onFirst: Boolean(ls.offense?.first),
    onSecond: Boolean(ls.offense?.second),
    onThird: Boolean(ls.offense?.third),
    currentPitcherId: ls.defense?.pitcher?.id ?? null,
    currentPitcherName: ls.defense?.pitcher?.fullName ?? null,
    gameDate: gd.datetime?.dateTime ?? '',
  };
}

function battingFrom(raw: any): BattingStats {
  const hits = num(raw?.hits);
  const doubles = num(raw?.doubles);
  const triples = num(raw?.triples);
  const homeRuns = num(raw?.homeRuns);
  const runs = num(raw?.runs);
  const rbi = num(raw?.rbi);
  // The feed carries totalBases directly; recompute as a fallback when a
  // partially-populated line omits it (spec §5: 1B=1, 2B=2, 3B=3, HR=4).
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const totalBases = raw?.totalBases != null
    ? num(raw.totalBases)
    : singles + doubles * 2 + triples * 3 + homeRuns * 4;

  return {
    atBats: num(raw?.atBats),
    hits, singles, doubles, triples, homeRuns, runs, rbi,
    walks: num(raw?.baseOnBalls),
    hitByPitch: num(raw?.hitByPitch),
    strikeOuts: num(raw?.strikeOuts),
    stolenBases: num(raw?.stolenBases),
    caughtStealing: num(raw?.caughtStealing),
    totalBases,
    plateAppearances: num(raw?.plateAppearances),
    hitsRunsRbis: hits + runs + rbi,
  };
}

function pitchingFrom(raw: any): PitchingStats {
  const outs = num(raw?.outs);
  return {
    outs,
    // "3.2" means 3 innings + 2 outs, so derive from outs instead of parseFloat.
    inningsPitched: Math.round((outs / 3) * 100) / 100,
    pitches: num(raw?.numberOfPitches) || num(raw?.pitchesThrown),
    strikeOuts: num(raw?.strikeOuts),
    hitsAllowed: num(raw?.hits),
    runsAllowed: num(raw?.runs),
    earnedRuns: num(raw?.earnedRuns),
    walks: num(raw?.baseOnBalls),
    hitBatsmen: num(raw?.hitBatsmen),
    battersFaced: num(raw?.battersFaced),
    homeRunsAllowed: num(raw?.homeRuns),
  };
}

/** Which boxscore side ("home" | "away") holds this player, if any. */
function findSide(feed: any, playerId: number): 'home' | 'away' | null {
  const teams = feed?.liveData?.boxscore?.teams;
  const key = `ID${playerId}`;
  if (teams?.away?.players?.[key]) return 'away';
  if (teams?.home?.players?.[key]) return 'home';
  return null;
}

/** Lineup slot 1-9 from the feed's "100"/"201" battingOrder encoding. */
function slotOf(order: unknown): number | null {
  const n = typeof order === 'string' ? parseInt(order, 10) : typeof order === 'number' ? order : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n / 100);
}

export function extractBattingStatus(
  feed: any,
  playerId: number,
  snapshot: GameSnapshot,
): BattingStatusInfo {
  if (snapshot.status === 'Final') return { status: 'GAME_FINAL', label: 'Game Final' };
  if (snapshot.status === 'Preview') return { status: 'GAME_NOT_STARTED', label: 'Game Not Started' };

  const side = findSide(feed, playerId);
  if (!side) return { status: 'NOT_IN_LINEUP', label: 'Not In Lineup' };

  const offense = feed?.liveData?.linescore?.offense ?? {};
  if (offense.batter?.id === playerId) return { status: 'AT_BAT', label: 'At Bat' };
  if (offense.onDeck?.id === playerId) return { status: 'ON_DECK', label: 'On Deck' };
  if (offense.inHole?.id === playerId) return { status: 'COMING_UP', label: 'Coming Up' };

  const boxTeam = feed.liveData.boxscore.teams[side];
  const currentOrder: number[] = Array.isArray(boxTeam.battingOrder) ? boxTeam.battingOrder : [];
  const entry = boxTeam.players[`ID${playerId}`];

  // In the boxscore with a lineup slot but no longer in the active nine =>
  // pinch-hit for / defensive replacement (spec §16 "PLAYER REMOVED").
  const hadSlot = slotOf(entry?.battingOrder) != null;
  if (hadSlot && currentOrder.length > 0 && !currentOrder.includes(playerId)) {
    return { status: 'PLAYER_REMOVED', label: 'Player Removed' };
  }
  if (!hadSlot) return { status: 'NOT_IN_LINEUP', label: 'Not In Lineup' };

  // Their team is fielding right now.
  const offenseTeamId = offense.team?.id;
  const playerTeamId = boxTeam.team?.id;
  if (offenseTeamId && playerTeamId && offenseTeamId !== playerTeamId) {
    // Their team is fielding, but their slot still tells us roughly when
    // they're due up once the side changes.
    const slot = currentOrder.indexOf(playerId) + 1;
    const projected = slot > 0
      ? projectBattingInning(
          snapshot.inning ?? 1,
          snapshot.isTopInning ?? true,
          snapshot.outs ?? 0,
          side === 'away',
          false,
          slot - 1,
        )
      : null;
    return {
      status: 'WAITING_FOR_NEXT_AB',
      label: 'Waiting For Next At-Bat',
      ...(projected ? { expectedInning: projected.inning, expectedHalf: projected.half } : {}),
    };
  }

  const currentSlot = feed?.liveData?.linescore?.offense?.battingOrder;
  const playerSlot = currentOrder.indexOf(playerId) + 1;
  if (typeof currentSlot === 'number' && currentSlot > 0 && playerSlot > 0) {
    const away = (playerSlot - currentSlot + 9) % 9;
    if (away === 0) return { status: 'AT_BAT', label: 'At Bat' };
    const projected = projectBattingInning(
      snapshot.inning ?? 1,
      snapshot.isTopInning ?? true,
      snapshot.outs ?? 0,
      side === 'away',
      true,
      away,
    );
    return {
      status: 'BATTERS_AWAY',
      battersAway: away,
      label: away === 1 ? '1 Batter Away' : `${away} Batters Away`,
      expectedInning: projected.inning,
      expectedHalf: projected.half,
    };
  }

  return { status: 'WAITING_FOR_NEXT_AB', label: 'Waiting For Next At-Bat' };
}

export function extractPlayerState(
  feed: any,
  playerId: number,
  snapshot: GameSnapshot,
): PlayerGameState {
  const side = findSide(feed, playerId);
  const battingStatus = extractBattingStatus(feed, playerId, snapshot);

  if (!side) {
    return {
      found: false,
      teamId: null,
      positionAbbrev: null,
      positionType: null,
      batting: { ...EMPTY_BATTING },
      pitching: { ...EMPTY_PITCHING },
      battingStatus,
      isCurrentPitcher: false,
    };
  }

  const boxTeam = feed.liveData.boxscore.teams[side];
  const entry = boxTeam.players[`ID${playerId}`];
  const currentPitcherId = feed?.liveData?.linescore?.defense?.pitcher?.id;

  return {
    found: true,
    teamId: boxTeam.team?.id ?? null,
    positionAbbrev: entry?.position?.abbreviation ?? null,
    positionType: entry?.position?.type ?? null,
    batting: battingFrom(entry?.stats?.batting),
    pitching: pitchingFrom(entry?.stats?.pitching),
    battingStatus,
    isCurrentPitcher: currentPitcherId === playerId,
  };
}
