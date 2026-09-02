import type { Parlay, PropDef } from '../lib/types';
import { ParlayCard } from './ParlayCard';
import { money, profitFor } from '../lib/format';

/** Default screen: one wide card per slip, stacked. */
export function LiveBets({
  parlays, props, onRemoveParlay, onRemoveLeg, onUpdated, onAddBet,
}: {
  parlays: Parlay[];
  props: Map<string, PropDef>;
  onRemoveParlay: (id: string) => void;
  onRemoveLeg: (parlayId: string, betId: string) => void;
  onUpdated: (parlay: Parlay) => void;
  onAddBet: () => void;
}) {
  if (parlays.length === 0) {
    return (
      <div className="empty">
        <h3>No bets tracked yet</h3>
        <p>Add a slip and this screen keeps itself up to date — no refreshing.</p>
        <button className="btn primary big" onClick={onAddBet}>+ ADD BET</button>
      </div>
    );
  }

  const live = parlays.filter((p) => p.status === 'LIVE' || p.status === 'PENDING');
  const staked = parlays.reduce((s, p) => s + (p.stake ?? 0), 0);
  const toWin = parlays.reduce(
    (s, p) => s + (p.stake != null && p.odds != null ? profitFor(p.stake, p.odds) : 0), 0,
  );

  /**
   * Headline number for a slip is the SLIP's chance, so a 3-leg parlay reads
   * as its parlay odds rather than any single leg's. Averaged across open
   * slips for the summary row.
   */
  const openWithOdds = live.filter((p) => p.winProbability != null);
  const avgChance = openWithOdds.length > 0
    ? openWithOdds.reduce((s, p) => s + (p.winProbability ?? 0), 0) / openWithOdds.length
    : null;

  const rank = (p: Parlay) =>
    p.status === 'LIVE' ? 0 : p.status === 'PENDING' ? 1 : p.status === 'WON' ? 2 : 3;
  const sorted = [...parlays].sort(
    (a, b) => rank(a) - rank(b) || (b.winProbability ?? 0) - (a.winProbability ?? 0),
  );

  return (
    <div>
      <div className="summary-row">
        <div className="box"><div className="k">SLIPS</div><div className="v">{parlays.length}</div></div>
        <div className="box"><div className="k">HIT</div><div className="v win">{parlays.filter((p) => p.status === 'WON').length}</div></div>
        <div className="box"><div className="k">MISSED</div><div className="v lose">{parlays.filter((p) => p.status === 'LOST').length}</div></div>
        {avgChance != null && (
          <div className="box">
            <div className="k">AVG CHANCE</div>
            <div className="v">{Math.round(avgChance * 100)}%</div>
          </div>
        )}
        {staked > 0 && <div className="box"><div className="k">AT RISK</div><div className="v">{money(staked)}</div></div>}
        {toWin > 0 && <div className="box"><div className="k">TO WIN</div><div className="v win">{money(toWin)}</div></div>}
      </div>

      <div className="parlay-list">
        {sorted.map((p) => (
          <ParlayCard
            key={p.id}
            parlay={p}
            props={props}
            onRemoveParlay={onRemoveParlay}
            onRemoveLeg={onRemoveLeg}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </div>
  );
}
