/** Sanity-check the expected-batting-inning projection across a live lineup. */
import { extractGameSnapshot, extractBattingStatus } from '../server/services/statExtractor.js';

const pk = process.argv[2];
const feed = await (await fetch(`https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`)).json();
const snap = extractGameSnapshot(feed);
const ls = feed.liveData.linescore;

console.log(`\n  ${snap.awayAbbrev} ${snap.awayScore} — ${snap.homeAbbrev} ${snap.homeScore} · ${ls.inningState} ${ls.currentInning}, ${ls.outs} out`);
console.log(`  batting now: ${ls.offense?.team?.name} (slot ${ls.offense?.battingOrder})\n`);

for (const side of ['away', 'home'] as const) {
  const t = feed.liveData.boxscore.teams[side];
  console.log(`  --- ${t.team.name} (${side}) ---`);
  for (const pid of t.battingOrder ?? []) {
    const st = extractBattingStatus(feed, pid, snap);
    const due = st.expectedInning ? `${st.expectedHalf} of ${st.expectedInning}` : '—';
    console.log(`    ${t.players[`ID${pid}`].person.fullName.padEnd(20)} ${st.label.padEnd(22)} due: ${due}`);
  }
}
