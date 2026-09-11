import type {
  AppSettings, Bet, MlbGame, MlbPlayer, NflScoring, Parlay, PropDef, PropGroup, ScoringFormat, Sport,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Session expired or was cleared; a reload lands on the login box.
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  if (!res.ok) {
    const err = new Error((body as any).error ?? `Request failed (${res.status})`);
    (err as any).code = (body as any).code;
    (err as any).status = res.status;
    throw err;
  }
  return body as T;
}

interface ApiHealth { ok: boolean; latencyMs: number; error?: string }

export const api = {
  searchPlayers: (q: string, sport: Sport = 'mlb', signal?: AbortSignal) =>
    request<{ players: MlbPlayer[] }>(`/api/players/search?q=${encodeURIComponent(q)}&sport=${sport}`, { signal }),

  playerGames: (playerId: number, sport: Sport = 'mlb') =>
    request<{ games: MlbGame[] }>(`/api/players/${playerId}/games?sport=${sport}`),

  playerProps: (playerId: number, sport: Sport = 'mlb') =>
    request<{ position: string | null; positionType: string | null; categories: PropGroup[] }>(
      `/api/players/${playerId}/props?sport=${sport}`,
    ),

  /** This week's NFL games, with market totals and spreads. */
  nflSlate: () => request<{ games: MlbGame[] }>('/api/games/nfl/slate'),

  propCatalog: () => request<{ props: PropDef[]; sources: { key: string; label: string }[] }>('/api/bets/props'),

  listBets: (scope: 'open' | 'settled' | 'all') =>
    request<{ bets: Bet[] }>(`/api/bets?scope=${scope}`),

  createBet: (payload: Record<string, unknown>) =>
    request<{ bet: Bet }>('/api/bets', { method: 'POST', body: JSON.stringify(payload) }),

  updateBet: (id: string, payload: Record<string, unknown>) =>
    request<{ bet: Bet }>(`/api/bets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteBet: (id: string) => request<{ ok: true }>(`/api/bets/${id}`, { method: 'DELETE' }),

  listParlays: (scope: 'open' | 'settled' | 'all') =>
    request<{ parlays: Parlay[] }>(`/api/parlays?scope=${scope}`),

  createParlay: (payload: Record<string, unknown>) =>
    request<{ parlay: Parlay }>('/api/parlays', { method: 'POST', body: JSON.stringify(payload) }),

  updateParlay: (id: string, payload: Record<string, unknown>) =>
    request<{ parlay: Parlay }>(`/api/parlays/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  deleteParlay: (id: string) =>
    request<{ ok: true }>(`/api/parlays/${id}`, { method: 'DELETE' }),

  deleteLeg: (parlayId: string, betId: string) =>
    request<{ ok: true; parlay: Parlay | null }>(`/api/parlays/${parlayId}/legs/${betId}`, { method: 'DELETE' }),

  getSettings: () =>
    request<{
      settings: AppSettings;
      scoring: Record<string, ScoringFormat>;
      defaultScoring: Record<string, ScoringFormat>;
      nflScoring: Record<string, NflScoring>;
      defaultNflScoring: Record<string, NflScoring>;
    }>('/api/settings'),

  patchSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  putScoring: <T = ScoringFormat>(scoring: Record<string, T>, sport: Sport = 'mlb') =>
    request<{ scoring: Record<string, T> }>('/api/settings/scoring', {
      method: 'PUT', body: JSON.stringify({ scoring, sport }),
    }),

  resetScoring: <T = ScoringFormat>(sport: Sport = 'mlb') =>
    request<{ scoring: Record<string, T> }>(`/api/settings/scoring/reset?sport=${sport}`, { method: 'POST' }),

  status: () =>
    request<{
      mlb: ApiHealth;
      nfl: ApiHealth;
      polling: {
        activeGames: number;
        feedRequests: number;
        games: {
          gameKey: string; sport: Sport; gamePk: number; intervalMs: number;
          status: string | null; lastPolledAt: number | null; lastError: string | null;
        }[];
      };
      settings: AppSettings;
    }>('/api/settings/status'),
};
