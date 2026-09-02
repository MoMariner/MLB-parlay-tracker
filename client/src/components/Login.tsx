import { useEffect, useRef, useState } from 'react';

/** Password gate shown whenever the API reports no valid session. */
export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? 'Could not sign in');
      }
      onAuthed();
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div className="login-brand">
          <span className="ball">⚾</span>
          <div>
            <div className="name">MLB LIVE BET TRACKER</div>
            <div className="sub">REAL-TIME PROP TRACKING</div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="pw">PASSWORD</label>
          <input
            id="pw"
            ref={input}
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && <div className="error-box" style={{ margin: 0 }}>{error}</div>}

        <button className="btn primary big" type="submit" disabled={busy || !password}>
          {busy ? 'CHECKING…' : 'SIGN IN'}
        </button>

        <p className="login-note">Stays signed in on this device for 30 days.</p>
      </form>
    </div>
  );
}
