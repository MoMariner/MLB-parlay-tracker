/**
 * How much longer is this pitcher likely to stay in?
 *
 * A prop on strikeouts or outs recorded lives or dies on whether the starter
 * gets another inning, so the card needs more than the current line -- it
 * needs a read on the hook. That read comes from the pitcher's own recent
 * workload: the last 10 appearances give a personal baseline for outs and
 * pitches per outing, which live pitch count and runs allowed then adjust.
 *
 * Approximate by design. A manager's actual decision depends on the bullpen,
 * the score and the matchup, none of which the stats API exposes.
 */

const BASE = 'https://statsapi.mlb.com/api';
const TTL_MS = 60 * 60 * 1000;
const RECENT_GAMES = 10;

export interface WorkloadBaseline {
  /** Appearances the baseline is built from. */
  sample: number;
  starter: boolean;
  avgOuts: number;
  avgPitches: number;
  /** Longest outing in the sample -- roughly their ceiling. */
  maxPitches: number;
  avgEarnedRuns: number;
}

export interface WorkloadProjection {
  baseline: WorkloadBaseline | null;
  /** Outs they're projected to still record. */
  moreOuts: number;
  moreInnings: number;
  /** Short human summary for the card. */
  note: string;
  /** True when live results suggest an early hook. */
  shortLeash: boolean;
}

interface Entry { at: number; value: WorkloadBaseline | null }
const cache = new Map<number, Entry>();

function currentSeason(): number {
  const d = new Date();
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

export async function getWorkloadBaseline(playerId: number): Promise<WorkloadBaseline | null> {
  if (playerId < 0) return null; // demo pitcher
  const hit = cache.get(playerId);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.value;

  try {
    const res = await fetch(
      `${BASE}/v1/people/${playerId}/stats?stats=gameLog&group=pitching&season=${currentSeason()}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'mlb-bet-tracker/1.0' } },
    );
    if (!res.ok) { cache.set(playerId, { at: now, value: null }); return null; }
    const data: any = await res.json();
    const splits: any[] = data?.stats?.[0]?.splits ?? [];
    if (splits.length === 0) { cache.set(playerId, { at: now, value: null }); return null; }

    const recent = splits.slice(-RECENT_GAMES);
    const starts = recent.filter((g) => Number(g.stat?.gamesStarted ?? 0) > 0);
    // Compare like with like: a starter's baseline uses only his starts.
    const sample = starts.length >= 3 ? starts : recent;

    const outs = sample.map((g) => Number(g.stat?.outs ?? 0));
    const pitches = sample.map((g) => Number(g.stat?.numberOfPitches ?? 0)).filter((n) => n > 0);
    const ers = sample.map((g) => Number(g.stat?.earnedRuns ?? 0));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

    const value: WorkloadBaseline = {
      sample: sample.length,
      starter: starts.length >= 3,
      avgOuts: mean(outs),
      avgPitches: pitches.length ? mean(pitches) : 0,
      maxPitches: pitches.length ? Math.max(...pitches) : 0,
      avgEarnedRuns: mean(ers),
    };
    cache.set(playerId, { at: now, value });
    return value;
  } catch {
    cache.set(playerId, { at: now, value: null });
    return null;
  }
}

/**
 * Blend two independent limits -- innings and pitch count -- and take the
 * tighter one, since whichever arrives first ends the outing.
 */
export async function projectWorkload(
  playerId: number,
  live: { outs: number; pitches: number; earnedRuns: number },
  gameIsLive: boolean,
): Promise<WorkloadProjection> {
  const baseline = await getWorkloadBaseline(playerId);

  if (!gameIsLive) {
    return { baseline, moreOuts: 0, moreInnings: 0, note: '', shortLeash: false };
  }
  if (!baseline || baseline.sample < 2) {
    return {
      baseline, moreOuts: 0, moreInnings: 0, shortLeash: false,
      note: 'No recent workload history for this pitcher.',
    };
  }

  const pitchesPerOut = baseline.avgOuts > 0 && baseline.avgPitches > 0
    ? baseline.avgPitches / baseline.avgOuts
    : 5.4;

  const byOuts = baseline.avgOuts - live.outs;
  // Managers push past the average pitch count more readily than past the
  // ceiling, so the pitch limit sits between the two.
  const pitchCeiling = baseline.maxPitches > 0
    ? (baseline.avgPitches + baseline.maxPitches) / 2
    : baseline.avgPitches;
  const byPitches = (pitchCeiling - live.pitches) / pitchesPerOut;

  let moreOuts = Math.max(0, Math.min(byOuts, byPitches));

  // Getting hit harder than usual shortens the leash.
  const erOver = live.earnedRuns - baseline.avgEarnedRuns;
  const shortLeash = erOver >= 2;
  if (shortLeash) moreOuts *= 0.5;
  else if (erOver >= 1) moreOuts *= 0.8;

  moreOuts = Math.round(moreOuts);
  const moreInnings = Math.round((moreOuts / 3) * 10) / 10;

  const avgIp = Math.round((baseline.avgOuts / 3) * 10) / 10;
  const parts = [
    `Averages ${avgIp} IP and ${Math.round(baseline.avgPitches)} pitches over his last ${baseline.sample}`,
  ];
  if (shortLeash) parts.push('running hot on runs, so an early hook is likely');

  return { baseline, moreOuts, moreInnings, note: parts.join(' — '), shortLeash };
}
