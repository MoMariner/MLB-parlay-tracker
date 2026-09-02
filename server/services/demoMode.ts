/**
 * Demo mode (spec §24: "Demo mode can use mock data separately").
 *
 * Emits a synthetic payload in the exact shape of a real MLB live feed, so it
 * flows through the same extractor / evaluator / poller as live baseball --
 * no mock branches anywhere else in the codebase.
 *
 * Demo games use NEGATIVE gamePks and demo players use negative IDs, so they
 * can never collide with real MLB records.
 */

export const DEMO_GAME_PK = -1;

export const DEMO_PLAYERS = [
  { id: -101, fullName: 'Demo Slugger',   position: 'RF', type: 'Outfielder', slot: 1 },
  { id: -102, fullName: 'Demo Leadoff',   position: 'CF', type: 'Outfielder', slot: 2 },
  { id: -103, fullName: 'Demo Infielder', position: 'SS', type: 'Infielder',  slot: 3 },
  { id: -104, fullName: 'Demo Catcher',   position: 'C',  type: 'Catcher',    slot: 4 },
  { id: -105, fullName: 'Demo Utility',   position: '2B', type: 'Infielder',  slot: 5 },
  { id: -106, fullName: 'Demo Corner',    position: '3B', type: 'Infielder',  slot: 6 },
  { id: -107, fullName: 'Demo Left',      position: 'LF', type: 'Outfielder', slot: 7 },
  { id: -108, fullName: 'Demo First',     position: '1B', type: 'Infielder',  slot: 8 },
  { id: -109, fullName: 'Demo Nine',      position: 'DH', type: 'Hitter',     slot: 9 },
];

export const DEMO_PITCHER = { id: -201, fullName: 'Demo Ace', position: 'P', type: 'Pitcher' };

export const DEMO_TEAM_HOME = { id: -10, name: 'Demo Away', abbreviation: 'DMA' };
export const DEMO_TEAM_AWAY = { id: -11, name: 'Demo Home', abbreviation: 'DMH' };

/** Ticks since demo mode was switched on; drives the simulated game clock. */
let tick = 0;

export function resetDemo(): void {
  tick = 0;
}

export function advanceDemo(): void {
  tick += 1;
}

export function getDemoTick(): number {
  return tick;
}

/** Deterministic pseudo-random in [0,1) so a reload doesn't rewrite history. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function battingLine(playerId: number, plateAppearances: number) {
  let hits = 0, doubles = 0, triples = 0, homeRuns = 0, walks = 0, strikeOuts = 0;
  let runs = 0, rbi = 0, stolenBases = 0, atBats = 0;

  for (let i = 0; i < plateAppearances; i++) {
    const r = rand(playerId * 7919 + i * 104729);
    if (r < 0.09) { walks += 1; continue; }
    atBats += 1;
    if (r < 0.31) { strikeOuts += 1; continue; }
    if (r < 0.41) { hits += 1; }
    else if (r < 0.47) { hits += 1; doubles += 1; }
    else if (r < 0.485) { hits += 1; triples += 1; }
    else if (r < 0.53) { hits += 1; homeRuns += 1; rbi += 1 + Math.floor(rand(i + playerId) * 2); runs += 1; }
  }
  if (hits > 0) {
    runs += Math.floor(rand(playerId * 3) * hits);
    rbi += Math.floor(rand(playerId * 5) * hits);
  }
  if (rand(playerId * 11) > 0.85) stolenBases = 1;

  const singles = hits - doubles - triples - homeRuns;
  return {
    summary: `${hits}-${atBats}`, gamesPlayed: 1, flyOuts: 0, groundOuts: 0, airOuts: 0,
    runs, doubles, triples, homeRuns, strikeOuts, baseOnBalls: walks, intentionalWalks: 0,
    hits, hitByPitch: 0, atBats, caughtStealing: 0, stolenBases,
    groundIntoDoublePlay: 0, plateAppearances,
    totalBases: singles + doubles * 2 + triples * 3 + homeRuns * 4,
    rbi, leftOnBase: 0, sacBunts: 0, sacFlies: 0,
  };
}

function pitchingLine(outs: number) {
  const strikeOuts = Math.floor(outs * 0.38);
  const hitsAllowed = Math.floor(outs * 0.28);
  const earnedRuns = Math.floor(outs * 0.09);
  return {
    summary: `${Math.floor(outs / 3)}.${outs % 3} IP`, gamesPlayed: 1, gamesStarted: 1,
    runs: earnedRuns, doubles: 1, triples: 0, homeRuns: Math.floor(outs * 0.03),
    strikeOuts, baseOnBalls: Math.floor(outs * 0.11), intentionalWalks: 0,
    hits: hitsAllowed, hitByPitch: 0, atBats: outs + hitsAllowed,
    numberOfPitches: outs * 5 + 12, pitchesThrown: outs * 5 + 12,
    inningsPitched: `${Math.floor(outs / 3)}.${outs % 3}`,
    earnedRuns, battersFaced: outs + hitsAllowed + 3, outs, hitBatsmen: 0,
  };
}

/**
 * Build a live-feed-shaped object for the demo game at the current tick.
 * The game walks from Preview -> Live -> Final over roughly 60 ticks.
 */
export function buildDemoFeed(): any {
  const t = tick;
  const abstractGameState = t < 2 ? 'Preview' : t < 58 ? 'Live' : 'Final';
  const detailedState = t < 2 ? 'Pre-Game' : t < 58 ? 'In Progress' : 'Final';

  // ~3 ticks per half inning.
  const halfInnings = Math.min(18, Math.max(0, Math.floor((t - 2) / 3)));
  const inning = Math.min(9, Math.floor(halfInnings / 2) + 1);
  const isTopInning = halfInnings % 2 === 0;
  const outs = t < 2 ? 0 : (t - 2) % 3;

  // One completed plate appearance per tick. Deriving each hitter's PA count
  // straight from this running total keeps every stat MONOTONIC -- real
  // counting stats never go down, and a bet card that ticked backwards would
  // read as a bug.
  const totalPA = Math.max(0, t - 2);
  const paForSlot = (slot: number): number =>
    totalPA < slot ? 0 : Math.floor((totalPA - slot) / 9) + 1;
  const currentSlot = t < 2 ? 1 : (totalPA % 9) + 1;

  const awayPlayers: Record<string, any> = {};
  for (const p of DEMO_PLAYERS) {
    awayPlayers[`ID${p.id}`] = {
      person: { id: p.id, fullName: p.fullName },
      jerseyNumber: String(p.slot),
      position: { abbreviation: p.position, type: p.type },
      battingOrder: String(p.slot * 100),
      stats: { batting: battingLine(p.id, paForSlot(p.slot)), pitching: {}, fielding: {} },
      seasonStats: {},
    };
  }

  const pitcherOuts = Math.min(21, Math.max(0, (t - 2)));
  const homePlayers: Record<string, any> = {
    [`ID${DEMO_PITCHER.id}`]: {
      person: { id: DEMO_PITCHER.id, fullName: DEMO_PITCHER.fullName },
      jerseyNumber: '1',
      position: { abbreviation: 'P', type: 'Pitcher' },
      stats: { batting: {}, pitching: pitchingLine(pitcherOuts), fielding: {} },
      seasonStats: {},
    },
  };

  const order = DEMO_PLAYERS.map((p) => p.id);
  const idx = (n: number) => order[(currentSlot - 1 + n) % 9];

  const awayScore = Math.floor(halfInnings / 3);
  const homeScore = Math.floor(halfInnings / 4);

  return {
    gamePk: DEMO_GAME_PK,
    gameData: {
      game: { pk: DEMO_GAME_PK },
      datetime: { dateTime: new Date().toISOString() },
      status: { abstractGameState, detailedState },
      teams: {
        home: { id: DEMO_TEAM_AWAY.id, name: DEMO_TEAM_AWAY.name, teamName: DEMO_TEAM_AWAY.name, abbreviation: DEMO_TEAM_AWAY.abbreviation },
        away: { id: DEMO_TEAM_HOME.id, name: DEMO_TEAM_HOME.name, teamName: DEMO_TEAM_HOME.name, abbreviation: DEMO_TEAM_HOME.abbreviation },
      },
    },
    liveData: {
      linescore: {
        currentInning: t < 2 ? null : inning,
        currentInningOrdinal: `${inning}th`,
        inningState: outs === 3 ? 'Middle' : isTopInning ? 'Top' : 'Bottom',
        isTopInning,
        outs,
        teams: { home: { runs: homeScore, hits: 5, errors: 0 }, away: { runs: awayScore, hits: 7, errors: 0 } },
        offense: t < 2 || abstractGameState === 'Final' ? {} : {
          batter: { id: idx(0), fullName: '' },
          onDeck: { id: idx(1), fullName: '' },
          inHole: { id: idx(2), fullName: '' },
          battingOrder: currentSlot,
          team: { id: DEMO_TEAM_HOME.id, name: DEMO_TEAM_HOME.name },
        },
        defense: { pitcher: { id: DEMO_PITCHER.id, fullName: DEMO_PITCHER.fullName }, team: { id: DEMO_TEAM_AWAY.id } },
      },
      boxscore: {
        teams: {
          away: { team: { id: DEMO_TEAM_HOME.id, name: DEMO_TEAM_HOME.name, abbreviation: DEMO_TEAM_HOME.abbreviation }, players: awayPlayers, batters: order, pitchers: [], battingOrder: order },
          home: { team: { id: DEMO_TEAM_AWAY.id, name: DEMO_TEAM_AWAY.name, abbreviation: DEMO_TEAM_AWAY.abbreviation }, players: homePlayers, batters: [], pitchers: [DEMO_PITCHER.id], battingOrder: [] },
        },
      },
      plays: { currentPlay: {} },
    },
  };
}

export function isDemoGame(gamePk: number): boolean {
  return gamePk < 0;
}
