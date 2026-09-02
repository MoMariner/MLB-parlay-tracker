import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';
import { socket } from './lib/socket';
import type { AppSettings, Parlay, PropDef } from './lib/types';
import { LiveBets } from './components/LiveBets';
import { AddBet } from './components/AddBet';
import { History } from './components/History';
import { SettingsScreen } from './components/SettingsScreen';

type Screen = 'live' | 'add' | 'history' | 'settings';

const TABS: { key: Screen; label: string }[] = [
  { key: 'live', label: 'LIVE BETS' },
  { key: 'add', label: 'ADD BET' },
  { key: 'history', label: 'HISTORY' },
  { key: 'settings', label: 'SETTINGS' },
];

/**
 * Merge slips into state by id, newest-first.
 *
 * Both the POST response and the server's socket push carry the same slip, and
 * the push usually wins the race (the server polls and emits before the HTTP
 * response is sent). Prepending blindly would render the same slip twice, so
 * every path into `parlays` goes through here.
 */
function mergeParlays(prev: Parlay[], incoming: Parlay[]): Parlay[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  const fresh: Parlay[] = [];
  for (const p of incoming) {
    if (byId.has(p.id)) byId.set(p.id, p);
    else fresh.push(p);
  }
  return [...fresh, ...byId.values()];
}

export function App() {
  const [screen, setScreen] = useState<Screen>('live');
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [propDefs, setPropDefs] = useState<PropDef[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState<string | null>(null);

  const propMap = useMemo(() => new Map(propDefs.map((p) => [p.key, p])), [propDefs]);

  const loadParlays = useCallback(() => {
    api.listParlays('all')
      .then(({ parlays }) => setParlays(parlays))
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    loadParlays();
    api.propCatalog().then(({ props }) => setPropDefs(props)).catch(() => {});
    api.getSettings().then(({ settings }) => setSettings(settings)).catch(() => {});
  }, [loadParlays]);

  // Live push from the server after every poll -- the page never needs a
  // manual refresh.
  useEffect(() => {
    const onConnect = () => { setConnected(true); loadParlays(); };
    const onDisconnect = () => setConnected(false);
    const onParlays = (updated: Parlay[]) => setParlays((prev) => mergeParlays(prev, updated));

    // Score/inning changes touch every leg in that game even when no stat moved.
    const onGame = ({ gamePk, snapshot }: { gamePk: number; snapshot: Parlay['bets'][number]['game'] }) => {
      setParlays((prev) => prev.map((p) => ({
        ...p,
        bets: p.bets.map((b) => (b.gamePk === gamePk ? { ...b, game: { ...b.game, ...snapshot } } : b)),
      })));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('parlays:update', onParlays);
    socket.on('game:update', onGame);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('parlays:update', onParlays);
      socket.off('game:update', onGame);
    };
  }, [loadParlays]);

  async function removeParlay(id: string) {
    const previous = parlays;
    setParlays((prev) => prev.filter((p) => p.id !== id));
    try {
      await api.deleteParlay(id);
    } catch (err) {
      setParlays(previous);
      setError((err as Error).message);
    }
  }

  async function removeLeg(parlayId: string, betId: string) {
    const previous = parlays;
    setParlays((prev) => prev
      .map((p) => (p.id === parlayId ? { ...p, bets: p.bets.filter((b) => b.id !== betId) } : p))
      .filter((p) => p.bets.length > 0));
    try {
      const { parlay } = await api.deleteLeg(parlayId, betId);
      if (parlay) setParlays((prev) => mergeParlays(prev, [parlay]));
    } catch (err) {
      setParlays(previous);
      setError((err as Error).message);
    }
  }

  const settledStatuses = ['WON', 'LOST', 'PUSH'];
  const dashboard = settings?.keepSettledOnDashboard === false
    ? parlays.filter((p) => !settledStatuses.includes(p.status))
    : parlays;

  return (
    <div className={`app${settings?.tvMode ? ' tv' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="ball">⚾</span>
          <span>
            <div className="name">MLB LIVE BET TRACKER</div>
            <div className="sub">REAL-TIME PROP TRACKING</div>
          </span>
        </div>

        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={screen === t.key ? 'active' : ''}
              onClick={() => setScreen(t.key)}
            >
              {t.label}
              {t.key === 'live' && dashboard.length > 0 ? ` (${dashboard.length})` : ''}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          {settings?.demoMode && <span className="demo-flag">DEMO MODE</span>}
          <span className={`conn${connected ? ' online' : ''}`}>
            <span className="dot" />{connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </header>

      <main className="content">
        {error && (
          <div className="error-box" onClick={() => setError(null)} style={{ cursor: 'pointer' }}>
            {error} <span style={{ opacity: 0.6 }}>(click to dismiss)</span>
          </div>
        )}

        {screen === 'live' && (
          <LiveBets
            parlays={dashboard}
            props={propMap}
            onRemoveParlay={removeParlay}
            onRemoveLeg={removeLeg}
            onUpdated={(p) => setParlays((prev) => mergeParlays(prev, [p]))}
            onAddBet={() => setScreen('add')}
          />
        )}
        {screen === 'add' && (
          <AddBet onAdded={(parlay) => setParlays((prev) => mergeParlays(prev, [parlay]))} />
        )}
        {screen === 'history' && <History props={propMap} />}
        {screen === 'settings' && <SettingsScreen settings={settings} onSettings={setSettings} />}
      </main>
    </div>
  );
}
