import type { AppSettings, Bet, MlbGame, MlbPlayer, Parlay, PropDef, PropGroup, ScoringFormat } from './types';

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

export const api = {
  searchPlayers: (q: string, signal?: AbortSignal) =>
    request<{ players: MlbPlayer[] }>(`/api/players/search?q=${encodeURIComponent(q)}`, { signal }),

  playerGames: (playerId: number) =>
    request<{ games: MlbGame[] }>(`/api/players/${playerId}/games`),

  playerProps: (playerId: number) =>
    request<{ position: string | null; positionType: string | null; categories: PropGroup[] }>(
      `/api/players/${playerId}/props`,
    ),

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
    request<{ settings: AppSettings; scoring: Record<string, ScoringFormat>; defaultScoring: Record<string, ScoringFormat> }>(
      '/api/settings',
    ),

  patchSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  putScoring: (scoring: Record<string, ScoringFormat>) =>
    request<{ scoring: Record<string, ScoringFormat> }>('/api/settings/scoring', {
      method: 'PUT', body: JSON.stringify({ scoring }),
    }),

  resetScoring: () =>
    request<{ scoring: Record<string, ScoringFormat> }>('/api/settings/scoring/reset', { method: 'POST' }),

  status: () =>
    request<{
      mlb: { ok: boolean; latencyMs: number; error?: string };
      polling: { activeGames: number; feedRequests: number; games: { gamePk: number; intervalMs: number; status: string | null; lastPolledAt: number | null; lastError: string | null }[] };
      settings: AppSettings;
    }>('/api/settings/status'),
};
