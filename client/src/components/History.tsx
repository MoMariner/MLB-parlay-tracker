import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Parlay, PropDef } from '../lib/types';
import { money, num, slipProfit } from '../lib/format';
import { describeLeg } from '../lib/nfl';
import { BetText } from './BetText';

/** Settled slips, newest first, across sports. */
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

  /**
   * Profit or loss on a settled slip. An entered payout counts, not just
   * American odds -- most slips here carry a book's quoted payout instead.
   */
  const pl = (p: Parlay): number | null => {
    if (p.status === 'LOST') return p.stake != null ? -p.stake : null;
    if (p.status === 'WON') return slipProfit(p.stake, p.odds, p.payout);
    return p.stake != null ? 0 : null;
  };
  const net = parlays.reduce((sum, p) => sum + (pl(p) ?? 0), 0);
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
        {parlays.map((p) => {
          const result = pl(p);
          return (
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
                {p.stake != null && (
                  <div className="parlay-money" style={{ marginLeft: 'auto' }}>
                    <div><span className="k">STAKE</span><span className="v">{money(p.stake)}</span></div>
                    {result != null && (
                      <div>
                        <span className="k">P/L</span>
                        <span className="v" style={{ color: result >= 0 ? 'var(--win)' : 'var(--lose)' }}>
                          {result >= 0 ? '+' : '−'}{money(Math.abs(result))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </header>
              <div className="legs">
                {p.bets.map((b) => {
                  const prop = props.get(b.betType);
                  const t = describeLeg(prop, b, b.game);
                  const who = b.player?.fullName ?? `${b.game.awayAbbrev} @ ${b.game.homeAbbrev}`;
                  const finished = prop?.sides === 'team'
                    ? `margin ${b.currentValue > 0 ? '+' : ''}${num(b.currentValue)}`
                    : `finished ${num(b.currentValue)}`;
                  return (
                    <div className={`hist-leg ${b.status.toLowerCase()}`} key={b.id}>
                      <div className="hl-who">{b.sport === 'nfl' ? '🏈' : '⚾'} {who}</div>
                      <div className="hl-bet">
                        <BetText text={t} />
                        <span className="hl-final">{finished}</span>
                      </div>
                      <div className="hl-res">
                        <span className={`leg-result ${b.status}`}>
                          {b.status === 'WON' ? 'HIT' : b.status === 'LOST' ? 'MISS' : b.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
