/**
 * Shared game polling manager (spec §27).
 *
 * Bets are grouped by gamePk. Each DISTINCT game gets exactly one poller and
 * therefore one MLB feed request per tick, no matter how many bets or players
 * ride on it. Five tracked games => five pollers, not five-per-bet.
 *
 * Each tick: fetch feed once -> update the Game row -> evaluate every bet on
 * that game from the single payload -> persist changes -> emit over Socket.IO.
 */

import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../db.js';
import { getGameFeed } from './mlbApi.js';
import { extractGameSnapshot, extractPlayerState, type GameSnapshot } from './statExtractor.js';
import { evaluateBet } from './propEvaluator.js';
import { getSettings } from './settings.js';
import { advanceDemo, buildDemoFeed, isDemoGame } from './demoMode.js';
import { estimateWinProbability } from './winProbability.js';
import { refreshParlaysFor } from './parlays.js';
import { projectWorkload } from './pitcherWorkload.js';
import { PROP_BY_KEY } from '../../shared/props.js';

/** Statuses that still need live tracking. */
const OPEN_STATUSES = ['PENDING', 'LIVE'];

interface Poller {
  gamePk: number;
  timer: NodeJS.Timeout;
  intervalMs: number;
  lastStatus: GameSnapshot['status'] | null;
  lastError: string | null;
  lastPolledAt: number | null;
}

const pollers = new Map<number, Poller>();
let io: SocketServer | null = null;

/**
 * Total MLB feed requests made since boot. Exposed on the status endpoint so
 * the spec §27 guarantee is measurable: this must tick up once per game per
 * poll, never once per bet.
 */
let feedRequests = 0;

export function attachSocket(server: SocketServer): void {
  io = server;
}

export function pollerStats() {
  return {
    activeGames: pollers.size,
    feedRequests,
    games: [...pollers.values()].map((p) => ({
      gamePk: p.gamePk,
      intervalMs: p.intervalMs,
      status: p.lastStatus,
      lastPolledAt: p.lastPolledAt,
      lastError: p.lastError,
    })),
  };
}

async function fetchFeed(gamePk: number): Promise<any> {
  feedRequests += 1;
  if (isDemoGame(gamePk)) {
    advanceDemo();
    return buildDemoFeed();
  }
  return getGameFeed(gamePk);
}

/**
 * Poll one game and settle every bet attached to it. This is the ONLY place
 * that talks to the feed, so N bets cost 1 request.
 */
export async function pollGame(gamePk: number): Promise<void> {
  const poller = pollers.get(gamePk);
  let feed: any;
  try {
    feed = await fetchFeed(gamePk);
    if (poller) poller.lastError = null;
  } catch (err) {
    const message = (err as Error).message;
    if (poller) poller.lastError = message;
    console.error(`[poll ${gamePk}] ${message}`);
    io?.emit('poll:error', { gamePk, error: message });
    return;
  }

  const snapshot = extractGameSnapshot(feed);
  if (poller) {
    poller.lastStatus = snapshot.status;
    poller.lastPolledAt = Date.now();
  }

  await prisma.game.update({
    where: { gamePk },
    data: {
      status: snapshot.status,
      detailedState: snapshot.detailedState,
      homeScore: snapshot.homeScore,
      awayScore: snapshot.awayScore,
      inning: snapshot.inning,
      inningState: snapshot.inningState,
      outs: snapshot.outs,
      balls: snapshot.balls,
      strikes: snapshot.strikes,
      onFirst: snapshot.onFirst,
      onSecond: snapshot.onSecond,
      onThird: snapshot.onThird,
      currentPitcherId: snapshot.currentPitcherId,
      currentPitcherName: snapshot.currentPitcherName,
    },
  }).catch(() => { /* game row may have been deleted mid-poll */ });

  const bets = await prisma.bet.findMany({
    where: { gamePk, status: { in: OPEN_STATUSES } },
    include: { player: true },
  });

  // One extraction per distinct player, reused across that player's bets
  // (spec §12: multiple props on one player share a single stat pull).
  const stateByPlayer = new Map<number, ReturnType<typeof extractPlayerState>>();
  const updated: unknown[] = [];

  for (const bet of bets) {
    let state = stateByPlayer.get(bet.playerId);
    if (!state) {
      state = extractPlayerState(feed, bet.playerId, snapshot);
      stateByPlayer.set(bet.playerId, state);
    }

    let evaluation;
    try {
      evaluation = evaluateBet(bet, state, snapshot);
    } catch (err) {
      console.error(`[poll ${gamePk}] bet ${bet.id}: ${(err as Error).message}`);
      continue;
    }

    // Live chance this leg finishes a winner, re-simulated every poll from the
    // updated game state (spec: "% to win, changing live").
    let odds = { probability: 0, chancesLeft: 0, decided: false };
    try {
      odds = await estimateWinProbability(
        { ...bet, status: evaluation.status, currentValue: evaluation.currentValue },
        state,
        snapshot,
        bet.playerId,
      );
    } catch (err) {
      console.error(`[poll ${gamePk}] win prob for ${bet.id}: ${(err as Error).message}`);
    }

    // Pitching legs also get a read on how much longer he's likely to go.
    let workload: { moreInnings: number; note: string; shortLeash: boolean } | null = null;
    if (PROP_BY_KEY[bet.betType]?.category === 'pitching') {
      try {
        const w = await projectWorkload(
          bet.playerId,
          {
            outs: state.pitching.outs,
            pitches: state.pitching.pitches,
            earnedRuns: state.pitching.earnedRuns,
          },
          snapshot.status === 'Live',
        );
        workload = { moreInnings: w.moreInnings, note: w.note, shortLeash: w.shortLeash };
      } catch (err) {
        console.error(`[poll ${gamePk}] workload for ${bet.id}: ${(err as Error).message}`);
      }
    }

    const statsSnapshot = JSON.stringify({
      batting: state.batting,
      pitching: state.pitching,
      found: state.found,
      position: state.positionAbbrev,
      isCurrentPitcher: state.isCurrentPitcher,
    });

    const changed =
      bet.currentValue !== evaluation.currentValue ||
      bet.status !== evaluation.status ||
      bet.progress !== evaluation.progress ||
      bet.battingStatus !== state.battingStatus.status ||
      bet.battersAway !== (state.battingStatus.battersAway ?? null) ||
      bet.expectedInning !== (state.battingStatus.expectedInning ?? null) ||
      bet.expectedInningsLeft !== (workload?.moreInnings ?? null) ||
      bet.statsSnapshot !== statsSnapshot ||
      Math.abs((bet.winProbability ?? -1) - odds.probability) > 0.005;

    if (!changed) continue;

    const settled = ['WON', 'LOST', 'PUSH'].includes(evaluation.status);
    const next = await prisma.bet.update({
      where: { id: bet.id },
      data: {
        currentValue: evaluation.currentValue,
        status: evaluation.status,
        progress: evaluation.progress,
        statsSnapshot,
        battingStatus: state.battingStatus.status,
        battersAway: state.battingStatus.battersAway ?? null,
        expectedInning: state.battingStatus.expectedInning ?? null,
        expectedHalf: state.battingStatus.expectedHalf ?? null,
        expectedInningsLeft: workload?.moreInnings ?? null,
        workloadNote: workload?.note || null,
        shortLeash: workload?.shortLeash ?? false,
        winProbability: odds.probability,
        chancesLeft: odds.chancesLeft,
        settledAt: settled ? bet.settledAt ?? new Date() : null,
      },
      include: { player: true, game: true },
    });
    updated.push(next);
  }

  if (updated.length > 0) {
    const parlays = await refreshParlaysFor(updated.map((b: any) => b.id));
    if (parlays.length > 0) io?.emit('parlays:update', parlays);
  }

  io?.emit('game:update', {
    gamePk,
    snapshot,
    battingStatuses: Object.fromEntries(
      [...stateByPlayer.entries()].map(([id, s]) => [id, s.battingStatus]),
    ),
  });
  if (updated.length > 0) io?.emit('bets:update', updated);

  // A finished game with nothing left to settle needs no more requests.
  if (snapshot.status === 'Final') {
    const remaining = await prisma.bet.count({
      where: { gamePk, status: { in: OPEN_STATUSES } },
    });
    if (remaining === 0) stopPolling(gamePk);
  }
}

function intervalFor(status: GameSnapshot['status'] | null): number {
  const s = getSettings();
  return status === 'Live' ? s.livePollIntervalMs : s.previewPollIntervalMs;
}

function startPolling(gamePk: number, status: GameSnapshot['status'] | null): void {
  if (pollers.has(gamePk)) return;
  const intervalMs = intervalFor(status);
  const poller: Poller = {
    gamePk,
    timer: setInterval(() => { void tick(gamePk); }, intervalMs),
    intervalMs,
    lastStatus: status,
    lastError: null,
    lastPolledAt: null,
  };
  pollers.set(gamePk, poller);
  console.log(`[poll] start game ${gamePk} every ${intervalMs}ms`);
  void pollGame(gamePk); // fire immediately so the card isn't blank
}

/**
 * Poll, then re-time if the game changed state -- a Preview game that starts
 * should speed up to the live cadence without waiting for the next sync().
 */
async function tick(gamePk: number): Promise<void> {
  await pollGame(gamePk);
  const poller = pollers.get(gamePk);
  if (!poller) return;
  const want = intervalFor(poller.lastStatus);
  if (want !== poller.intervalMs) {
    clearInterval(poller.timer);
    poller.intervalMs = want;
    poller.timer = setInterval(() => { void tick(gamePk); }, want);
    console.log(`[poll] game ${gamePk} -> ${want}ms (${poller.lastStatus})`);
  }
}

export function stopPolling(gamePk: number): void {
  const poller = pollers.get(gamePk);
  if (!poller) return;
  clearInterval(poller.timer);
  pollers.delete(gamePk);
  console.log(`[poll] stop game ${gamePk}`);
}

export function stopAll(): void {
  for (const gamePk of [...pollers.keys()]) stopPolling(gamePk);
}

/**
 * Reconcile pollers against the bets in the database. Called at boot, after
 * any bet is added or removed, and whenever the poll interval changes.
 */
export async function syncPollers(): Promise<void> {
  const rows = await prisma.bet.groupBy({
    by: ['gamePk'],
    where: { status: { in: OPEN_STATUSES } },
  });
  const wanted = new Set(rows.map((r) => r.gamePk));

  for (const gamePk of [...pollers.keys()]) {
    if (!wanted.has(gamePk)) stopPolling(gamePk);
  }
  for (const gamePk of wanted) {
    if (!pollers.has(gamePk)) {
      const game = await prisma.game.findUnique({ where: { gamePk } });
      startPolling(gamePk, (game?.status as GameSnapshot['status']) ?? null);
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
    poller.timer = setInterval(() => { void tick(poller.gamePk); }, want);
  }
}
