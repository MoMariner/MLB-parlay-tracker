/**
 * Shared game polling manager.
 *
 * Bets are grouped by game key ("mlb:824472", "nfl:401872657"). Each DISTINCT
 * game gets exactly one poller and so one feed request per tick, however many
 * legs ride on it. The poller itself knows nothing about baseball or football:
 * each tick it fetches the feed, hands it to that sport's adapter to read the
 * situation and grade every leg, then persists what changed and pushes it.
 */

import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../db.js';
import { getSettings } from './settings.js';
import { refreshParlaysFor } from './parlays.js';
import { ADAPTERS, adapterFor, parseKey, type GameStatus } from '../sports/index.js';

const OPEN_STATUSES = ['PENDING', 'LIVE'];
const SETTLED = ['WON', 'LOST', 'PUSH', 'VOID'];

interface Poller {
  gameKey: string;
  timer: NodeJS.Timeout;
  intervalMs: number;
  lastStatus: GameStatus | null;
  lastError: string | null;
  lastPolledAt: number | null;
}

const pollers = new Map<string, Poller>();
let io: SocketServer | null = null;

/**
 * Feed requests since boot. Exposed on the status endpoint so the one-request-
 * per-game guarantee is measurable rather than assumed.
 */
let feedRequests = 0;

export function attachSocket(server: SocketServer): void {
  io = server;
}

export function pollerStats() {
  return {
    activeGames: pollers.size,
    feedRequests,
    games: [...pollers.values()].map((p) => {
      const { sport, id } = parseKey(p.gameKey);
      return {
        gameKey: p.gameKey,
        sport,
        gamePk: id,
        intervalMs: p.intervalMs,
        status: p.lastStatus,
        lastPolledAt: p.lastPolledAt,
        lastError: p.lastError,
      };
    }),
  };
}

/**
 * Did a column actually move? Probabilities get a tolerance so simulation
 * noise doesn't rewrite every leg on every tick.
 */
function differs(key: string, before: unknown, after: unknown): boolean {
  if (key === 'winProbability' || key === 'progress') {
    if (before == null || after == null) return before !== after;
    return Math.abs(Number(before) - Number(after)) > 0.005;
  }
  return (before ?? null) !== (after ?? null);
}

/** Poll one game and grade every leg on it. The ONLY place that fetches a feed. */
export async function pollGame(gameKey: string): Promise<void> {
  const { sport, id: gamePk } = parseKey(gameKey);
  const adapter = adapterFor(sport);
  const poller = pollers.get(gameKey);

  let feed: any;
  try {
    feedRequests += 1;
    feed = await adapter.fetchFeed(gamePk);
    if (poller) poller.lastError = null;
  } catch (err) {
    const message = (err as Error).message;
    if (poller) poller.lastError = message;
    console.error(`[poll ${gameKey}] ${message}`);
    io?.emit('poll:error', { gameKey, error: message });
    return;
  }

  const snapshot = adapter.snapshot(feed);
  if (poller) {
    poller.lastStatus = snapshot.status;
    poller.lastPolledAt = Date.now();
  }

  await prisma.game.update({ where: { key: gameKey }, data: adapter.gameUpdate(snapshot) })
    .catch(() => { /* game row may have been deleted mid-poll */ });

  const bets = await prisma.bet.findMany({
    where: {
      gameKey,
      // Football re-grades settled legs too (see SportAdapter); a leg the user
      // voided by hand is left alone either way.
      status: { in: adapter.recheckSettledWhileLive ? [...OPEN_STATUSES, 'WON', 'LOST', 'PUSH'] : OPEN_STATUSES },
    },
    include: { player: true },
  });

  const results = await adapter.evaluate(bets, feed, snapshot);
  const updated: any[] = [];

  for (const bet of bets) {
    const data = results.get(bet.id);
    if (!data) continue;
    const changed = Object.entries(data).some(([k, v]) => differs(k, (bet as any)[k], v));
    if (!changed) continue;

    const settled = SETTLED.includes(String(data.status));
    const next = await prisma.bet.update({
      where: { id: bet.id },
      data: { ...data, settledAt: settled ? bet.settledAt ?? new Date() : null },
      include: { player: true, game: true },
    });
    updated.push(next);
  }

  if (updated.length > 0) {
    const parlays = await refreshParlaysFor(updated.map((b) => b.id));
    if (parlays.length > 0) io?.emit('parlays:update', parlays);
  }

  io?.emit('game:update', { gameKey, sport, gamePk, snapshot });
  if (updated.length > 0) io?.emit('bets:update', updated);

  // A finished game with nothing left to grade needs no more requests.
  if (snapshot.status === 'Final' || snapshot.status === 'Other') {
    const remaining = await prisma.bet.count({ where: { gameKey, status: { in: OPEN_STATUSES } } });
    if (remaining === 0) stopPolling(gameKey);
  }
}

function intervalFor(status: GameStatus | null): number {
  const s = getSettings();
  return status === 'Live' ? s.livePollIntervalMs : s.previewPollIntervalMs;
}

function startPolling(gameKey: string, status: GameStatus | null): void {
  if (pollers.has(gameKey)) return;
  const intervalMs = intervalFor(status);
  const poller: Poller = {
    gameKey,
    timer: setInterval(() => { void tick(gameKey); }, intervalMs),
    intervalMs,
    lastStatus: status,
    lastError: null,
    lastPolledAt: null,
  };
  pollers.set(gameKey, poller);
  console.log(`[poll] start ${gameKey} every ${intervalMs}ms`);
  void pollGame(gameKey); // fire immediately so the card isn't blank
}

/** Poll, then re-time if the game changed state (first pitch, kickoff). */
async function tick(gameKey: string): Promise<void> {
  await pollGame(gameKey);
  const poller = pollers.get(gameKey);
  if (!poller) return;
  const want = intervalFor(poller.lastStatus);
  if (want !== poller.intervalMs) {
    clearInterval(poller.timer);
    poller.intervalMs = want;
    poller.timer = setInterval(() => { void tick(gameKey); }, want);
    console.log(`[poll] ${gameKey} -> ${want}ms (${poller.lastStatus})`);
  }
}

export function stopPolling(gameKey: string): void {
  const poller = pollers.get(gameKey);
  if (!poller) return;
  clearInterval(poller.timer);
  pollers.delete(gameKey);
  console.log(`[poll] stop ${gameKey}`);
}

export function stopAll(): void {
  for (const gameKey of [...pollers.keys()]) stopPolling(gameKey);
}

/**
 * Reconcile pollers against the bets in the database. Called at boot, after
 * any bet is added or removed, and whenever the poll interval changes.
 */
export async function syncPollers(): Promise<void> {
  const open = await prisma.bet.groupBy({ by: ['gameKey'], where: { status: { in: OPEN_STATUSES } } });

  // Sports that re-grade settled legs keep polling until their game ends,
  // even when every leg on it has already settled.
  const recheckSports = Object.values(ADAPTERS).filter((a) => a.recheckSettledWhileLive).map((a) => a.sport);
  const rechecking = recheckSports.length === 0 ? [] : await prisma.bet.findMany({
    where: {
      sport: { in: recheckSports },
      status: { in: ['WON', 'LOST', 'PUSH'] },
      game: { status: { in: ['Preview', 'Live'] } },
    },
    select: { gameKey: true },
    distinct: ['gameKey'],
  });

  const wanted = new Set([...open.map((r) => r.gameKey), ...rechecking.map((r) => r.gameKey)]);

  for (const gameKey of [...pollers.keys()]) {
    if (!wanted.has(gameKey)) stopPolling(gameKey);
  }
  for (const gameKey of wanted) {
    if (!pollers.has(gameKey)) {
      const game = await prisma.game.findUnique({ where: { key: gameKey } });
      startPolling(gameKey, (game?.status as GameStatus) ?? null);
    }
  }
}

/** Re-time every poller after the user edits the interval in Settings. */
export function retimeAll(): void {
  for (const poller of pollers.values()) {
    const want = intervalFor(poller.lastStatus);
    if (want === poller.intervalMs) continue;
    clearInterval(poller.timer);
    poller.intervalMs = want;
    poller.timer = setInterval(() => { void tick(poller.gameKey); }, want);
  }
}
