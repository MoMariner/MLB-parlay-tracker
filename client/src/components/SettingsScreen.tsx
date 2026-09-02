import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AppSettings, ScoringFormat } from '../lib/types';

/** Spec §25 -- API status, polling, fantasy scoring, display. */
/** camelCase scoring key -> readable label, keeping baseball acronyms upright. */
function statLabel(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1').trim().split(' ');
  return words
    .map((w) => (/^(rbi|hbp|sb|cs|bb|ip|er)$/i.test(w) ? w.toUpperCase() : w))
    .join(' ');
}

export function SettingsScreen({
  settings, onSettings,
}: { settings: AppSettings | null; onSettings: (s: AppSettings) => void }) {
  const [scoring, setScoring] = useState<Record<string, ScoringFormat>>({});
  const [activeFormat, setActiveFormat] = useState('underdog');
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.status>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(({ scoring }) => setScoring(scoring)).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    let stop = false;
    const load = () => api.status().then((s) => { if (!stop) setStatus(s); }).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  async function patch(p: Partial<AppSettings>) {
    try {
      const { settings } = await api.patchSettings(p);
      onSettings(settings);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }

  async function saveScoring() {
    setSaving(true);
    try {
      const { scoring: saved } = await api.putScoring(scoring);
      setScoring(saved);
      setMessage('Scoring saved — open bets re-score on the next poll.');
      setError(null);
      setTimeout(() => setMessage(null), 4000);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function reset() {
    const { scoring: fresh } = await api.resetScoring();
    setScoring(fresh);
    setMessage('Scoring reset to defaults.');
    setTimeout(() => setMessage(null), 4000);
  }

  function editValue(group: 'batting' | 'pitching', stat: string, raw: string) {
    setScoring((prev) => ({
      ...prev,
      [activeFormat]: {
        ...prev[activeFormat],
        [group]: { ...prev[activeFormat][group], [stat]: raw === '' || raw === '-' ? 0 : Number(raw) },
      },
    }));
  }

  const format = scoring[activeFormat];

  return (
    <div>
      <h1 className="h1">SETTINGS</h1>
      <p className="sub">API health, polling cadence, fantasy scoring and display.</p>

      {error && <div className="error-box">{error}</div>}
      {message && (
        <div className="error-box" style={{ background: '#0f2f20', borderColor: '#1c7a4c', color: '#7ce8b0' }}>{message}</div>
      )}

      <div className="settings-grid" style={{ marginBottom: 18 }}>
        <div className="panel">
          <h2 className="section-title">MLB API STATUS</h2>
          {status ? (
            <>
              <span className={`status-pill ${status.mlb.ok ? 'ok' : 'bad'}`}>
                {status.mlb.ok ? '● CONNECTED' : '● UNREACHABLE'} · {status.mlb.latencyMs}ms
              </span>
              {status.mlb.error && <div style={{ color: 'var(--lose)', marginTop: 10, fontSize: 13 }}>{status.mlb.error}</div>}

              <div className="setting-row" style={{ marginTop: 14 }}>
                <div>
                  <div className="lbl">Games being polled</div>
                  <div className="desc">
                    One request per game per tick — every bet in a game shares that single feed.
                  </div>
                </div>
                <div style={{ fontSize: 27, fontWeight: 900 }}>{status.polling.activeGames}</div>
              </div>

              <div className="setting-row">
                <div>
                  <div className="lbl">Feed requests since start</div>
                  <div className="desc">Counts one per game per poll, not one per bet.</div>
                </div>
                <div style={{ fontSize: 27, fontWeight: 900 }}>{status.polling.feedRequests}</div>
              </div>

              {status.polling.games.map((g) => (
                <div key={g.gamePk} style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 8 }}>
                  Game {g.gamePk} · {g.status ?? 'unknown'} · every {Math.round(g.intervalMs / 1000)}s
                  {g.lastError ? <span style={{ color: 'var(--lose)' }}> · {g.lastError}</span> : ''}
                </div>
              ))}
            </>
          ) : <span className="spinner" />}
        </div>

        <div className="panel">
          <h2 className="section-title">POLLING</h2>
          <div className="setting-row">
            <div>
              <div className="lbl">Live game interval</div>
              <div className="desc">How often a game in progress is refreshed.</div>
            </div>
            <select
              className="input" style={{ width: 130 }}
              value={settings?.livePollIntervalMs ?? 15000}
              onChange={(e) => patch({ livePollIntervalMs: Number(e.target.value) })}
            >
              {[5000, 10000, 15000, 20000, 30000, 60000].map((ms) => (
                <option key={ms} value={ms}>{ms / 1000}s</option>
              ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <div className="lbl">Scheduled game interval</div>
              <div className="desc">How often a game that hasn’t started is checked for first pitch.</div>
            </div>
            <select
              className="input" style={{ width: 130 }}
              value={settings?.previewPollIntervalMs ?? 60000}
              onChange={(e) => patch({ previewPollIntervalMs: Number(e.target.value) })}
            >
              {[30000, 60000, 120000, 300000].map((ms) => (
                <option key={ms} value={ms}>{ms / 1000}s</option>
              ))}
            </select>
          </div>
        </div>

        <div className="panel">
          <h2 className="section-title">DISPLAY</h2>
          <div className="setting-row">
            <div>
              <div className="lbl">TV mode</div>
              <div className="desc">Larger type and wider cards for reading across a room.</div>
            </div>
            <button
              className={`toggle${settings?.tvMode ? ' on' : ''}`}
              aria-pressed={!!settings?.tvMode}
              onClick={() => patch({ tvMode: !settings?.tvMode })}
            />
          </div>
          <div className="setting-row">
            <div>
              <div className="lbl">Keep settled bets on dashboard</div>
              <div className="desc">Leave hit/missed bets visible until you remove them.</div>
            </div>
            <button
              className={`toggle${settings?.keepSettledOnDashboard ? ' on' : ''}`}
              aria-pressed={!!settings?.keepSettledOnDashboard}
              onClick={() => patch({ keepSettledOnDashboard: !settings?.keepSettledOnDashboard })}
            />
          </div>
          <div className="setting-row">
            <div>
              <div className="lbl">Demo mode</div>
              <div className="desc">
                Adds a simulated game and roster to player search so the whole flow
                works with no live baseball. Real bets keep tracking real games.
              </div>
            </div>
            <button
              className={`toggle${settings?.demoMode ? ' on' : ''}`}
              aria-pressed={!!settings?.demoMode}
              onClick={() => patch({ demoMode: !settings?.demoMode })}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="section-title">FANTASY SCORING</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          A bet’s source picks its scoring format — an Underdog fantasy-points bet scores with
          the Underdog column. Edit any value and open bets re-score on the next poll.
        </p>

        <div className="scoring-tabs">
          {Object.entries(scoring).map(([key, f]) => (
            <button key={key} className={key === activeFormat ? 'on' : ''} onClick={() => setActiveFormat(key)}>
              {f.label}
            </button>
          ))}
        </div>

        {format && (
          <>
            <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 800, letterSpacing: '0.13em', margin: '4px 0 10px' }}>
              BATTING
            </div>
            <div className="scoring-grid">
              {Object.entries(format.batting).map(([stat, value]) => (
                <div className="field" key={stat}>
                  <label>{statLabel(stat)}</label>
                  <input className="input" type="number" step="0.25" value={value}
                    onChange={(e) => editValue('batting', stat, e.target.value)} />
                </div>
              ))}
            </div>

            <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 800, letterSpacing: '0.13em', margin: '18px 0 10px' }}>
              PITCHING
            </div>
            <div className="scoring-grid">
              {Object.entries(format.pitching).map(([stat, value]) => (
                <div className="field" key={stat}>
                  <label>{statLabel(stat)}</label>
                  <input className="input" type="number" step="0.25" value={value}
                    onChange={(e) => editValue('pitching', stat, e.target.value)} />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn primary" onClick={saveScoring} disabled={saving}>
                {saving ? 'SAVING…' : 'SAVE SCORING'}
              </button>
              <button className="btn ghost" onClick={reset}>RESET TO DEFAULTS</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
