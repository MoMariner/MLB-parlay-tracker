import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { MlbGame, MlbPlayer, Parlay, PropDef, PropGroup, Sport } from '../lib/types';
import { PlayerSearch } from './PlayerSearch';
import { GameSelect, SlateSelect } from './GameSelect';
import { BetText } from './BetText';
import { PlayerPhoto } from './PlayerPhoto';
import { formatOdds, money, num, payoutFor, profitFor } from '../lib/format';
import { describeLeg, formatSpread, legTextString, teamLogoFor } from '../lib/nfl';

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
  sport: Sport;
  /** Null for a game line. */
  player: MlbPlayer | null;
  game: MlbGame;
  prop: PropDef;
  direction: 'OVER' | 'UNDER' | 'TEAM';
  line: number;
  /** The side picked on a spread, moneyline or team total. */
  teamId: number | null;
}

type Mode = 'player' | 'game';

const middle = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? 0.5;

/** A team's share of the market total, split by the spread, on the usual half point. */
function impliedTeamTotal(g: MlbGame, teamId: number): number | null {
  if (g.marketTotal == null) return null;
  const homeMargin = g.marketSpread != null ? -g.marketSpread : 0;
  const pts = teamId === g.homeTeamId ? (g.marketTotal + homeMargin) / 2 : (g.marketTotal - homeMargin) / 2;
  return Math.floor(pts) + 0.5;
}

/** The market spread from one team's side: LAR -3.5 is SF +3.5. */
function teamSpread(g: MlbGame, teamId: number): number | null {
  if (g.marketSpread == null) return null;
  return teamId === g.homeTeamId ? g.marketSpread : -g.marketSpread;
}

/**
 * Build a slip one pick at a time -- MLB or NFL, player props or NFL game
 * lines -- then submit it as one parlay. A slip with one leg is a straight bet.
 */
export function AddBet({ onAdded }: { onAdded: (parlay: Parlay) => void }) {
  const [sport, setSport] = useState<Sport>('mlb');
  const [mode, setMode] = useState<Mode>('player');
  const [slip, setSlip] = useState<SlipLeg[]>([]);

  // Player prop being built
  const [player, setPlayer] = useState<MlbPlayer | null>(null);
  const [game, setGame] = useState<MlbGame | null>(null);
  const [groups, setGroups] = useState<PropGroup[]>([]);
  const [prop, setProp] = useState<PropDef | null>(null);

  // Game line being built
  const [markets, setMarkets] = useState<PropDef[]>([]);
  const [lineGame, setLineGame] = useState<MlbGame | null>(null);
  const [market, setMarket] = useState<PropDef | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);

  const [direction, setDirection] = useState<'OVER' | 'UNDER'>('OVER');
  const [line, setLine] = useState('');

  const [name, setName] = useState('');
  const [source, setSource] = useState('manual');
  const [odds, setOdds] = useState('');
  const [stake, setStake] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const gameMode = sport === 'nfl' && mode === 'game';

  // The prop menu follows the player's position.
  useEffect(() => {
    if (!player) { setGroups([]); return; }
    let cancelled = false;
    api.playerProps(player.id, sport)
      .then(({ categories }) => { if (!cancelled) setGroups(categories); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [player, sport]);

  // Game-line markets, loaded on first use; SlateSelect fetches the games itself.
  useEffect(() => {
    if (!gameMode || markets.length > 0) return;
    let cancelled = false;
    api.propCatalog()
      .then((c) => { if (!cancelled) setMarkets(c.props.filter((p) => p.sport === 'nfl' && p.scope === 'game')); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [gameMode, markets.length]);

  function resetPick() {
    setPlayer(null); setGame(null); setGroups([]); setProp(null);
    setLineGame(null); setMarket(null); setTeamId(null);
    setLine(''); setDirection('OVER');
  }

  function switchSport(next: Sport) {
    if (next === sport) return;
    setSport(next); setMode('player'); resetPick(); setError(null); setDone(null);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next); resetPick(); setError(null);
  }

  function pickPlayer(p: MlbPlayer) {
    setPlayer(p); setGame(null); setProp(null); setLine(''); setError(null); setDone(null);
  }

  function pickProp(p: PropDef) {
    setProp(p);
    setLine(String(middle(p.commonLines)));
  }

  function pickLineGame(g: MlbGame) {
    setLineGame(g); setMarket(null); setTeamId(null); setLine(''); setError(null); setDone(null);
  }

  function pickMarket(m: PropDef) {
    setMarket(m); setTeamId(null); setDirection('OVER');
    if (m.key === 'NFL_GAME_TOTAL') setLine(String(lineGame?.marketTotal ?? middle(m.commonLines)));
    else if (m.key === 'NFL_MONEYLINE') setLine('0');
    else setLine('');
  }

  function pickTeam(id: number) {
    if (!lineGame || !market) return;
    setTeamId(id);
    if (market.key === 'NFL_SPREAD') {
      const s = teamSpread(lineGame, id);
      setLine(s != null ? String(s) : '');
    } else if (market.key === 'NFL_TEAM_TOTAL') {
      const t = impliedTeamTotal(lineGame, id);
      setLine(t != null ? String(t) : '');
    }
  }

  const lineNum = Number(line);
  const lineIsNumber = line.trim() !== '' && Number.isFinite(lineNum);
  // Only a spread may be negative.
  const lineValid = lineIsNumber && ((gameMode && market?.key === 'NFL_SPREAD') || lineNum >= 0);

  const gameReady = gameMode && lineGame != null && market != null && (
    market.sides === 'team'
      ? teamId != null && (market.key === 'NFL_MONEYLINE' || lineValid)
      : market.sides === 'teamOverUnder'
        ? teamId != null && lineValid
        : lineValid
  );
  const playerReady = !gameMode && Boolean(player && game && prop && lineValid);
  const pickReady = gameReady || playerReady;

  /** The pick as it will read on the slip. */
  const pending = gameMode
    ? (lineGame && market
      ? describeLeg(market, {
        betType: market.key,
        direction: market.sides === 'team' ? 'TEAM' : direction,
        line: market.key === 'NFL_MONEYLINE' ? 0 : lineNum || 0,
        teamId,
      }, lineGame)
      : null)
    : (prop ? describeLeg(prop, { betType: prop.key, direction, line: lineNum || 0, teamId: null }) : null);

  function addToSlip() {
    if (!pickReady) return;
    let leg: SlipLeg;
    if (gameMode && lineGame && market) {
      const dir = market.sides === 'team' ? 'TEAM' : direction;
      const ln = market.key === 'NFL_MONEYLINE' ? 0 : lineNum;
      leg = {
        key: `nfl-${lineGame.gamePk}-${market.key}-${teamId ?? 'game'}-${dir}-${ln}`,
        sport: 'nfl', player: null, game: lineGame, prop: market, direction: dir, line: ln, teamId,
      };
    } else if (player && game && prop) {
      leg = {
        key: `${sport}-${player.id}-${game.gamePk}-${prop.key}-${direction}-${lineNum}`,
        sport, player, game, prop, direction, line: lineNum, teamId: null,
      };
    } else {
      return;
    }
    if (slip.some((l) => l.key === leg.key)) {
      setError('That pick is already on the slip.');
      return;
    }
    setSlip((prev) => [...prev, leg]);
    setError(null);
    setDone(null);
    // Straight back to the start for the next pick. A game line keeps its game
    // selected, since a total and a side on the same game is a common pair.
    if (gameMode) { setMarket(null); setTeamId(null); setLine(''); } else { resetPick(); }
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
          sport: l.sport,
          playerId: l.player?.id ?? null,
          gamePk: l.game.gamePk,
          betType: l.prop.key,
          direction: l.direction,
          line: l.line,
          teamId: l.teamId,
        })),
      });
      onAdded(parlay);
      setDone(slip.length === 1 ? 'Bet added.' : `${slip.length}-leg parlay added.`);
      setSlip([]); setName(''); setOdds(''); setStake('');
      resetPick();
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

  const steps = useMemo(() => (gameMode
    ? [
      { n: 1, label: 'GAME', done: !!lineGame, active: !lineGame },
      { n: 2, label: 'MARKET', done: !!market, active: !!lineGame && !market },
      { n: 3, label: 'SIDE', done: gameReady, active: !!market },
    ]
    : [
      { n: 1, label: 'PLAYER', done: !!player, active: !player },
      { n: 2, label: 'GAME', done: !!game, active: !!player && !game },
      { n: 3, label: 'PROP', done: !!prop, active: !!game && !prop },
      { n: 4, label: 'LINE', done: !!prop && lineValid, active: !!prop },
    ]), [gameMode, lineGame, market, gameReady, player, game, prop, lineValid]);

  // Quick-pick lines for game lines, centred on the market.
  const gameChips = useMemo(() => {
    if (!lineGame || !market) return [];
    const around = (x: number) => [x - 1, x, x + 1];
    if (market.key === 'NFL_GAME_TOTAL') {
      return lineGame.marketTotal != null ? around(lineGame.marketTotal) : market.commonLines;
    }
    if (market.key === 'NFL_SPREAD') {
      const s = teamId != null ? teamSpread(lineGame, teamId) : null;
      return s != null ? around(s) : market.commonLines;
    }
    if (market.key === 'NFL_TEAM_TOTAL') {
      const t = teamId != null ? impliedTeamTotal(lineGame, teamId) : null;
      return t != null ? around(t) : market.commonLines;
    }
    return [];
  }, [lineGame, market, teamId]);

  return (
    <div className="add-layout">
      <div>
        <h1 className="h1">ADD BET</h1>
        <p className="sub">
          Build your slip one pick at a time — mix sports, games and players. One pick is a straight bet; two or more is a parlay.
        </p>

        <div className="toggles">
          <div className="seg" aria-label="Sport">
            <button className={sport === 'mlb' ? 'on' : ''} aria-pressed={sport === 'mlb'} onClick={() => switchSport('mlb')}>⚾ MLB</button>
            <button className={sport === 'nfl' ? 'on' : ''} aria-pressed={sport === 'nfl'} onClick={() => switchSport('nfl')}>🏈 NFL</button>
          </div>
          {sport === 'nfl' && (
            <div className="seg small" aria-label="Kind of bet">
              <button className={mode === 'player' ? 'on' : ''} aria-pressed={mode === 'player'} onClick={() => switchMode('player')}>PLAYER PROPS</button>
              <button className={mode === 'game' ? 'on' : ''} aria-pressed={mode === 'game'} onClick={() => switchMode('game')}>GAME LINES</button>
            </div>
          )}
        </div>

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

        {gameMode ? (
          <>
            {/* ---- Game lines: game -> market -> side ---- */}
            <section style={{ marginBottom: 26 }}>
              <h2 className="section-title">THIS WEEK'S GAMES</h2>
              <SlateSelect selected={lineGame} onSelect={pickLineGame} />
            </section>

            {lineGame && (
              <section style={{ marginBottom: 26 }}>
                <h2 className="section-title">MARKET</h2>
                <div className="prop-grid">
                  {markets.map((m) => (
                    <button
                      key={m.key}
                      className={`prop-card${market?.key === m.key ? ' selected' : ''}`}
                      onClick={() => pickMarket(m)}
                      aria-pressed={market?.key === m.key}
                      aria-label={`Game line: ${m.label}`}
                    >
                      <div className="lbl">{m.label}</div>
                      {m.help && <div className="hint">{m.help}</div>}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {lineGame && market && (
              <section style={{ marginBottom: 26 }}>
                <h2 className="section-title">{market.sides === 'overUnder' ? 'BET' : 'PICK A SIDE'}</h2>

                {market.sides !== 'overUnder' && (
                  <div className="team-row">
                    {[
                      { id: lineGame.awayTeamId, abbrev: lineGame.awayAbbrev },
                      { id: lineGame.homeTeamId, abbrev: lineGame.homeAbbrev },
                    ].map((t) => {
                      const logo = teamLogoFor(lineGame, t.id);
                      const hint = market.key === 'NFL_SPREAD'
                        ? (teamSpread(lineGame, t.id) != null ? formatSpread(teamSpread(lineGame, t.id) as number) : '')
                        : market.key === 'NFL_TEAM_TOTAL'
                          ? (impliedTeamTotal(lineGame, t.id) != null ? `o/u ${num(impliedTeamTotal(lineGame, t.id) as number)}` : '')
                          : '';
                      return (
                        <button
                          key={t.id}
                          className={`team-btn${teamId === t.id ? ' on' : ''}`}
                          onClick={() => pickTeam(t.id)}
                          aria-pressed={teamId === t.id}
                        >
                          {logo && <img src={logo} alt="" />}
                          <span>{t.abbrev}</span>
                          {hint && <span className="ln">{hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {market.sides !== 'team' && (
                  <div className="ou-row" style={{ marginBottom: 18 }}>
                    <button className={`ou-btn over${direction === 'OVER' ? ' on' : ''}`} onClick={() => setDirection('OVER')} aria-pressed={direction === 'OVER'}>OVER</button>
                    <button className={`ou-btn under${direction === 'UNDER' ? ' on' : ''}`} onClick={() => setDirection('UNDER')} aria-pressed={direction === 'UNDER'}>UNDER</button>
                  </div>
                )}

                {market.key !== 'NFL_MONEYLINE' && (market.sides === 'overUnder' || teamId != null) && (
                  <div className="field" style={{ marginBottom: 16 }}>
                    <label>{market.key === 'NFL_SPREAD' ? 'SPREAD' : 'LINE'}</label>
                    <div className="line-row">
                      {gameChips.map((l) => (
                        <button
                          key={l}
                          className={`line-chip${lineNum === l ? ' on' : ''}`}
                          onClick={() => setLine(String(l))}
                          aria-label={`Line ${num(l)}`}
                          aria-pressed={lineNum === l}
                        >{market.key === 'NFL_SPREAD' ? formatSpread(l) : num(l)}</button>
                      ))}
                      <input
                        className="input" style={{ width: 130 }} type="number" step="0.5"
                        inputMode="decimal" value={line} placeholder={market.key === 'NFL_SPREAD' ? '-3.5' : '44.5'}
                        onChange={(e) => setLine(e.target.value)}
                      />
                    </div>
                    {line.trim() !== '' && !lineValid && (
                      <span style={{ color: 'var(--lose)', fontSize: 12 }}>Enter a valid number.</span>
                    )}
                  </div>
                )}

                <button className="btn primary big" disabled={!pickReady} onClick={addToSlip}>
                  + ADD TO SLIP{pickReady && pending ? ` — ${legTextString(pending)}` : ''}
                </button>
              </section>
            )}
          </>
        ) : (
          <>
            {/* ---- Player props: player -> game -> prop -> line ---- */}
            {!player ? (
              <div className="panel"><PlayerSearch key={sport} sport={sport} onSelect={pickPlayer} /></div>
            ) : (
              <div className="selected-player">
                <PlayerPhoto playerId={player.id} size="lg" alt={player.fullName} sport={sport} />
                <div style={{ flex: 1 }}>
                  <div className="nm">{player.fullName}</div>
                  <div className="tm">{player.teamName ?? 'Free Agent'}</div>
                  <div className="pos">{player.position ?? ''}{player.jerseyNumber ? ` · #${player.jerseyNumber}` : ''}</div>
                </div>
                <button className="btn ghost" onClick={resetPick}>CHANGE PLAYER</button>
              </div>
            )}

            {player && (
              <section style={{ marginBottom: 26 }}>
                <h2 className="section-title">SELECT GAME</h2>
                <GameSelect playerId={player.id} sport={sport} selected={game} onSelect={setGame} />
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
                  <button className={`ou-btn over${direction === 'OVER' ? ' on' : ''}`} onClick={() => setDirection('OVER')} aria-pressed={direction === 'OVER'}>OVER</button>
                  <button className={`ou-btn under${direction === 'UNDER' ? ' on' : ''}`} onClick={() => setDirection('UNDER')} aria-pressed={direction === 'UNDER'}>UNDER</button>
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
                  + ADD TO SLIP{pickReady && pending ? ` — ${legTextString(pending)}` : ''}
                </button>
              </section>
            )}
          </>
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
              {slip.map((l, i) => {
                const t = describeLeg(l.prop, { betType: l.prop.key, direction: l.direction, line: l.line, teamId: l.teamId }, l.game);
                const logo = teamLogoFor(l.game, l.teamId) ?? l.game.homeLogo ?? null;
                return (
                  <li key={l.key}>
                    {l.player
                      ? <PlayerPhoto playerId={l.player.id} size="sm" alt={l.player.fullName} sport={l.sport} />
                      : logo
                        ? <img className="photo sm team-logo" src={logo} alt="" />
                        : <span className="photo sm team-logo" />}
                    <div className="sl-who">
                      <div className="sl-name">{l.player ? l.player.fullName : `${l.game.awayAbbrev} @ ${l.game.homeAbbrev}`}</div>
                      <div className="sl-bet"><BetText text={t} /></div>
                      <div className="sl-game">{l.sport.toUpperCase()} · {l.game.awayAbbrev} @ {l.game.homeAbbrev}</div>
                    </div>
                    <button
                      className="sl-rm"
                      title="Remove leg"
                      onClick={() => setSlip((prev) => prev.filter((_, j) => j !== i))}
                    >×</button>
                  </li>
                );
              })}
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
