import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MlbPlayer, Sport } from '../lib/types';
import { PlayerPhoto } from './PlayerPhoto';

/**
 * Type a name, pick a player. Debounced at 300ms and every stale request is
 * aborted, so a fast typist makes one API call, not eight.
 */
export function PlayerSearch({ onSelect, sport = 'mlb' }: { onSelect: (p: MlbPlayer) => void; sport?: Sport }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MlbPlayer[]>([]);
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
        setResults(players);
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

      {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
        <div style={{ marginTop: 18, color: 'var(--muted)' }}>No players found for “{query.trim()}”.</div>
      )}

      <div className="search-results">
        {results.map((p) => (
          <button
            key={p.id}
            className="result-row"
            onClick={() => onSelect(p)}
            aria-label={`${p.fullName}, ${p.teamName ?? 'free agent'}${p.position ? `, ${p.position}` : ''}`}
          >
            <PlayerPhoto playerId={p.id} size="sm" alt={p.fullName} sport={sport} />
            <span className="who">
              <span className="nm">{p.fullName}</span>
              <span className="tm">{p.teamName ?? 'Free Agent'}</span>
            </span>
            {p.position && <span className="pos">{p.position}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
