import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { MlbGame, MlbPlayer, Parlay, PropDef, PropGroup } from '../lib/types';
import { PlayerSearch } from './PlayerSearch';
import { GameSelect } from './GameSelect';
import { PlayerPhoto } from './PlayerPhoto';
import { formatOdds, money, num, payoutFor, profitFor } from '../lib/format';

const SOURCES = [
  { key: 'manual', label: 'Manual' },
  { key: 'underdog', label: 'Underdog' },
  { key: 'draftkings', label: 'DraftKings' },
  { key: 'fanduel', label: 'FanDuel' },
  { key: 'betmgm', label: 'BetMGM' },
];

/** A pick sitting on the slip, not yet submitted. */
interface SlipLeg {
  key: string;
  player: MlbPlayer;
  game: MlbGame;
  prop: PropDef;
  direction: 'OVER' | 'UNDER';
  line: number;
}

/**
 * Search → player → game → prop → over/under → line → ADD TO SLIP.
 * Repeat for each leg, then submit the slip as one parlay. A slip with a
 * single leg is just a straight bet.
 */
export function AddBet({ onAdded }: { onAdded: (parlay: Parlay) => void }) {
  const [slip, setSlip] = useState<SlipLeg[]>([]);
  const [player, setPlayer] = useState<MlbPlayer | null>(null);
  const [game, setGame] = useState<MlbGame | null>(null);
  const [groups, setGroups] = useState<PropGroup[]>([]);
  const [prop, setProp] = useState<PropDef | null>(null);
  const [direction, setDirection] = useState<'OVER' | 'UNDER'>('OVER');
  const [line, setLine] = useState('');

  const [name, setName] = useState('');
  const [source, setSource] = useState('manual');
  const [odds, setOdds] = useState('');
  const [stake, setStake] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!player) { setGroups([]); return; }
    let cancelled = false;
    api.playerProps(player.id)
      .then(({ categories }) => { if (!cancelled) setGroups(categories); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [player]);

  function pickPlayer(p: MlbPlayer) {
    setPlayer(p); setGame(null); setProp(null); setLine(''); setError(null); setDone(null);
  }

  function pickProp(p: PropDef) {
    setProp(p);
    setLine(String(p.commonLines[Math.floor(p.commonLines.length / 2)] ?? 0.5));
  }

  function clearPick(keepPlayer: boolean) {
    setProp(null); setLine(''); setDirection('OVER');
    if (!keepPlayer) { setPlayer(null); setGame(null); }
  }

  const lineNum = Number(line);
  const lineValid = line.trim() !== '' && Number.isFinite(lineNum) && lineNum >= 0;
  const pickReady = Boolean(player && game && prop && lineValid);

  function addToSlip() {
    if (!pickReady || !player || !game || !prop) return;
    const duplicate = slip.some(
      (l) => l.player.id === player.id && l.game.gamePk === game.gamePk && l.prop.key === prop.key,
    );
    if (duplicate) {
      setError(`${player.fullName} ${prop.label} is already on the slip.`);
      return;
    }
    setSlip((prev) => [...prev, {
      key: `${player.id}-${game.gamePk}-${prop.key}-${direction}-${lineNum}`,
      player, game, prop, direction, line: lineNum,
    }]);
    setError(null);
    setDone(null);
    clearPick(false); // straight to the next search -- fastest path to a full slip
  }

  const stakeNum = Number(stake);
  const oddsNum = Number(odds);
  const showPayout = stake.trim() !== '' && odds.trim() !== '' &&
    Number.isFinite(stakeNum) && Number.isFinite(oddsNum) && Math.abs(oddsNum) >= 100 && stakeNum > 0;

  async function submitSlip(allowFinal = false) {
    if (slip.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { parlay } = await api.createParlay({
        name: name.trim() || null,
        source,
        odds: odds.trim() === '' ? null : oddsNum,
        stake: stake.trim() === '' ? null : stakeNum,
        allowFinal,
        legs: slip.map((l) => ({
          playerId: l.player.id, gamePk: l.game.gamePk,
          betType: l.prop.key, direction: l.direction, line: l.line,
        })),
      });
      onAdded(parlay);
      setDone(slip.length === 1 ? 'Bet added.' : `${slip.length}-leg parlay added.`);
      setSlip([]); setName(''); setOdds(''); setStake('');
      clearPick(false);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'GAME_FINAL' && !allowFinal) {
        if (confirm(`${e.message} Log the slip anyway for your records?`)) {
          setSubmitting(false);
          return submitSlip(true);
        }
        setError('Slip not added — one of the games is already final.');
      } else {
        setError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const steps = useMemo(() => ([
    { n: 1, label: 'PLAYER', done: !!player, active: !player },
    { n: 2, label: 'GAME', done: !!game, active: !!player && !game },
    { n: 3, label: 'PROP', done: !!prop, active: !!game && !prop },
    { n: 4, label: 'LINE', done: !!prop && lineValid, active: !!prop },
  ]), [player, game, prop, lineValid]);

  return (
    <div className="add-layout">
      <div>
        <h1 className="h1">ADD MLB BET</h1>
        <p className="sub">
          Build your slip one pick at a time — a single pick is a straight bet, two or more is a parlay.
        </p>

        <div className="steps">
          {steps.map((s) => (
            <span key={s.n} className={`step${s.done ? ' done' : ''}${s.active && !s.done ? ' active' : ''}`}>
              <span className="n">{s.done ? '✓' : s.n}</span>{s.label}
            </span>
          ))}
        </div>

        {done && (
          <div className="error-box" style={{ background: '#0f2f20', borderColor: '#1c7a4c', color: '#7ce8b0' }}>
            ✓ {done} It's on the LIVE BETS screen now.
          </div>
        )}
        {error && <div className="error-box">{error}</div>}

        {!player ? (
          <div className="panel"><PlayerSearch onSelect={pickPlayer} /></div>
        ) : (
          <div className="selected-player">
            <PlayerPhoto playerId={player.id} size="lg" alt={player.fullName} />
            <div style={{ flex: 1 }}>
              <div className="nm">{player.fullName}</div>
              <div className="tm">{player.teamName ?? 'Free Agent'}</div>
              <div className="pos">{player.position ?? ''}{player.jerseyNumber ? ` · #${player.jerseyNumber}` : ''}</div>
            </div>
            <button className="btn ghost" onClick={() => clearPick(false)}>CHANGE PLAYER</button>
          </div>
        )}

        {player && (
          <section style={{ marginBottom: 26 }}>
            <h2 className="section-title">SELECT GAME</h2>
            <GameSelect playerId={player.id} selected={game} onSelect={setGame} />
          </section>
        )}

        {player && game && (
          <section style={{ marginBottom: 26 }}>
            <h2 className="section-title">SELECT BET TYPE</h2>
            {groups.map((grp) => (
              <div key={grp.category} style={{ marginBottom: 18 }}>
                <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 800, letterSpacing: '0.13em', marginBottom: 9 }}>
                  {grp.label.toUpperCase()}
                </div>
                <div className="prop-grid">
                  {grp.props.map((p) => (
                    <button
                      key={p.key}
                      className={`prop-card${prop?.key === p.key ? ' selected' : ''}`}
                      onClick={() => pickProp(p)}
                      aria-label={`${grp.label}: ${p.label}`}
                      aria-pressed={prop?.key === p.key}
                    >
                      <div className="lbl">{p.label}</div>
                      {p.help && <div className="hint">{p.help}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {player && game && prop && (
          <section style={{ marginBottom: 26 }}>
            <h2 className="section-title">BET</h2>
            <div className="ou-row" style={{ marginBottom: 18 }}>
              <button
                className={`ou-btn over${direction === 'OVER' ? ' on' : ''}`}
                onClick={() => setDirection('OVER')}
                aria-pressed={direction === 'OVER'}
              >OVER</button>
              <button
                className={`ou-btn under${direction === 'UNDER' ? ' on' : ''}`}
                onClick={() => setDirection('UNDER')}
                aria-pressed={direction === 'UNDER'}
              >UNDER</button>
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label>LINE</label>
              <div className="line-row">
                {prop.commonLines.map((l) => (
                  <button
                    key={l}
                    className={`line-chip${lineNum === l ? ' on' : ''}`}
                    onClick={() => setLine(String(l))}
                    aria-label={`Line ${num(l)}`}
                    aria-pressed={lineNum === l}
                  >{num(l)}</button>
                ))}
                <input
                  className="input" style={{ width: 130 }} type="number" step="0.5" min="0"
                  inputMode="decimal" value={line} placeholder="1.5"
                  onChange={(e) => setLine(e.target.value)}
                />
              </div>
              {line.trim() !== '' && !lineValid && (
                <span style={{ color: 'var(--lose)', fontSize: 12 }}>Enter a valid, non-negative number.</span>
              )}
            </div>

            <button className="btn primary big" disabled={!pickReady} onClick={addToSlip}>
              + ADD TO SLIP — {direction} {num(lineNum || 0)} {prop.label}
            </button>
          </section>
        )}
      </div>

      {/* ---- the slip ---- */}
      <aside className="slip">
        <div className="slip-head">
          <span>YOUR SLIP</span>
          <span className="slip-count">{slip.length} {slip.length === 1 ? 'leg' : 'legs'}</span>
        </div>

        {slip.length === 0 ? (
          <p className="slip-empty">
            Picks you add show up here. One leg is a straight bet; add more and they become a parlay
            that needs every leg to hit.
          </p>
        ) : (
          <>
            <ul className="slip-legs">
              {slip.map((l, i) => (
                <li key={l.key}>
                  <PlayerPhoto playerId={l.player.id} size="sm" alt={l.player.fullName} />
                  <div className="sl-who">
                    <div className="sl-name">{l.player.fullName}</div>
                    <div className="sl-bet">
                      <span className={l.direction === 'OVER' ? 'over' : 'under'}>
                        {l.direction === 'OVER' ? 'Over' : 'Under'}
                      </span>{' '}
                      <b>{num(l.line)}</b> {l.prop.label}
                    </div>
                    <div className="sl-game">{l.game.awayAbbrev} @ {l.game.homeAbbrev}</div>
                  </div>
                  <button
                    className="sl-rm"
                    title="Remove leg"
                    onClick={() => setSlip((prev) => prev.filter((_, j) => j !== i))}
                  >×</button>
                </li>
              ))}
            </ul>

            <div className="field" style={{ marginTop: 16 }}>
              <label>SLIP NAME (OPTIONAL)</label>
              <input className="input" value={name} placeholder={slip.length > 1 ? `${slip.length}-Leg Parlay` : 'Single'}
                onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>SOURCE</label>
              <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>

            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="field">
                <label>ODDS (OPTIONAL)</label>
                <input className="input" value={odds} placeholder="+600" inputMode="numeric"
                  onChange={(e) => setOdds(e.target.value)} />
              </div>
              <div className="field">
                <label>STAKE (OPTIONAL)</label>
                <input className="input" value={stake} placeholder="25" inputMode="decimal"
                  onChange={(e) => setStake(e.target.value)} />
              </div>
            </div>

            {showPayout && (
              <div className="payout" style={{ marginTop: 14 }}>
                <div><span className="k">PROFIT</span><span className="v profit">{money(profitFor(stakeNum, oddsNum))}</span></div>
                <div><span className="k">PAYOUT</span><span className="v">{money(payoutFor(stakeNum, oddsNum))}</span></div>
                <div><span className="k">ODDS</span><span className="v">{formatOdds(oddsNum)}</span></div>
              </div>
            )}

            <button
              className="btn primary big"
              style={{ width: '100%', marginTop: 16 }}
              disabled={submitting}
              onClick={() => submitSlip()}
            >
              {submitting ? 'ADDING…' : slip.length === 1 ? 'ADD BET' : `ADD ${slip.length}-LEG PARLAY`}
            </button>
            <button
              className="btn ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setSlip([])}
              disabled={submitting}
            >CLEAR SLIP</button>
          </>
        )}
      </aside>
    </div>
  );
}
