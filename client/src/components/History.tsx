import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Parlay, PropDef } from '../lib/types';
import { money, num, profitFor } from '../lib/format';

/** Settled slips, newest first. */
export function History({ props }: { props: Map<string, PropDef> }) {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listParlays('settled')
      .then(({ parlays }) => setParlays(parlays))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--muted)' }}><span className="spinner" /> Loading history…</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (parlays.length === 0) {
    return <div className="empty"><h3>No settled slips yet</h3><p>Slips move here once every leg is decided.</p></div>;
  }

  const won = parlays.filter((p) => p.status === 'WON');
  const lost = parlays.filter((p) => p.status === 'LOST');
  const net = parlays.reduce((sum, p) => {
    if (p.stake == null || p.odds == null) return sum;
    if (p.status === 'WON') return sum + profitFor(p.stake, p.odds);
    if (p.status === 'LOST') return sum - p.stake;
    return sum;
  }, 0);
  const decided = won.length + lost.length;

  return (
    <div>
      <h1 className="h1">HISTORY</h1>
      <p className="sub">{parlays.length} settled slip{parlays.length === 1 ? '' : 's'}.</p>

      <div className="summary-row">
        <div className="box"><div className="k">WON</div><div className="v win">{won.length}</div></div>
        <div className="box"><div className="k">LOST</div><div className="v lose">{lost.length}</div></div>
        <div className="box">
          <div className="k">WIN RATE</div>
          <div className="v">{decided > 0 ? `${Math.round((won.length / decided) * 100)}%` : '—'}</div>
        </div>
        <div className="box">
          <div className="k">NET</div>
          <div className={`v ${net >= 0 ? 'win' : 'lose'}`}>{net >= 0 ? '+' : '−'}{money(Math.abs(net))}</div>
        </div>
      </div>

      <div className="parlay-list">
        {parlays.map((p) => (
          <div className={`parlay ${p.status.toLowerCase()}`} key={p.id}>
            <header className="parlay-head">
              <div className="parlay-id">
                <div className="parlay-name">{p.name || (p.bets.length === 1 ? 'Single' : `${p.bets.length}-Leg Parlay`)}</div>
                <div className="parlay-meta">
                  <span className={`chip ${p.status}`}>{p.status}</span>
                  {p.source !== 'manual' && <span className="chip src">{p.source.toUpperCase()}</span>}
                  <span className="legs-count">
                    {new Date(p.settledAt ?? p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
              {p.stake != null && p.odds != null && (
                <div className="parlay-money" style={{ marginLeft: 'auto' }}>
                  <div><span className="k">STAKE</span><span className="v">{money(p.stake)}</span></div>
                  <div>
                    <span className="k">P/L</span>
                    <span className="v" style={{ color: p.status === 'WON' ? 'var(--win)' : 'var(--lose)' }}>
                      {p.status === 'WON' ? `+${money(profitFor(p.stake, p.odds))}` : `−${money(p.stake)}`}
                    </span>
                  </div>
                </div>
              )}
            </header>
            <div className="legs">
              {p.bets.map((b) => (
                <div className={`leg ${b.status.toLowerCase()}`} key={b.id} style={{ gridTemplateColumns: '1.2fr 1.6fr 80px' }}>
                  <div className="leg-who"><div className="leg-name">{b.player.fullName}</div></div>
                  <div className="leg-bet">
                    <span className={b.direction === 'OVER' ? 'over' : 'under'}>
                      {b.direction === 'OVER' ? 'Over' : 'Under'}
                    </span>{' '}
                    <b>{num(b.line)}</b> {props.get(b.betType)?.label ?? b.betType}
                    <span style={{ color: 'var(--muted)', marginLeft: 10 }}>finished {num(b.currentValue)}</span>
                  </div>
                  <div className="leg-pct">
                    <span className={`leg-result ${b.status}`}>
                      {b.status === 'WON' ? 'HIT' : b.status === 'LOST' ? 'MISS' : b.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
