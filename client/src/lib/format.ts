/** American odds -> profit on a stake (spec §9). */
export function profitFor(stake: number, odds: number): number {
  if (!Number.isFinite(stake) || !Number.isFinite(odds) || odds === 0) return 0;
  const profit = odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
  return Math.round(profit * 100) / 100;
}

export function payoutFor(stake: number, odds: number): number {
  return Math.round((stake + profitFor(stake, odds)) * 100) / 100;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

/** Trim trailing zeros: 1.50 -> "1.5", 3.00 -> "3". */
export function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function gameTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "TODAY" / "TOMORROW" / "SAT SEP 6" (spec §3). */
export function gameDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000);
  if (days === 0) return 'TODAY';
  if (days === 1) return 'TOMORROW';
  if (days === -1) return 'YESTERDAY';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

export function ordinalInning(n: number | null): string {
  if (!n) return '';
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Badge copy + colour for the Coming Up indicator (spec §16). */
export const BATTING_STATUS_META: Record<string, { label: string; dot: string; tone: string }> = {
  AT_BAT:              { label: 'AT BAT',                 dot: '🔴', tone: 'atbat' },
  ON_DECK:             { label: 'ON DECK',                dot: '🟡', tone: 'ondeck' },
  COMING_UP:           { label: 'COMING UP',              dot: '🟢', tone: 'comingup' },
  BATTERS_AWAY:        { label: 'COMES TO BAT SOON',      dot: '🟡', tone: 'away' },
  WAITING_FOR_NEXT_AB: { label: 'WAITING FOR NEXT AT-BAT', dot: '⚪', tone: 'waiting' },
  GAME_FINAL:          { label: 'GAME FINAL',             dot: '⚫', tone: 'final' },
  GAME_NOT_STARTED:    { label: 'GAME NOT STARTED',       dot: '⚪', tone: 'waiting' },
  PLAYER_REMOVED:      { label: 'PLAYER REMOVED',         dot: '⚫', tone: 'removed' },
  NOT_IN_LINEUP:       { label: 'NOT IN LINEUP',          dot: '⚫', tone: 'removed' },
};

/**
 * Profit on a slip. An entered payout wins over American odds -- if the book
 * quoted "$25 returns $150", that is the number to trust.
 */
export function slipProfit(stake: number | null, odds: number | null, payout: number | null): number | null {
  if (payout != null && stake != null) return Math.round((payout - stake) * 100) / 100;
  if (payout != null) return null; // payout alone can't separate stake from profit
  if (stake != null && odds != null) return profitFor(stake, odds);
  return null;
}

/** Total return on a slip. */
export function slipPayout(stake: number | null, odds: number | null, payout: number | null): number | null {
  if (payout != null) return payout;
  if (stake != null && odds != null) return payoutFor(stake, odds);
  return null;
}

/** Spec §16 badge copy, with the real count when we have one. */
export function battingStatusLabel(status: string | null, battersAway: number | null): string | null {
  if (status === 'BATTERS_AWAY' && battersAway != null) {
    return battersAway === 1
      ? 'COMES TO BAT NEXT'
      : `COMES TO BAT IN ${battersAway} BATTERS`;
  }
  return BATTING_STATUS_META[status ?? '']?.label ?? null;
}
