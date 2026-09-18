/**
 * NFL settlement and win-probability checks: real finals graded against
 * their box scores, the probability model against hand-computed values, and
 * player search against nicknames.
 * Usage: npm run nfl-verify
 */
import { nflGetSummary, nflSearchPlayers } from '../server/nfl/espnApi.js';
import { extractNflSnapshot, extractNflLine, EMPTY_NFL_LINE, type NflSnapshot } from '../server/nfl/stats.js';
import { nflValue, evaluateNflLeg } from '../server/nfl/evaluator.js';
import { nflLegProbability, remainingFraction, normCdf, normInv, poissonCdf } from '../server/nfl/winProbability.js';
import { firstNameMatches, splitName } from '../server/services/nameSearch.js';
import { spreadRequirement } from '../client/src/lib/nfl.js';
import { correlatedParlayProbability, type CorrelatedLeg } from '../server/services/correlation.js';
import { PROP_BY_KEY } from '../shared/props.js';

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown, tol = 0) => {
  const ok = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) <= tol : got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${name.padEnd(56)} ${typeof got === 'number' ? Math.round(got * 1000) / 1000 : got}${ok ? '' : `  (wanted ${want})`}`);
};

// ---- real final: NE 10 @ SEA 13, 2026 Week 1 ----
const summary = await nflGetSummary(401872656);
const s = extractNflSnapshot(summary);
const idOf = (name: string) => {
  for (const t of summary.boxscore.players) for (const c of t.statistics)
    for (const a of c.athletes) if (a.athlete.displayName === name) return Number(a.athlete.id);
  throw new Error(`no ${name}`);
};
const grade = (betType: string, direction: string, line: number, who: string | null, teamId: number | null = null, source = 'underdog') => {
  const def = PROP_BY_KEY[betType]!;
  const l = who ? extractNflLine(summary, idOf(who)) : EMPTY_NFL_LINE;
  const value = nflValue(betType, l, s, who ? l.teamId : teamId, source);
  return { value, status: evaluateNflLeg({ betType, direction, line }, def, value, s).status };
};
const SEA = s.homeTeamId, NE = s.awayTeamId;

console.log(`\n  Graded against the final (${s.awayAbbrev} ${s.awayScore} @ ${s.homeAbbrev} ${s.homeScore}):`);
let g = grade('NFL_REC_YARDS', 'OVER', 99.5, 'Jaxon Smith-Njigba');          check('JSN over 99.5 rec yds (122)', g.status, 'WON');
g = grade('NFL_PASS_YARDS', 'OVER', 199.5, 'Drake Maye');                    check('Maye over 199.5 pass yds (178)', g.status, 'LOST');
g = grade('NFL_INTERCEPTIONS_THROWN', 'OVER', 1.5, 'Drake Maye');            check('Maye over 1.5 INT thrown (3)', g.status, 'WON');
g = grade('NFL_PASS_TDS', 'UNDER', 1.5, 'Drake Maye');                       check('Maye under 1.5 pass TD (1)', g.status, 'WON');
g = grade('NFL_ANYTIME_TD', 'OVER', 0.5, 'Jaxon Smith-Njigba');              check('JSN anytime TD (1 rec TD)', g.status, 'WON');
g = grade('NFL_KICKING_POINTS', 'OVER', 6.5, 'Jason Myers');                 check('Myers over 6.5 kicking pts (7)', g.status, 'WON');
g = grade('NFL_TACKLES', 'OVER', 10.5, 'Ernest Jones IV');                   check('E. Jones over 10.5 tackles (13)', g.status, 'WON');
g = grade('NFL_FANTASY_POINTS', 'OVER', 19.5, 'Jaxon Smith-Njigba');         check('JSN Underdog FP = 8x.5 + 12.2 + 6', g.value, 22.2, 0.001);
g = grade('NFL_FANTASY_POINTS', 'OVER', 19.5, 'Jaxon Smith-Njigba', null, 'draftkings'); check('JSN DraftKings FP = 8 + 12.2 + 6 + 3 bonus', g.value, 29.2, 0.001);
g = grade('NFL_GAME_TOTAL', 'OVER', 22.5, null);                             check('Total over 22.5 (23)', g.status, 'WON');
g = grade('NFL_GAME_TOTAL', 'UNDER', 44.5, null);                            check('Total under 44.5 (23)', g.status, 'WON');
g = grade('NFL_GAME_TOTAL', 'OVER', 23, null);                               check('Total over 23 exactly -> push', g.status, 'PUSH');
g = grade('NFL_SPREAD', 'TEAM', 2.5, null, SEA);                             check('SEA by 2.5+, won by 3 -> covers', g.status, 'WON');
g = grade('NFL_SPREAD', 'TEAM', 3, null, SEA);                               check('SEA by 3+, won by exactly 3 -> push', g.status, 'PUSH');
g = grade('NFL_SPREAD', 'TEAM', 3.5, null, SEA);                             check('SEA by 3.5+, won by 3 -> loses', g.status, 'LOST');
g = grade('NFL_SPREAD', 'TEAM', -3.5, null, NE);                             check('NE within 3.5, lost by 3 -> covers', g.status, 'WON');
g = grade('NFL_SPREAD', 'TEAM', -3, null, NE);                               check('NE within 3, lost by exactly 3 -> push', g.status, 'PUSH');
g = grade('NFL_SPREAD', 'TEAM', -2.5, null, NE);                             check('NE within 2.5, lost by 3 -> loses', g.status, 'LOST');
g = grade('NFL_MONEYLINE', 'TEAM', 0, null, SEA);                            check('SEA moneyline', g.status, 'WON');
g = grade('NFL_MONEYLINE', 'TEAM', 0, null, NE);                             check('NE moneyline', g.status, 'LOST');
g = grade('NFL_TEAM_TOTAL', 'OVER', 12.5, null, SEA);                        check('SEA team total over 12.5 (13)', g.status, 'WON');
g = grade('NFL_TEAM_TOTAL', 'UNDER', 10.5, null, NE);                        check('NE team total under 10.5 (10)', g.status, 'WON');

// ---- live rules on synthetic states ----
const live = (o: Partial<NflSnapshot>): NflSnapshot => ({
  ...s, status: 'Live', period: 1, clock: '15:00', homeScore: 0, awayScore: 0,
  homeWinProb: null, marketTotal: 44.5, marketSpread: -3, ...o,
});
const ev = (betType: string, dir: string, line: number, value: number, snap: NflSnapshot) =>
  evaluateNflLeg({ betType, direction: dir, line }, PROP_BY_KEY[betType]!, value, snap).status;

console.log('\n  Live settlement rules:');
check('rec yds over 49.5 at 60, live -> WON (10.5 clear)', ev('NFL_REC_YARDS', 'OVER', 49.5, 60, live({})), 'WON');
check('rec yds over 49.5 at 52, live -> LIVE (a loss still takes it back)', ev('NFL_REC_YARDS', 'OVER', 49.5, 52, live({})), 'LIVE');
check('rec yds under 49.5 at 60, live -> LOST', ev('NFL_REC_YARDS', 'UNDER', 49.5, 60, live({})), 'LOST');
check('rush yds over 25.5 at 40, live -> WON', ev('NFL_RUSH_YARDS', 'OVER', 25.5, 40, live({})), 'WON');
check('receptions over 4.5 at 5, live -> WON (only goes up)', ev('NFL_RECEPTIONS', 'OVER', 4.5, 5, live({})), 'WON');
check('spread, live -> LIVE whatever the margin', ev('NFL_SPREAD', 'TEAM', 3, 21, live({})), 'LIVE');
check('pregame -> PENDING', ev('NFL_RUSH_YARDS', 'OVER', 49.5, 0, live({ status: 'Preview' })), 'PENDING');
check('postponed -> VOID', ev('NFL_RUSH_YARDS', 'OVER', 49.5, 0, live({ status: 'Other' })), 'VOID');

console.log('\n  Clock and distributions:');
check('Q3 8:42 -> 39.5% of regulation left', remainingFraction(live({ period: 3, clock: '8:42' })), (900 + 522) / 3600, 0.0001);
check('halftime -> 50% left', remainingFraction(live({ period: 2, clock: '0:00' })), 0.5, 0.0001);
check('OT 5:00 -> own clock only', remainingFraction(live({ period: 5, clock: '5:00' })), 300 / 3600, 0.0001);
check('normCdf(1.96)', normCdf(1.96), 0.975, 0.001);
check('normInv(0.975)', normInv(0.975), 1.96, 0.001);
check('Poisson P(N<=0 | 1) = e^-1', poissonCdf(0, 1), Math.exp(-1), 1e-9);

const prob = async (betType: string, dir: string, line: number, value: number, snap: NflSnapshot, teamId: number | null = null) =>
  (await nflLegProbability({ betType, direction: dir, line, teamId, source: 'underdog', status: 'LIVE', athleteId: null },
    PROP_BY_KEY[betType]!, value, snap)).probability;

console.log('\n  Win probability vs hand-computed:');
const pre = live({ status: 'Preview', period: null, clock: null });
check('pregame SEA by 3+ when the market is SEA -3 -> coin flip', await prob('NFL_SPREAD', 'TEAM', 3, 0, pre, SEA), 0.5, 0.001);
check('pregame SEA ML = Phi(3/13.45)', await prob('NFL_MONEYLINE', 'TEAM', 0, 0, pre, SEA), normCdf(3 / 13.45), 0.001);
const half = live({ period: 2, clock: '0:00', homeWinProb: 0.8 });
check('halftime, ESPN 80% home -> SEA ML 80%', await prob('NFL_MONEYLINE', 'TEAM', 0, 0, half, SEA), 0.8, 0.001);
check('halftime, ESPN 80% home -> NE ML 20%', await prob('NFL_MONEYLINE', 'TEAM', 0, 0, half, NE), 0.2, 0.001);
check('halftime SEA by 3+ = Phi(z(.8) - 3/(13.45*sqrt(.5)))', await prob('NFL_SPREAD', 'TEAM', 3, 0, half, SEA),
  normCdf(normInv(0.8) - 3 / (13.45 * Math.sqrt(0.5))), 0.001);
check('pregame total over 44.5 at market 44.5 -> 50%', await prob('NFL_GAME_TOTAL', 'OVER', 44.5, 0, pre), 0.5, 0.001);
const half24 = live({ period: 2, clock: '0:00', homeScore: 14, awayScore: 10 });
check('halftime total 24, over 44.5', await prob('NFL_GAME_TOTAL', 'OVER', 44.5, 24, half24),
  1 - normCdf((44.5 - 24 - 44.5 * 0.5) / (13.5 * Math.sqrt(0.5))), 0.001);
check('no history, pregame yds over 69.5 -> line is the median', await prob('NFL_RUSH_YARDS', 'OVER', 69.5, 0, pre), 0.5, 0.001);
check('no history, pregame receptions over 4.5 = P(Poisson(4.5)>=5)', await prob('NFL_RECEPTIONS', 'OVER', 4.5, 0, pre),
  1 - poissonCdf(4, 4.5), 0.001);

// ---- first-quarter markets ----
console.log('\n  First quarter, graded off the linescore:');
// NE @ SEA opened 0-0, which is exactly how a quarter pushes.
check('0-0 opening quarter: SEA winner pushes', grade('NFL_1Q_WINNER', 'TEAM', 0, null, SEA).status, 'PUSH');
check('0-0 opening quarter: NE winner pushes', grade('NFL_1Q_WINNER', 'TEAM', 0, null, NE).status, 'PUSH');
check('0-0 opening quarter: SEA by 0.5+ loses', grade('NFL_1Q_SPREAD', 'TEAM', 0.5, null, SEA).status, 'LOST');
check('0-0 opening quarter: NE within 0.5 covers', grade('NFL_1Q_SPREAD', 'TEAM', -0.5, null, NE).status, 'WON');
check('0-0 opening quarter: Q1 total under 0.5', grade('NFL_1Q_TOTAL', 'UNDER', 0.5, null).status, 'WON');

// SF @ LAR, decided 3-0 in the first.
const q = extractNflSnapshot(await nflGetSummary(401872657));
const SF = q.awayTeamId, LAR = q.homeTeamId;
const gradeQ = (betType: string, dir: string, line: number, teamId: number | null) => {
  const value = nflValue(betType, EMPTY_NFL_LINE, q, teamId, 'underdog');
  return { value, status: evaluateNflLeg({ betType, direction: dir, line }, PROP_BY_KEY[betType]!, value, q).status };
};
check(`${q.awayAbbrev} @ ${q.homeAbbrev}: Q1 scoring is 3 points`, gradeQ('NFL_1Q_TOTAL', 'OVER', 2.5, null).value, 3);
check('SF takes the first quarter 3-0', gradeQ('NFL_1Q_WINNER', 'TEAM', 0, SF).status, 'WON');
check('LAR loses the first quarter', gradeQ('NFL_1Q_WINNER', 'TEAM', 0, LAR).status, 'LOST');
check('LAR within 3 in Q1, lost it by 3 -> push', gradeQ('NFL_1Q_SPREAD', 'TEAM', -3, LAR).status, 'PUSH');
check('LAR within 3.5 in Q1 covers', gradeQ('NFL_1Q_SPREAD', 'TEAM', -3.5, LAR).status, 'WON');
check('Q1 total over 3.5 loses', gradeQ('NFL_1Q_TOTAL', 'OVER', 3.5, null).status, 'LOST');

// Live: the quarter grades when the quarter ends, not at the final whistle.
const inQ1 = live({ period: 1, clock: '4:00', homeScore: 7, awayScore: 0, homeLinescores: null, awayLinescores: null });
const inQ2 = live({ period: 2, clock: '9:00', homeScore: 14, awayScore: 7, homeLinescores: '[7,7]', awayLinescores: '[0,7]' });
const q1Value = (betType: string, snap: NflSnapshot, teamId: number | null = null) =>
  nflValue(betType, EMPTY_NFL_LINE, snap, teamId, 'underdog');
check('mid-Q1 with no linescore yet, the score is the quarter', q1Value('NFL_1Q_TOTAL', inQ1), 7);
check('mid-Q1 the winner is still open', ev('NFL_1Q_WINNER', 'TEAM', 0, 7, inQ1), 'LIVE');
check('in Q2 the first quarter is settled', ev('NFL_1Q_WINNER', 'TEAM', 0, 7, inQ2), 'WON');
check('in Q2 the full-game spread is still live', ev('NFL_SPREAD', 'TEAM', 3, 7, inQ2), 'LIVE');
check('Q2 linescore reads back the Q1 margin', q1Value('NFL_1Q_WINNER', inQ2, SEA), 7);

console.log('\n  First-quarter probability:');
const pSEA = await prob('NFL_1Q_WINNER', 'TEAM', 0, 0, pre, SEA);
const pNE = await prob('NFL_1Q_WINNER', 'TEAM', 0, 0, pre, NE);
check('the market favourite wins Q1 more often', pSEA > pNE, true);
check('a first quarter ends tied about a fifth of the time', 1 - pSEA - pNE, 0.22, 0.07);
const pk = live({ status: 'Preview', period: null, clock: null, marketSpread: 0 });
check("pick'em: both sides of Q1 are equal", await prob('NFL_1Q_WINNER', 'TEAM', 0, 0, pk, SEA)
  - await prob('NFL_1Q_WINNER', 'TEAM', 0, 0, pk, NE), 0, 0.0001);
check('Q1 total over + under = 1 on a half point', await prob('NFL_1Q_TOTAL', 'OVER', 9.5, 0, pre)
  + await prob('NFL_1Q_TOTAL', 'UNDER', 9.5, 0, pre), 1, 0.001);
check('once Q1 is over the winner is settled at 100%', await prob('NFL_1Q_WINNER', 'TEAM', 0, 7, inQ2, SEA), 1, 0.0001);

console.log('\n  Same-game correlation:');
const cleg = (o: Partial<CorrelatedLeg>): CorrelatedLeg => ({
  id: 'leg', probability: 0.5, betType: 'NFL_SPREAD', direction: 'TEAM',
  gameKey: 'nfl:1', teamId: SEA, playerKey: null, homeTeamId: SEA, awayTeamId: NE, ...o,
});
const pair = (a: Partial<CorrelatedLeg>, b: Partial<CorrelatedLeg>) =>
  correlatedParlayProbability([cleg({ id: 'a', ...a }), cleg({ id: 'b', ...b })]);
check('legs in different games multiply exactly',
  pair({ probability: 0.5 }, { probability: 0.4, gameKey: 'nfl:2' }), 0.2, 1e-9);
check('a certain partner leaves the other leg where it was',
  pair({ probability: 0.45 }, { probability: 1, betType: 'NFL_MONEYLINE' }), 0.45, 0.015);
const sameSide = pair({ probability: 0.6 }, { probability: 0.6, betType: 'NFL_1Q_WINNER' });
check('same team, spread + 1st quarter, beats the product', sameSide > 0.36, true);
check('...but never beats its own weakest leg', sameSide <= 0.6, true);
check('opposite sides of one game fall below the product',
  pair({ probability: 0.6 }, { probability: 0.5, betType: 'NFL_MONEYLINE', teamId: NE }) < 0.3, true);
check('a quarterback and his receiver beat the product',
  pair({ probability: 0.5, betType: 'NFL_PASS_YARDS', direction: 'OVER', playerKey: 'nfl:1' },
       { probability: 0.4, betType: 'NFL_REC_YARDS', direction: 'OVER', playerKey: 'nfl:2' }) > 0.2, true);
check('an under on a correlated stat pulls the other way',
  pair({ probability: 0.5, betType: 'NFL_PASS_YARDS', direction: 'OVER', playerKey: 'nfl:1' },
       { probability: 0.4, betType: 'NFL_REC_YARDS', direction: 'UNDER', playerKey: 'nfl:2' }) < 0.2, true);
check('the same slip prices the same twice running',
  pair({ probability: 0.6 }, { probability: 0.6, betType: 'NFL_1Q_WINNER' }) === sameSide, true);

console.log('\n  Spread wording matches how it grades:');
check('+2.5 reads as winning by 2.5+', spreadRequirement(2.5), 'Win by 2.5+');
check('-2.5 reads as the cushion', spreadRequirement(-2.5), 'Win or lose by <2.5');
check('+3 needs 4, since 3 pushes', spreadRequirement(3), 'Win by 4+');
check('0 is a pick', spreadRequirement(0), 'Win outright');
check('the wording and the grade agree: +2.5 wins on a 3-point win',
  grade('NFL_SPREAD', 'TEAM', 2.5, null, SEA).status === 'WON' && spreadRequirement(2.5) === 'Win by 2.5+', true);

console.log('\n  Player search:');
check('"matt" fits Matthew', firstNameMatches('matt', ['Matthew']), true);
check('"matthew" fits Matt', firstNameMatches('matthew', ['Matt']), true);
check('"michael" fits Mike', firstNameMatches('michael', ['Mike']), true);
check('partial "mik" fits Michael', firstNameMatches('mik', ['Michael']), true);
check('"tj" fits T.J., "jose" fits José', firstNameMatches('tj', ['T.J.']) && firstNameMatches('jose', ['José']), true);
check('"matt" does not fit Mike', firstNameMatches('matt', ['Mike']), false);
check('"tom" does not fit Tony', firstNameMatches('tom', ['Tony']), false);
check('"matt stafford" splits off the surname', splitName('matt stafford')?.surname, 'stafford');
check('no surname search for "stafford" or "matt s"', splitName('stafford') ?? splitName('matt s'), null);
const found = (await nflSearchPlayers('matt stafford')).map((p) => p.fullName);
check('ESPN search "matt stafford" finds Matthew Stafford', found.includes('Matthew Stafford'), true);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
