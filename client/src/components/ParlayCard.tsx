import { useState } from 'react';
import type { Parlay, PropDef, StatsSnapshot, Bet, NflLine } from '../lib/types';
import { PlayerPhoto } from './PlayerPhoto';
import { api } from '../lib/api';
import { BATTING_STATUS_META, battingStatusLabel, money, num, slipPayout, slipProfit } from '../lib/format';
import { GameSituation, FieldState } from './GameSituation';
import { WinSparkline } from './WinSparkline';
import {
  describeLeg, fieldStatusMeta, linescoreChips, marginNote, nflChips, paceUnit, signed, teamLogoFor,
} from '../lib/nfl';
import { BetText } from './BetText';

/**
 * One slip = one wide horizontal card, every leg a row with its own progress
 * bar and live win %. Beats a grid of loose per-player cards when you're
 * tracking a slip across several games at once.
 */
export function ParlayCard({
  parlay, props, onRemoveParlay, onRemoveLeg, onUpdated,
}: {
  parlay: Parlay;
  props: Map<string, PropDef>;
  onRemoveParlay: (id: string) => void;
  onRemoveLeg: (parlayId: string, betId: string) => void;
  onUpdated: (parlay: Parlay) => void;
}) {
  const [editing, setEditing] = useState(false);
  const legs = parlay.bets;
  const single = legs.length === 1;
  const settled = ['WON', 'LOST', 'PUSH'].includes(parlay.status);

  const hit = legs.filter((b) => b.status === 'WON').length;
  const dead = legs.filter((b) => b.status === 'LOST').length;

  // The headline number is the SLIP's chance, not any one leg's.
  const pct = parlay.winProbability != null ? Math.round(parlay.winProbability * 1000) / 10 : null;
  // Legs on one game rise and fall together, so the slip is worth more than
  // its legs multiplied -- worth saying, because the number no longer
  // multiplies out on the card.
  const sameGame = legs.length > 1 && new Set(legs.map((b) => b.gameKey)).size < legs.length;

  const profit = slipProfit(parlay.stake, parlay.odds, parlay.payout);
  const totalReturn = slipPayout(parlay.stake, parlay.odds, parlay.payout);

  return (
    <article className={`parlay ${parlay.status.toLowerCase()}`}>
      <header className="parlay-head">
        <div className="parlay-id">
          <div className="parlay-name">
            {parlay.name || (single ? 'Single' : `${legs.length}-Leg Parlay`)}
          </div>
          <div className="parlay-meta">
            <span className={`chip ${parlay.status}`}>{parlay.status}</span>
            {parlay.source !== 'manual' && <span className="chip src">{parlay.source.toUpperCase()}</span>}
            <span className="legs-count">
              {single ? '1 leg' : `${hit} of ${legs.length} hit`}
              {dead > 0 && !single ? ` · ${dead} missed` : ''}
            </span>
          </div>
        </div>

        <div className="parlay-trend">
          <WinSparkline
            history={parlay.history ?? []}
            current={parlay.winProbability}
            settled={settled}
          />
          <div className="parlay-odds">
            <div className="k">{settled ? 'RESULT' : 'CHANCE TO WIN'}</div>
            <div className={`win-pct ${pctTone(parlay.status, pct)}`}>
              {settled ? parlay.status : pct != null ? `${pct}%` : '—'}
            </div>
            {!settled && sameGame && <div className="corr-note">SAME GAME · CORRELATED</div>}
          </div>
        </div>

        <div className="parlay-money">
          <div>
            <span className="k">STAKE</span>
            <span className="v">{parlay.stake != null ? money(parlay.stake) : '—'}</span>
          </div>
          <div>
            <span className="k">{parlay.status === 'WON' ? 'PAID' : 'PAYOUT'}</span>
            <span className={`v${totalReturn != null ? ' win' : ''}`}>
              {totalReturn != null ? money(totalReturn) : '—'}
            </span>
          </div>
          {profit != null && (
            <div>
              <span className="k">PROFIT</span>
              <span className="v win">{money(profit)}</span>
            </div>
          )}
        </div>

        <button
          className="parlay-edit"
          title="Edit stake and payout"
          aria-label="Edit stake and payout"
          onClick={() => setEditing((v) => !v)}
        >{editing ? 'CLOSE' : 'EDIT'}</button>
        <button className="parlay-rm" title="Remove slip" onClick={() => onRemoveParlay(parlay.id)}>×</button>
      </header>

      {editing && (
        <MoneyEditor
          parlay={parlay}
          onDone={(p) => { setEditing(false); if (p) onUpdated(p); }}
        />
      )}

      <div className="legs">
        {legs.map((leg) => (
          <LegRow
            key={leg.id}
            leg={leg}
            prop={props.get(leg.betType)}
            showRemove={!single}
            onRemove={() => onRemoveLeg(parlay.id, leg.id)}
          />
        ))}
      </div>
    </article>
  );
}

/** Inline stake/payout editor, opened by the card's EDIT button. */
function MoneyEditor({ parlay, onDone }: { parlay: Parlay; onDone: (p: Parlay | null) => void }) {
  const [stake, setStake] = useState(parlay.stake != null ? String(parlay.stake) : '');
  const [payout, setPayout] = useState(
    parlay.payout != null ? String(parlay.payout)
      : slipPayout(parlay.stake, parlay.odds, null) != null
        ? String(slipPayout(parlay.stake, parlay.odds, null)) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stakeNum = stake.trim() === '' ? null : Number(stake);
  const payoutNum = payout.trim() === '' ? null : Number(payout);
  const bad =
    (stakeNum != null && (!Number.isFinite(stakeNum) || stakeNum < 0)) ||
    (payoutNum != null && (!Number.isFinite(payoutNum) || payoutNum < 0));
  const preview = stakeNum != null && payoutNum != null
    ? Math.round((payoutNum - stakeNum) * 100) / 100 : null;

  async function save() {
    if (bad) return;
    setSaving(true);
    try {
      const { parlay: updated } = await api.updateParlay(parlay.id, {
        stake: stakeNum, payout: payoutNum,
      });
      onDone(updated);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="money-editor">
      <div className="field">
        <label htmlFor={`stake-${parlay.id}`}>STAKE</label>
        <input
          id={`stake-${parlay.id}`} className="input" inputMode="decimal"
          value={stake} placeholder="25" onChange={(e) => setStake(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`payout-${parlay.id}`}>PAYOUT</label>
        <input
          id={`payout-${parlay.id}`} className="input" inputMode="decimal"
          value={payout} placeholder="175" onChange={(e) => setPayout(e.target.value)}
        />
      </div>
      <div className="me-preview">
        <span className="k">PROFIT</span>
        <span className="v">{preview != null ? money(preview) : '—'}</span>
      </div>
      <button className="btn primary" onClick={save} disabled={saving || bad}>
        {saving ? 'SAVING…' : 'SAVE'}
      </button>
      <button className="btn ghost" onClick={() => onDone(null)} disabled={saving}>CANCEL</button>
      {bad && <div className="me-error">Enter positive numbers.</div>}
      {error && <div className="me-error">{error}</div>}
    </div>
  );
}

function pctTone(status: string, pct: number | null): string {
  if (status === 'WON') return 'won';
  if (status === 'LOST') return 'lost';
  if (pct == null) return '';
  if (pct >= 65) return 'good';
  if (pct >= 35) return 'even';
  return 'longshot';
}

interface LegRowProps {
  leg: Bet;
  prop: PropDef | undefined;
  showRemove: boolean;
  onRemove: () => void;
}

/** Hands each leg to the row that knows its sport and shape. */
function LegRow(p: LegRowProps) {
  if (p.leg.sport === 'nfl') return p.prop?.scope === 'game' ? <NflGameLegRow {...p} /> : <NflPlayerLegRow {...p} />;
  return <MlbLegRow {...p} />;
}

function MlbLegRow({ leg, prop, showRemove, onRemove }: LegRowProps) {
  const snapshot: StatsSnapshot | null = leg.statsSnapshot ? safeParse<StatsSnapshot>(leg.statsSnapshot) : null;
  const isPitching = prop?.category === 'pitching';
  const isOver = leg.direction === 'OVER';

  const target = isOver
    ? (prop?.decimal ? leg.line : Number.isInteger(leg.line) ? leg.line + 1 : Math.ceil(leg.line))
    : leg.line;

  const settled = ['WON', 'LOST', 'PUSH'].includes(leg.status);
  const barTone = leg.status === 'WON' ? 'win' : leg.status === 'LOST' ? 'dead'
    : !isOver && leg.progress > 0.6 ? 'risk' : '';

  const meta = BATTING_STATUS_META[leg.battingStatus ?? ''] ?? null;
  const badge = battingStatusLabel(leg.battingStatus, leg.battersAway);

  const pct = leg.winProbability != null ? Math.round(leg.winProbability * 100) : null;
  const g = leg.game;

  /**
   * Whether the pitcher is actually out there right now. Easy to miss
   * otherwise -- his line stops moving the moment he's pulled, and a frozen
   * stat line looks identical to a quiet inning.
   */
  const onMound = isPitching && Boolean(snapshot?.isCurrentPitcher);
  const pulled = isPitching && !onMound && g.status === 'Live' && (snapshot?.pitching.outs ?? 0) > 0;

  return (
    <div className={`leg ${leg.status.toLowerCase()}${onMound ? ' on-mound' : ''}${pulled ? ' pulled' : ''}`}>
      <PlayerPhoto playerId={leg.playerId ?? 0} size="sm" alt={leg.player?.fullName ?? ''} />

      <div className="leg-who">
        <div className="leg-name">{leg.player?.fullName}</div>
        <div className="leg-team">
          {leg.player?.teamAbbrev ?? ''}
          {leg.player?.position ? ` · ${leg.player.position}` : ''}
        </div>
      </div>

      <div className="leg-bet">
        <span className={isOver ? 'over' : 'under'}>{isOver ? 'Over' : 'Under'}</span>{' '}
        <b>{num(leg.line)}</b> {prop?.label ?? leg.betType}
      </div>

      <div className="leg-progress">
        <div className="leg-nums">
          <b>{num(leg.currentValue)}</b>
          <span>/ {num(target)}</span>
        </div>
        <div className={`bar ${barTone}`}>
          <i style={{ width: `${Math.round(leg.progress * 100)}%` }} />
        </div>
      </div>

      <div className="leg-pct" title={settled ? '' : `~${leg.chancesLeft ?? 0} chances left`}>
        {settled
          ? <span className={`leg-result ${leg.status}`}>{leg.status === 'WON' ? 'HIT' : leg.status === 'LOST' ? 'MISS' : leg.status}</span>
          : <span className={pctTone(leg.status, pct)}>{pct != null ? `${pct}%` : '—'}</span>}
      </div>

      <div className="leg-side">
        {!settled && badge && !isPitching && (
          <span className={`leg-badge ${meta?.tone ?? ''}`}>{meta?.dot} {badge}</span>
        )}
        {!settled && onMound && (
          <span className="mound-badge live">
            <em />PITCHING NOW
          </span>
        )}
        {!settled && pulled && (
          <span className="mound-badge out">OUT OF THE GAME</span>
        )}
        {!settled && isPitching && leg.expectedInningsLeft != null && (
          <span className={`leg-due${leg.shortLeash ? ' hot' : ''}`}>
            Expected to pitch ~{leg.expectedInningsLeft} more inning{leg.expectedInningsLeft === 1 ? '' : 's'}
            {leg.workloadNote ? <em>{leg.workloadNote}</em> : null}
          </span>
        )}
        {!settled && !isPitching && leg.expectedInning != null && leg.expectedHalf && (
          <span className="leg-due">
            Expected to bat in the {leg.expectedHalf} of the {ordinal(leg.expectedInning)}
          </span>
        )}
        <GameSituation game={g} />
      </div>

      <FieldState game={g} />

      {/* Component stats, so a H+R+RBI or total-bases leg shows its parts. */}
      {snapshot && (
        <div className="leg-stats">
          {isPitching ? (
            <>
              <S k="IP" v={`${Math.floor(snapshot.pitching.outs / 3)}.${snapshot.pitching.outs % 3}`} />
              <S k="K" v={snapshot.pitching.strikeOuts} />
              <S k="H" v={snapshot.pitching.hitsAllowed} />
              <S k="ER" v={snapshot.pitching.earnedRuns} />
              <S k="PC" v={snapshot.pitching.pitches} />
            </>
          ) : (
            <>
              <S k="AB" v={snapshot.batting.atBats} />
              <S k="H" v={snapshot.batting.hits} />
              <S k="HR" v={snapshot.batting.homeRuns} />
              <S k="RBI" v={snapshot.batting.rbi} />
              <S k="R" v={snapshot.batting.runs} />
              <S k="TB" v={snapshot.batting.totalBases} />
            </>
          )}
        </div>
      )}

      <RowTail leg={leg} showRemove={showRemove} onRemove={onRemove} />
    </div>
  );
}

/** A football player prop: yardage, catches, touchdowns, tackles... */
function NflPlayerLegRow({ leg, prop, showRemove, onRemove }: LegRowProps) {
  const line = safeParse<{ nfl: NflLine }>(leg.statsSnapshot)?.nfl ?? null;
  const isOver = leg.direction !== 'UNDER';
  const target = isOver
    ? (prop?.decimal ? leg.line : Number.isInteger(leg.line) ? leg.line + 1 : Math.ceil(leg.line))
    : leg.line;
  const settled = ['WON', 'LOST', 'PUSH', 'VOID'].includes(leg.status);
  const barTone = leg.status === 'WON' ? 'win' : leg.status === 'LOST' ? 'dead'
    : !isOver && leg.progress > 0.6 ? 'risk' : '';
  const g = leg.game;
  const status = fieldStatusMeta(leg.fieldStatus, prop?.category);
  const onField = !settled && (status?.tone === 'live' || status?.tone === 'redzone');

  return (
    <div className={`leg nfl ${leg.status.toLowerCase()}${onField ? ' on-field' : ''}`}>
      <PlayerPhoto playerId={leg.playerId ?? 0} size="sm" alt={leg.player?.fullName ?? ''} sport="nfl" />

      <div className="leg-who">
        <div className="leg-name">{leg.player?.fullName}</div>
        <div className="leg-team">
          {leg.player?.teamAbbrev ?? ''}
          {leg.player?.position ? ` · ${leg.player.position}` : ''}
        </div>
      </div>

      <div className="leg-bet"><BetText text={describeLeg(prop, leg, g)} /></div>

      <div className="leg-progress">
        <div className="leg-nums">
          <b>{num(leg.currentValue)}</b>
          <span>/ {num(target)}</span>
        </div>
        <div className={`bar ${barTone}`}>
          <i style={{ width: `${Math.round(leg.progress * 100)}%` }} />
        </div>
      </div>

      <PctCell leg={leg} />

      <div className="leg-side">
        {!settled && status && <span className={`leg-badge ${status.tone}`}>{status.icon} {status.label}</span>}
        {!settled && g.status === 'Live' && leg.paceValue != null && (
          <span className="leg-due">On pace for {num(leg.paceValue)} {paceUnit(prop)}</span>
        )}
        <GameSituation game={g} />
      </div>

      <FieldState game={g} />

      {line?.found && (
        <div className="leg-stats">
          {nflChips(prop, line, leg.player?.position ?? null).map((c) => <S key={c.k} k={c.k} v={c.v} />)}
        </div>
      )}

      <RowTail leg={leg} showRemove={showRemove} onRemove={onRemove} />
    </div>
  );
}

/** A football game line: total, team total, spread or moneyline. */
function NflGameLegRow({ leg, prop, showRemove, onRemove }: LegRowProps) {
  const g = leg.game;
  const settled = ['WON', 'LOST', 'PUSH', 'VOID'].includes(leg.status);
  const side = prop?.sides === 'team';
  const isOver = leg.direction !== 'UNDER';
  const target = Number.isInteger(leg.line) ? leg.line + 1 : Math.ceil(leg.line);
  const logo = teamLogoFor(g, leg.teamId) ?? g.homeLogo;
  const note = marginNote(prop, leg);
  const quarters = linescoreChips(g);
  const barTone = leg.status === 'WON' ? 'win' : leg.status === 'LOST' ? 'dead'
    : !side && !isOver && leg.progress > 0.6 ? 'risk' : '';

  return (
    <div className={`leg nfl game-line ${leg.status.toLowerCase()}`}>
      {logo
        ? <img className="photo sm team-logo" src={logo} alt="" />
        : <span className="photo sm team-logo" />}

      <div className="leg-who">
        <div className="leg-name">{g.awayAbbrev} @ {g.homeAbbrev}</div>
        <div className="leg-team">{prop?.label ?? leg.betType}</div>
      </div>

      <div className="leg-bet"><BetText text={describeLeg(prop, leg, g)} /></div>

      <div className="leg-progress">
        <div className="leg-nums">
          {side
            ? <><b>{signed(leg.currentValue)}</b><span>margin</span></>
            : <><b>{num(leg.currentValue)}</b><span>/ {num(target)} pts</span></>}
        </div>
        {/* A side has no distance to a line; its bar is its chance to cover. */}
        <div className={`bar ${barTone}`}>
          <i style={{ width: `${Math.round(leg.progress * 100)}%` }} />
        </div>
      </div>

      <PctCell leg={leg} />

      <div className="leg-side">
        {!settled && note && <span className="leg-due strong">{note}</span>}
        {!settled && !side && g.status === 'Live' && leg.paceValue != null && (
          <span className="leg-due">On pace for {num(leg.paceValue)} pts</span>
        )}
        <GameSituation game={g} />
      </div>

      <FieldState game={g} />

      {quarters && (
        <div className="leg-stats">
          {quarters.map((c) => <S key={c.k} k={c.k} v={c.v} />)}
        </div>
      )}

      <RowTail leg={leg} showRemove={showRemove} onRemove={onRemove} />
    </div>
  );
}

function PctCell({ leg }: { leg: Bet }) {
  const settled = ['WON', 'LOST', 'PUSH', 'VOID'].includes(leg.status);
  const pct = leg.winProbability != null ? Math.round(leg.winProbability * 100) : null;
  return (
    <div className="leg-pct">
      {settled
        ? <span className={`leg-result ${leg.status}`}>{leg.status === 'WON' ? 'HIT' : leg.status === 'LOST' ? 'MISS' : leg.status}</span>
        : <span className={pctTone(leg.status, pct)}>{pct != null ? `${pct}%` : '—'}</span>}
    </div>
  );
}

/** Every row ends the same way: the remove control and, once in, the HIT cover. */
function RowTail({ leg, showRemove, onRemove }: { leg: Bet; showRemove: boolean; onRemove: () => void }) {
  return (
    <>
      {showRemove
        ? <button className="leg-rm" title="Remove leg" aria-label="Remove leg" onClick={onRemove}>×</button>
        : <span className="leg-rm-spacer" />}

      {/* Once a leg is in, the numbers behind it stop mattering -- so cover them. */}
      {leg.status === 'WON' && (
        <div className="leg-hit" role="status">
          <span>THIS LEG HIT!!!</span>
        </div>
      )}
    </>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function S({ k, v }: { k: string; v: number | string }) {
  return <span className="s"><i>{k}</i>{v}</span>;
}

function safeParse<T>(json: string | null): T | null {
  if (!json) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}
