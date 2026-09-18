import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MlbPlayer, Sport } from '../lib/types';
import { PlayerPhoto } from './PlayerPhoto';

type OnSelect = (player: MlbPlayer, sport: Sport) => void;

const otherLeague = (sport: Sport): Sport => (sport === 'nfl' ? 'mlb' : 'nfl');

/** Matches in the league other than `sport` -- best-effort, so an outage there can't fail this search. */
async function searchOtherLeague(q: string, sport: Sport, signal: AbortSignal): Promise<MlbPlayer[]> {
  try {
    return (await api.searchPlayers(q, otherLeague(sport), signal)).players.slice(0, 3);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return [];
  }
}

/**
 * Type a name, pick a player. Debounced at 300ms and every stale request is
 * aborted, so a fast typist makes one API call, not eight. A name with no
 * match in this league is looked up in the other one: Add Bet opens on MLB,
 * so that's where a search for a quarterback often starts.
 */
export function PlayerSearch({ onSelect, sport = 'mlb' }: { onSelect: OnSelect; sport?: Sport }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MlbPlayer[]>([]);
  const [elsewhere, setElsewhere] = useState<MlbPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = query.trim();
    abortRef.current?.abort();

    if (q.length < 2) {
      setResults([]);
      setElsewhere([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const { players } = await api.searchPlayers(q, sport, controller.signal);
        const alt = players.length > 0 ? [] : await searchOtherLeague(q, sport, controller.signal);
        setResults(players);
        setElsewhere(alt);
        setError(null);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, sport]);

  const league = sport.toUpperCase();
  const q = query.trim();
  const noMatch = !loading && !error && q.length >= 2 && results.length === 0;

  return (
    <div>
      <div className="field">
        <label htmlFor="player-search">SEARCH {league} PLAYERS</label>
        <input
          id="player-search"
          ref={inputRef}
          className="input"
          placeholder={sport === 'nfl' ? 'e.g. Stafford, Nacua, McCaffrey' : 'e.g. Judge, Ohtani, Witt'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}

      {loading && (
        <div style={{ marginTop: 18, color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="spinner" /> Searching {league}…
        </div>
      )}

      {noMatch && (
        <div style={{ marginTop: 18, color: 'var(--muted)' }}>No {league} players found for “{q}”.</div>
      )}

      <div className="search-results">
        {results.map((p) => <ResultRow key={p.id} player={p} sport={sport} onSelect={onSelect} />)}
      </div>

      {noMatch && elsewhere.length > 0 && (
        <>
          <div className="search-elsewhere">IN THE {otherLeague(sport).toUpperCase()}</div>
          <div className="search-results">
            {elsewhere.map((p) => (
              <ResultRow key={p.id} player={p} sport={otherLeague(sport)} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ResultRow({ player: p, sport, onSelect }: { player: MlbPlayer; sport: Sport; onSelect: OnSelect }) {
  return (
    <button
      className="result-row"
      onClick={() => onSelect(p, sport)}
      aria-label={`${p.fullName}, ${p.teamName ?? 'free agent'}${p.position ? `, ${p.position}` : ''}`}
    >
      <PlayerPhoto playerId={p.id} size="sm" alt={p.fullName} sport={sport} />
      <span className="who">
        <span className="nm">{p.fullName}</span>
        <span className="tm">{p.teamName ?? 'Free Agent'}</span>
      </span>
      {p.position && <span className="pos">{p.position}</span>}
    </button>
  );
}
