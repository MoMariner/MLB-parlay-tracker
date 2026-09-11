/**
 * NFL settlement and win-probability checks: real finals graded against
 * their box scores, and the probability model against hand-computed values.
 * Usage: npm run nfl-verify
 */
import { nflGetSummary } from '../server/nfl/espnApi.js';
import { extractNflSnapshot, extractNflLine, EMPTY_NFL_LINE, type NflSnapshot } from '../server/nfl/stats.js';
import { nflValue, evaluateNflLeg } from '../server/nfl/evaluator.js';
import { nflLegProbability, remainingFraction, normCdf, normInv, poissonCdf } from '../server/nfl/winProbability.js';
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
g = grade('NFL_SPREAD', 'TEAM', -3, null, SEA);                              check('SEA -3, won by 3 -> push', g.status, 'PUSH');
g = grade('NFL_SPREAD', 'TEAM', -2.5, null, SEA);                            check('SEA -2.5 covers', g.status, 'WON');
g = grade('NFL_SPREAD', 'TEAM', 3.5, null, NE);                              check('NE +3.5 covers', g.status, 'WON');
g = grade('NFL_SPREAD', 'TEAM', 2.5, null, NE);                              check('NE +2.5 loses', g.status, 'LOST');
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
check('rec yds over 49.5 at 60, live -> stays LIVE (can drop)', ev('NFL_REC_YARDS', 'OVER', 49.5, 60, live({})), 'LIVE');
check('receptions over 4.5 at 5, live -> WON (only goes up)', ev('NFL_RECEPTIONS', 'OVER', 4.5, 5, live({})), 'WON');
check('spread, live -> LIVE whatever the margin', ev('NFL_SPREAD', 'TEAM', -3, 21, live({})), 'LIVE');
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
check('pregame SEA -3 when market is SEA -3 -> coin flip', await prob('NFL_SPREAD', 'TEAM', -3, 0, pre, SEA), 0.5, 0.001);
check('pregame SEA ML = Phi(3/13.45)', await prob('NFL_MONEYLINE', 'TEAM', 0, 0, pre, SEA), normCdf(3 / 13.45), 0.001);
const half = live({ period: 2, clock: '0:00', homeWinProb: 0.8 });
check('halftime, ESPN 80% home -> SEA ML 80%', await prob('NFL_MONEYLINE', 'TEAM', 0, 0, half, SEA), 0.8, 0.001);
check('halftime, ESPN 80% home -> NE ML 20%', await prob('NFL_MONEYLINE', 'TEAM', 0, 0, half, NE), 0.2, 0.001);
check('halftime SEA -3 = Phi(z(.8) - 3/(13.45*sqrt(.5)))', await prob('NFL_SPREAD', 'TEAM', -3, 0, half, SEA),
  normCdf(normInv(0.8) - 3 / (13.45 * Math.sqrt(0.5))), 0.001);
check('pregame total over 44.5 at market 44.5 -> 50%', await prob('NFL_GAME_TOTAL', 'OVER', 44.5, 0, pre), 0.5, 0.001);
const half24 = live({ period: 2, clock: '0:00', homeScore: 14, awayScore: 10 });
check('halftime total 24, over 44.5', await prob('NFL_GAME_TOTAL', 'OVER', 44.5, 24, half24),
  1 - normCdf((44.5 - 24 - 44.5 * 0.5) / (13.5 * Math.sqrt(0.5))), 0.001);
check('no history, pregame yds over 69.5 -> line is the median', await prob('NFL_RUSH_YARDS', 'OVER', 69.5, 0, pre), 0.5, 0.001);
check('no history, pregame receptions over 4.5 = P(Poisson(4.5)>=5)', await prob('NFL_RECEPTIONS', 'OVER', 4.5, 0, pre),
  1 - poissonCdf(4, 4.5), 0.001);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
