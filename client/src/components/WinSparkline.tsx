import type { ParlayPoint } from '../lib/types';

/**
 * A thin trace of where the slip's chance has been, sitting beside the number
 * itself. The point isn't precision -- it's whether the bet is drifting toward
 * you or away, and what caused the last move.
 */
export function WinSparkline({
  history, current, settled,
}: { history: ParlayPoint[]; current: number | null; settled: boolean }) {
  const points = history.filter((h) => Number.isFinite(h.probability));
  if (points.length < 2 || current == null) return null;

  const W = 150;
  const H = 32;
  const values = points.map((p) => p.probability);

  // Scale to the range actually travelled, with a floor so a nearly flat line
  // doesn't get amplified into fake drama.
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.06);
  const mid = (max + min) / 2;
  const lo = mid - span / 2;

  const x = (i: number) => (i / (points.length - 1)) * (W - 2) + 1;
  const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4);

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;

  const previous = values[values.length - 2];
  const delta = current - previous;
  const dir = delta > 0.0005 ? 'up' : delta < -0.0005 ? 'down' : 'flat';
  const stroke = settled ? 'var(--muted)' : dir === 'up' ? 'var(--win)' : dir === 'down' ? 'var(--lose)' : 'var(--muted)';

  const last = points[points.length - 1];
  const reason = last?.reason ?? '';
  // A move from 12% to 10% shows as 2.0% -- the change in the number itself.
  const deltaPts = Math.abs(delta * 100);
  const sinceStart = (current - values[0]) * 100;

  return (
    <div className="spark">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Win chance trend, ${dir === 'up' ? 'rising' : dir === 'down' ? 'falling' : 'flat'}`}>
        <path d={area} fill={stroke} opacity="0.13" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(values.length - 1)} cy={y(current)} r="2.4" fill={stroke} />
      </svg>

      {!settled && (
        <div className="spark-meta">
          <span className={`spark-delta ${dir}`}>
            {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·'}
            {deltaPts >= 0.05 ? deltaPts.toFixed(1) : '0.0'}%
          </span>
          {Math.abs(sinceStart) >= 0.1 && (
            <span className="spark-total" title="Change since the slip was added">
              {sinceStart > 0 ? '+' : '−'}{Math.abs(sinceStart).toFixed(1)}% overall
            </span>
          )}
          {reason && <span className="spark-why" title={reason}>{reason}</span>}
        </div>
      )}
    </div>
  );
}
