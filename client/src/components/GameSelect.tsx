import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { MlbGame } from '../lib/types';
import { gameDay, gameTime, ordinalInning } from '../lib/format';

/**
 * Spec §3 -- the player's games, chronologically. Final games are shown but
 * disabled so a finished game can't accidentally become a new live bet.
 */
export function GameSelect({
  playerId, selected, onSelect,
}: { playerId: number; selected: MlbGame | null; onSelect: (g: MlbGame) => void }) {
  const [games, setGames] = useState<MlbGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.playerGames(playerId)
      .then(({ games }) => {
        if (cancelled) return;
        setGames(games);
        // One obvious choice (a live game, else the next scheduled one) is
        // preselected so the common path is a single click.
        const auto = games.find((g) => g.status === 'Live') ?? games.find((g) => g.status === 'Preview');
        if (auto) onSelect(auto);
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // onSelect is stable in practice; re-running on it would loop the autoselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  if (loading) {
    return (
      <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="spinner" /> Loading games…
      </div>
    );
  }
  if (error) return <div className="error-box">{error}</div>;
  if (games.length === 0) {
    return <div className="empty"><p>No scheduled games found for this player in the next week.</p></div>;
  }

  return (
    <div className="cards">
      {games.map((g) => {
        const isFinal = g.status === 'Final';
        const isLive = g.status === 'Live';
        return (
          <button
            key={g.gamePk}
            className={`game-card${selected?.gamePk === g.gamePk ? ' selected' : ''}`}
            disabled={isFinal}
            onClick={() => onSelect(g)}
            title={isFinal ? 'This game is already final' : undefined}
            aria-label={`${g.awayAbbrev} at ${g.homeAbbrev}, ${isLive ? 'live now' : isFinal ? 'final' : `${gameDay(g.gameDate)} ${gameTime(g.gameDate)}`}`}
            aria-pressed={selected?.gamePk === g.gamePk}
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
              {g.awayAbbrev} @ {g.homeAbbrev}
            </div>
            <div className="teams">{g.awayName} vs {g.homeName}</div>

            <div className="when">
              {isLive || isFinal ? (
                <>
                  {g.awayAbbrev} {g.awayScore ?? 0} — {g.homeAbbrev} {g.homeScore ?? 0}
                  {isLive && g.inning ? ` · ${g.inningState ?? ''} ${ordinalInning(g.inning)}`.toUpperCase() : ''}
                </>
              ) : (
                gameTime(g.gameDate)
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
