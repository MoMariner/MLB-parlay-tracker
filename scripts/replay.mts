/** Run the real extractor/evaluator against a REAL mid-game MLB feed. */
import { extractGameSnapshot, extractPlayerState } from '../server/services/statExtractor.js';
import { evaluateBet } from '../server/services/propEvaluator.js';

const TC = process.argv[2];
const url = `https://statsapi.mlb.com/api/v1.1/game/823982/feed/live?timecode=${TC}`;
const feed = await (await fetch(url)).json();
const snap = extractGameSnapshot(feed);

console.log(`\n  ${snap.awayAbbrev} ${snap.awayScore} — ${snap.homeAbbrev} ${snap.homeScore}  |  ${snap.inningState} ${snap.inning}, ${snap.outs} out  [${snap.status}]`);

const off = feed.liveData.linescore.offense;
console.log(`  MLB says: batter=${off.batter?.fullName}  onDeck=${off.onDeck?.fullName}  inHole=${off.inHole?.fullName}  slot=${off.battingOrder}\n`);

const box = feed.liveData.boxscore.teams;
const side = off.team?.id === box.away.team.id ? 'away' : 'home';
const order: number[] = box[side].battingOrder;

console.log('  Our extractor, for the whole batting order:');
for (const pid of order) {
  const st = extractPlayerState(feed, pid, snap);
  const name = box[side].players[`ID${pid}`].person.fullName;
  const ev = evaluateBet({ betType: 'HITS', source: 'manual', direction: 'OVER', line: 0.5 }, st, snap);
  console.log(
    `    ${name.padEnd(20)} ${st.battingStatus.label.padEnd(22)} ` +
    `H=${st.batting.hits} TB=${st.batting.totalBases} H+R+RBI=${st.batting.hitsRunsRbis}  ` +
    `[o0.5 hits -> ${ev.status}]`,
  );
}
