/** Slip CRUD. A straight single bet is just a one-leg slip. */

import { Router } from 'express';
import { prisma } from '../db.js';
import { PROP_BY_KEY, BET_SOURCES } from '../../shared/props.js';
import { pollGame, syncPollers } from '../services/gamePollingManager.js';
import { listParlays, refreshParlay } from '../services/parlays.js';
import { upsertGame, upsertPlayer } from './bets.js';

export const parlaysRouter = Router();

const VALID_SOURCES = new Set(BET_SOURCES.map((s) => s.key));

parlaysRouter.get('/', async (req, res) => {
  const scope = String(req.query.scope ?? 'open') as 'open' | 'settled' | 'all';
  res.json({ parlays: await listParlays(scope) });
});

/** Validate one leg before anything is written. */
function validateLeg(leg: any): string | null {
  if (!Number.isFinite(Number(leg?.playerId))) return 'Each leg needs a player';
  if (!Number.isFinite(Number(leg?.gamePk))) return 'Each leg needs a game';
  if (!PROP_BY_KEY[leg?.betType]) return `Unknown bet type: ${leg?.betType}`;
  if (leg?.direction !== 'OVER' && leg?.direction !== 'UNDER') return 'Direction must be OVER or UNDER';
  const line = Number(leg?.line);
  if (!Number.isFinite(line)) return 'Line must be a valid number';
  if (line < 0) return 'Line cannot be negative';
  return null;
}

parlaysRouter.post('/', async (req, res) => {
  const { name = null, source = 'manual', odds = null, stake = null, payout = null, legs, allowFinal = false } = req.body ?? {};

  if (!Array.isArray(legs) || legs.length === 0) {
    return res.status(400).json({ error: 'A slip needs at least one leg' });
  }
  if (!VALID_SOURCES.has(source)) return res.status(400).json({ error: `Unknown source: ${source}` });

  for (const leg of legs) {
    const problem = validateLeg(leg);
    if (problem) return res.status(400).json({ error: problem });
  }

  const oddsNum = odds === null || odds === '' ? null : Number(odds);
  if (oddsNum !== null && (!Number.isFinite(oddsNum) || Math.abs(oddsNum) < 100)) {
    return res.status(400).json({ error: 'Odds must be American format, e.g. -120 or +150' });
  }
  const stakeNum = stake === null || stake === '' ? null : Number(stake);
  if (stakeNum !== null && (!Number.isFinite(stakeNum) || stakeNum < 0)) {
    return res.status(400).json({ error: 'Stake must be a positive number' });
  }
  const payoutNum = payout === null || payout === '' ? null : Number(payout);
  if (payoutNum !== null && (!Number.isFinite(payoutNum) || payoutNum < 0)) {
    return res.status(400).json({ error: 'Payout must be a positive number' });
  }

  try {
    // Resolve every game and player up front, so a bad leg fails the whole
    // slip before any of it is written.
    const resolved = [];
    for (const leg of legs) {
      const pk = Number(leg.gamePk);
      const pid = Number(leg.playerId);
      const { game, snapshot } = await upsertGame(pk);
      if (snapshot.status === 'Final' && !allowFinal) {
        return res.status(409).json({
          error: `${game.awayAbbrev} @ ${game.homeAbbrev} is already final.`,
          code: 'GAME_FINAL',
        });
      }
      const player = await upsertPlayer(pid);
      resolved.push({ leg, game, snapshot, player, pk, pid });
    }

    const parlay = await prisma.parlay.create({
      data: {
        name: name || null,
        source,
        odds: oddsNum,
        stake: stakeNum,
        payout: payoutNum,
        bets: {
          create: resolved.map(({ leg, player, snapshot, pk, pid }) => ({
            playerId: pid,
            gamePk: pk,
            teamId: player.teamId ?? 0,
            betType: leg.betType,
            source,
            direction: leg.direction,
            line: Number(leg.line),
            status: snapshot.status === 'Preview' ? 'PENDING' : 'LIVE',
          })),
        },
      },
      include: { bets: true },
    });

    // Evaluate each distinct game once so the card shows real numbers now.
    for (const gamePk of [...new Set(resolved.map((r) => r.pk))]) {
      await pollGame(gamePk).catch(() => {});
    }
    await syncPollers();

    res.status(201).json({ parlay: await refreshParlay(parlay.id) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

parlaysRouter.patch('/:id', async (req, res) => {
  const { name, odds, stake, payout } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name || null;

  for (const [field, raw] of [['odds', odds], ['stake', stake], ['payout', payout]] as const) {
    if (raw === undefined) continue;
    if (raw === null || raw === '') { data[field] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) return res.status(400).json({ error: `${field} must be a number` });
    if (field !== 'odds' && n < 0) return res.status(400).json({ error: `${field} cannot be negative` });
    data[field] = field === 'odds' ? Math.round(n) : n;
  }

  try {
    await prisma.parlay.update({ where: { id: req.params.id }, data });
    res.json({ parlay: await refreshParlay(req.params.id) });
  } catch {
    res.status(404).json({ error: 'Slip not found' });
  }
});

/** Deleting a slip removes its legs (schema cascades). */
parlaysRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.parlay.delete({ where: { id: req.params.id } });
    await syncPollers();
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Slip not found' });
  }
});

/** Drop one leg. If it was the last, the slip goes too. */
parlaysRouter.delete('/:id/legs/:betId', async (req, res) => {
  try {
    await prisma.bet.delete({ where: { id: req.params.betId } });
    const left = await prisma.bet.count({ where: { parlayId: req.params.id } });
    if (left === 0) {
      await prisma.parlay.delete({ where: { id: req.params.id } });
      await syncPollers();
      return res.json({ ok: true, parlay: null });
    }
    await syncPollers();
    res.json({ ok: true, parlay: await refreshParlay(req.params.id) });
  } catch {
    res.status(404).json({ error: 'Leg not found' });
  }
});
