/**
 * Check the NFL extractor against ESPN's raw box score for a real game.
 * Usage: npm run nfl-boxscore -- <eventId>
 */
import { nflGetSummary } from '../server/nfl/espnApi.js';
import { extractNflSnapshot, extractNflLine } from '../server/nfl/stats.js';

const eid = Number(process.argv[2] ?? 401872656);
const summary = await nflGetSummary(eid);
const s = extractNflSnapshot(summary);
console.log(`\n  ${s.awayAbbrev} ${s.awayScore} @ ${s.homeAbbrev} ${s.homeScore} [${s.status}] period=${s.period} market O/U=${s.marketTotal} spread(home)=${s.marketSpread} homeWinProb=${s.homeWinProb}`);
console.log(`  linescores: ${s.awayAbbrev} ${s.awayLinescores}  ${s.homeAbbrev} ${s.homeLinescores}\n`);

const want: Record<string, (l: ReturnType<typeof extractNflLine>) => string> = {
  passing:   (l) => `${l.passing.completions}/${l.passing.attempts}, ${l.passing.yards} yds, ${l.passing.touchdowns} TD, ${l.passing.interceptions} INT, ${l.passing.sacks} sk`,
  rushing:   (l) => `${l.rushing.attempts} car, ${l.rushing.yards} yds, ${l.rushing.touchdowns} TD, long ${l.rushing.long}`,
  receiving: (l) => `${l.receiving.receptions} rec (${l.receiving.targets} tgt), ${l.receiving.yards} yds, ${l.receiving.touchdowns} TD, long ${l.receiving.long}`,
  kicking:   (l) => `FG ${l.kicking.fgMade}/${l.kicking.fgAttempts}, XP ${l.kicking.xpMade}/${l.kicking.xpAttempts}, ${l.kicking.points} pts`,
  defensive: (l) => `${l.defense.tackles} tkl, ${l.defense.sacks} sk, ${l.defense.passesDefended} PD`,
};

let checked = 0;
for (const team of summary.boxscore.players) {
  for (const cat of team.statistics) {
    if (!want[cat.name] || !cat.athletes?.length) continue;
    const a = cat.athletes[0];
    const line = extractNflLine(summary, Number(a.athlete.id));
    console.log(`  ${team.team.abbreviation.padEnd(4)} ${cat.name.padEnd(10)} ${a.athlete.displayName.padEnd(22)}`);
    console.log(`       raw:       ${cat.labels.map((l: string, i: number) => `${l}=${a.stats[i]}`).join('  ')}`);
    console.log(`       extracted: ${want[cat.name](line)}`);
    checked++;
  }
}
console.log(`\n  ${checked} rows compared`);
