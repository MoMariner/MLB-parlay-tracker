import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { MlbGame, Sport } from '../lib/types';
import { gameDay, gameTime, num, ordinalInning } from '../lib/format';
import { quarterLabel } from '../lib/nfl';

/** One selectable game. Final games render but can't be picked. */
function GameCard({
  g, sport, selected, onSelect,
}: { g: MlbGame; sport: Sport; selected: boolean; onSelect: (g: MlbGame) => void }) {
  const isFinal = g.status === 'Final';
  const isLive = g.status === 'Live';
  const liveState = sport === 'nfl'
    ? quarterLabel({ status: g.status, period: g.period, clock: g.clock, detailedState: g.detailedState })
    : g.inning ? `${g.inningState ?? ''} ${ordinalInning(g.inning)}`.toUpperCase() : '';
  // A missing score is unknown, not 0-0 -- the card shows the clock alone.
  const score = g.awayScore != null && g.homeScore != null
    ? `${g.awayAbbrev} ${g.awayScore} — ${g.homeAbbrev} ${g.homeScore}`
    : '';

  return (
    <button
      className={`game-card${selected ? ' selected' : ''}`}
      disabled={isFinal}
      onClick={() => onSelect(g)}
      title={isFinal ? 'This game is already final' : undefined}
      aria-label={`${g.awayAbbrev} at ${g.homeAbbrev}, ${isLive ? 'live now' : isFinal ? 'final' : `${gameDay(g.gameDate)} ${gameTime(g.gameDate)}`}`}
      aria-pressed={selected}
    >
      {isLive ? (
        <span className="live-dot" style={{ color: 'var(--live)', fontWeight: 900, fontSize: 11, letterSpacing: '0.12em' }}>
          ● LIVE
        </span>
      ) : (
        <span style={{ color: 'var(--muted)', fontWeight: 800, fontSize: 11, letterSpacing: '0.14em' }}>
          {isFinal ? 'FINAL' : gameDay(g.gameDate)}
        </span>
      )}

      <div className="matchup">
        {g.awayLogo && <img className="gc-logo" src={g.awayLogo} alt="" />}
        {g.awayAbbrev} @ {g.homeAbbrev}
        {g.homeLogo && <img className="gc-logo" src={g.homeLogo} alt="" />}
      </div>
      <div className="teams">{g.awayName} vs {g.homeName}</div>

      <div className="when">
        {isLive || isFinal
          ? [score, isLive ? liveState : ''].filter(Boolean).join(' · ')
          : gameTime(g.gameDate)}
      </div>

      {sport === 'nfl' && (g.marketTotal != null || g.oddsDetails) && (
        <div className="gc-odds">
          {g.oddsDetails && <span>{g.oddsDetails.replace(/-(\d)/, '−$1')}</span>}
          {g.marketTotal != null && <span>O/U {num(g.marketTotal)}</span>}
        </div>
      )}
    </button>
  );
}

/**
 * A player's games, chronologically. The obvious choice -- a live game, else
 * the next scheduled one -- is preselected so the common path is one click.
 */
export function GameSelect({
  playerId, sport = 'mlb', selected, onSelect,
}: { playerId: number; sport?: Sport; selected: MlbGame | null; onSelect: (g: MlbGame) => void }) {
  const [games, setGames] = useState<MlbGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.playerGames(playerId, sport)
      .then(({ games }) => {
        if (cancelled) return;
        setGames(games);
        const auto = games.find((g) => g.status === 'Live') ?? games.find((g) => g.status === 'Preview');
        if (auto) onSelect(auto);
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // onSelect is stable in practice; re-running on it would loop the autoselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, sport]);

  if (loading) {
    return (
      <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="spinner" /> Loading games…
      </div>
    );
  }
  if (error) return <div className="error-box">{error}</div>;
  if (games.length === 0) {
    return (
      <div className="empty">
        <p>No scheduled games found for this player {sport === 'nfl' ? 'in the next few weeks' : 'in the next week'}.</p>
      </div>
    );
  }

  return (
    <div className="cards">
      {games.map((g) => (
        <GameCard key={g.gamePk} g={g} sport={sport} selected={selected?.gamePk === g.gamePk} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** This week's NFL slate, for totals, spreads and moneylines. */
export function SlateSelect({
  selected, onSelect,
}: { selected: MlbGame | null; onSelect: (g: MlbGame) => void }) {
  const [games, setGames] = useState<MlbGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.nflSlate()
      .then(({ games }) => { if (!cancelled) setGames(games); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="spinner" /> Loading this week’s games…
      </div>
    );
  }
  if (error) return <div className="error-box">{error}</div>;
  if (games.length === 0) return <div className="empty"><p>No NFL games on the schedule this week.</p></div>;

  return (
    <div className="cards">
      {games.map((g) => (
        <GameCard key={g.gamePk} g={g} sport="nfl" selected={selected?.gamePk === g.gamePk} onSelect={onSelect} />
      ))}
    </div>
  );
}

