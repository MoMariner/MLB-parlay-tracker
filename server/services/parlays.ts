/**
 * Slip-level rollup: a parlay's status and win probability are derived from
 * its legs, never stored independently, so they can't drift out of sync.
 */

import { prisma } from '../db.js';
import { correlatedParlayProbability, type CorrelatedLeg } from './correlation.js';
import { PROP_BY_KEY } from '../../shared/props.js';

/** Samples kept per slip -- enough for a readable sparkline, not a log. */
const MAX_POINTS = 60;
/** Probability move (in absolute terms) worth recording. */
const MIN_MOVE = 0.005;

const SETTLED = ['WON', 'LOST', 'PUSH', 'VOID'];

export interface ParlayRollup {
  status: string;
  winProbability: number;
}

/**
 * A slip needs every leg to hit, so one dead leg kills it immediately -- no
 * waiting for the other games to finish.
 * PUSH/VOID legs drop out of the slip rather than sinking it.
 */
type RollupLeg = Omit<CorrelatedLeg, 'probability' | 'homeTeamId' | 'awayTeamId'> & {
  status: string;
  winProbability: number | null;
  game: { homeTeamId: number; awayTeamId: number };
};

export function rollUp(legs: RollupLeg[]): ParlayRollup {
  if (legs.length === 0) return { status: 'PENDING', winProbability: 0 };

  if (legs.some((l) => l.status === 'LOST')) return { status: 'LOST', winProbability: 0 };

  const live = legs.filter((l) => !['PUSH', 'VOID'].includes(l.status));
  if (live.length === 0) return { status: 'PUSH', winProbability: 1 };

  if (live.every((l) => l.status === 'WON')) return { status: 'WON', winProbability: 1 };

  const status = live.every((l) => l.status === 'PENDING') ? 'PENDING' : 'LIVE';
  // Legs that share a game move together, so the slip is worth more than the
  // product of its legs -- see correlation.ts.
  const probability = correlatedParlayProbability(live.map((l) => ({
    id: l.id,
    probability: l.status === 'WON' ? 1 : l.winProbability ?? 0,
    betType: l.betType,
    direction: l.direction,
    gameKey: l.gameKey,
    teamId: l.teamId,
    playerKey: l.playerKey,
    homeTeamId: l.game.homeTeamId,
    awayTeamId: l.game.awayTeamId,
  })));
  return { status, winProbability: probability };
}

/**
 * Explain a probability move by diffing each leg against the last sample.
 * A number that jumps without a reason is just noise; naming the leg that
 * moved is what makes the sparkline worth looking at.
 */
type ExplainLeg = {
  id: string;
  betType: string;
  currentValue: number;
  status: string;
  teamId: number | null;
  player: { fullName: string } | null;
  game: { homeTeamId: number; homeAbbrev: string; awayAbbrev: string };
};

/** "Soto", or for a game line the team it's on ("LAR"), or "Total". */
function legName(b: ExplainLeg): string {
  if (b.player) return b.player.fullName.split(' ').slice(-1)[0];
  if (b.teamId == null) return 'Total';
  return b.teamId === b.game.homeTeamId ? b.game.homeAbbrev : b.game.awayAbbrev;
}

function explainMove(
  bets: ExplainLeg[],
  previous: Record<string, number>,
  direction: 'up' | 'down' | 'flat',
): string {
  const moved: string[] = [];

  for (const b of bets) {
    const before = previous[b.id];
    if (before === undefined) continue;
    const delta = b.currentValue - before;
    if (delta === 0) continue;
    const def = PROP_BY_KEY[b.betType];
    // A side's value is its margin; a total's value is points.
    const label = def?.scope === 'game' ? (def.sides === 'team' ? 'margin' : 'pts') : def?.label ?? b.betType;
    const sign = delta > 0 ? '+' : '';
    moved.push(`${legName(b)} ${sign}${Math.round(delta * 10) / 10} ${label}`);
  }

  const justSettled = bets.filter(
    (b) => ['WON', 'LOST'].includes(b.status) && previous[b.id] !== undefined,
  );
  const hits = justSettled.filter((b) => b.status === 'WON').map(legName);
  const misses = justSettled.filter((b) => b.status === 'LOST').map(legName);

  if (misses.length > 0 && direction === 'down') return `${misses.join(', ')} missed`;
  if (moved.length > 0) return moved.slice(0, 2).join(' · ');
  if (hits.length > 0 && direction === 'up') return `${hits.join(', ')} hit`;

  // Nothing in the box score changed, so the move came from the clock: outs
  // and innings burned away chances that were priced in a moment ago.
  if (direction === 'down') return 'Fewer chances left';
  if (direction === 'up') return 'Back in the order sooner';
  return '';
}

/** Recompute one slip from its legs and persist. Returns the fresh row. */
export async function refreshParlay(parlayId: string) {
  const parlay = await prisma.parlay.findUnique({
    where: { id: parlayId },
    include: { bets: { include: { player: true, game: true } } },
  });
  if (!parlay) return null;

  const { status, winProbability } = rollUp(parlay.bets);
  const settled = SETTLED.includes(status);

  const last = await prisma.parlayPoint.findFirst({
    where: { parlayId },
    orderBy: { createdAt: 'desc' },
  });

  const previousProb = last?.probability ?? null;
  const moved = previousProb === null || Math.abs(winProbability - previousProb) >= MIN_MOVE;
  const statusChanged = last != null && parlay.status !== status;

  if (moved || statusChanged) {
    let previousValues: Record<string, number> = {};
    try {
      previousValues = last ? (JSON.parse(last.legValues) as Record<string, number>) : {};
    } catch { previousValues = {}; }

    const direction: 'up' | 'down' | 'flat' =
      previousProb === null ? 'flat'
      : winProbability > previousProb ? 'up'
      : winProbability < previousProb ? 'down' : 'flat';

    await prisma.parlayPoint.create({
      data: {
        parlayId,
        probability: winProbability,
        reason: previousProb === null ? 'Slip added' : explainMove(parlay.bets, previousValues, direction),
        legValues: JSON.stringify(
          Object.fromEntries(parlay.bets.map((b) => [b.id, b.currentValue])),
        ),
      },
    });

    // Trim the tail so a long game doesn't grow this without bound.
    const count = await prisma.parlayPoint.count({ where: { parlayId } });
    if (count > MAX_POINTS) {
      const stale = await prisma.parlayPoint.findMany({
        where: { parlayId },
        orderBy: { createdAt: 'asc' },
        take: count - MAX_POINTS,
        select: { id: true },
      });
      await prisma.parlayPoint.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });
    }
  }

  return prisma.parlay.update({
    where: { id: parlayId },
    data: {
      status,
      winProbability,
      settledAt: settled ? parlay.settledAt ?? new Date() : null,
    },
    include: {
      bets: { include: { player: true, game: true }, orderBy: { createdAt: 'asc' } },
      history: { orderBy: { createdAt: 'asc' }, take: MAX_POINTS },
    },
  });
}

/** Every slip touched by a set of bets, refreshed once each. */
export async function refreshParlaysFor(betIds: string[]) {
  if (betIds.length === 0) return [];
  const rows = await prisma.bet.findMany({
    where: { id: { in: betIds }, parlayId: { not: null } },
    select: { parlayId: true },
  });
  const ids = [...new Set(rows.map((r) => r.parlayId!).filter(Boolean))];
  const out = [];
  for (const id of ids) {
    const p = await refreshParlay(id);
    if (p) out.push(p);
  }
  return out;
}

export async function listParlays(scope: 'open' | 'settled' | 'all') {
  const where =
    scope === 'settled' ? { status: { in: SETTLED } }
    : scope === 'all' ? {}
    : { status: { in: ['PENDING', 'LIVE'] } };

  return prisma.parlay.findMany({
    where,
    include: {
      bets: { include: { player: true, game: true }, orderBy: { createdAt: 'asc' } },
      history: { orderBy: { createdAt: 'asc' }, take: MAX_POINTS },
    },
    orderBy: { createdAt: 'desc' },
  });
}
