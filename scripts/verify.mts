/** Edge cases the real game didn't exercise: substitutions, absent players, finals. */
import { extractGameSnapshot, extractBattingStatus } from '../server/services/statExtractor.js';
import { evaluateBet } from '../server/services/propEvaluator.js';

const feed = (opts: {
  state?: string; order?: number[]; slots?: Record<number, string>;
  batter?: number; onDeck?: number; inHole?: number; slot?: number; offenseTeam?: number;
}) => {
  const order = opts.order ?? [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const slots = opts.slots ?? Object.fromEntries(order.map((id, i) => [id, String((i + 1) * 100)]));
  const players: any = {};
  for (const [id, bo] of Object.entries(slots)) {
    players[`ID${id}`] = { person: { id: +id, fullName: `P${id}` }, position: { abbreviation: 'LF', type: 'Outfielder' }, battingOrder: bo, stats: { batting: {}, pitching: {} } };
  }
  return {
    gamePk: 1,
    gameData: { status: { abstractGameState: opts.state ?? 'Live', detailedState: 'x' }, teams: { home: { id: 20 }, away: { id: 10 } }, datetime: {} },
    liveData: {
      linescore: {
        currentInning: 5, inningState: 'Top', isTopInning: true, outs: 1,
        teams: { home: { runs: 0 }, away: { runs: 0 } },
        offense: { batter: { id: opts.batter ?? 1 }, onDeck: { id: opts.onDeck ?? 2 }, inHole: { id: opts.inHole ?? 3 }, battingOrder: opts.slot ?? 1, team: { id: opts.offenseTeam ?? 10 } },
        defense: { pitcher: { id: 99 } },
      },
      boxscore: { teams: {
        away: { team: { id: 10 }, players, batters: order, pitchers: [], battingOrder: order },
        home: { team: { id: 20 }, players: {}, batters: [], pitchers: [99], battingOrder: [] },
      } },
    },
  };
};

const check = (name: string, got: string, want: string) =>
  console.log(`  ${got === want ? '✓' : '✗ FAIL'}  ${name.padEnd(46)} ${got}${got === want ? '' : `  (wanted ${want})`}`);

let f = feed({});
let snap = extractGameSnapshot(f);
check('player 5 mid-lineup', extractBattingStatus(f, 5, snap).status, 'BATTERS_AWAY');
check('player not in boxscore at all', extractBattingStatus(f, 77, snap).status, 'NOT_IN_LINEUP');

// Pinch-hitter: player 4 had slot 4, is replaced by 44 in the active nine.
f = feed({ order: [1, 2, 3, 44, 5, 6, 7, 8, 9], slots: { 1:'100',2:'200',3:'300',4:'400',44:'401',5:'500',6:'600',7:'700',8:'800',9:'900' } });
snap = extractGameSnapshot(f);
check('pinch-hit-for starter -> removed', extractBattingStatus(f, 4, snap).status, 'PLAYER_REMOVED');
check('the substitute himself is active', extractBattingStatus(f, 44, snap).status, 'BATTERS_AWAY');

// Their team is fielding.
f = feed({ offenseTeam: 20 });
snap = extractGameSnapshot(f);
check('team on defense -> waiting', extractBattingStatus(f, 5, snap).status, 'WAITING_FOR_NEXT_AB');

f = feed({ state: 'Final' }); snap = extractGameSnapshot(f);
check('final game', extractBattingStatus(f, 5, snap).status, 'GAME_FINAL');
f = feed({ state: 'Preview' }); snap = extractGameSnapshot(f);
check('game not started', extractBattingStatus(f, 5, snap).status, 'GAME_NOT_STARTED');

console.log('\n  Settlement rules:');
const st: any = { batting: { hits: 2, singles: 2, doubles: 0, triples: 0, homeRuns: 0, runs: 0, rbi: 0, walks: 0, hitByPitch: 0, strikeOuts: 0, stolenBases: 0, caughtStealing: 0, totalBases: 2, atBats: 3, plateAppearances: 3, hitsRunsRbis: 2 }, pitching: {}, battingStatus: {}, found: true };
const live = extractGameSnapshot(feed({}));
const final = extractGameSnapshot(feed({ state: 'Final' }));
const pre = extractGameSnapshot(feed({ state: 'Preview' }));

check('OVER 1.5 with 2 hits, mid-game -> clinched', evaluateBet({ betType:'HITS',source:'manual',direction:'OVER',line:1.5 }, st, live).status, 'WON');
check('UNDER 1.5 with 2 hits, mid-game -> dead', evaluateBet({ betType:'HITS',source:'manual',direction:'UNDER',line:1.5 }, st, live).status, 'LOST');
check('OVER 2.5 with 2 hits, still live', evaluateBet({ betType:'HITS',source:'manual',direction:'OVER',line:2.5 }, st, live).status, 'LIVE');
check('OVER 2.5 with 2 hits at FINAL -> lost', evaluateBet({ betType:'HITS',source:'manual',direction:'OVER',line:2.5 }, st, final).status, 'LOST');
check('UNDER 2.5 with 2 hits at FINAL -> won', evaluateBet({ betType:'HITS',source:'manual',direction:'UNDER',line:2.5 }, st, final).status, 'WON');
check('whole-number line 2 with 2 hits -> push', evaluateBet({ betType:'HITS',source:'manual',direction:'OVER',line:2 }, st, final).status, 'PUSH');
check('pre-game is PENDING not LOST', evaluateBet({ betType:'HITS',source:'manual',direction:'OVER',line:1.5 }, st, pre).status, 'PENDING');
