/** Slip CRUD. A straight single bet is just a one-leg slip; slips may mix sports. */

import { Router } from 'express';
import { prisma } from '../db.js';
import { PROP_BY_KEY, BET_SOURCES, sportOf, type Sport } from '../../shared/props.js';
import { pollGame, syncPollers } from '../services/gamePollingManager.js';
import { listParlays, refreshParlay } from '../services/parlays.js';
import { upsertGame, upsertPlayer } from './bets.js';
import { isSport } from '../sports/index.js';

export const parlaysRouter = Router();

const VALID_SOURCES = new Set<string>(BET_SOURCES.map((s) => s.key));

parlaysRouter.get('/', async (req, res) => {
  const scope = String(req.query.scope ?? 'open') as 'open' | 'settled' | 'all';
  res.json({ parlays: await listParlays(scope) });
});

/** Validate one leg before anything is written. */
function validateLeg(leg: any): string | null {
  const sport: Sport = leg?.sport ?? 'mlb';
  if (!isSport(sport)) return `Unknown sport: ${leg?.sport}`;
  const def = PROP_BY_KEY[leg?.betType];
  if (!def) return `Unknown bet type: ${leg?.betType}`;
  if (sportOf(def) !== sport) return `${def.label} isn't a ${sport.toUpperCase()} bet`;
  if (!Number.isFinite(Number(leg?.gamePk))) return 'Each leg needs a game';

  const line = Number(leg?.line ?? 0);
  if (!Number.isFinite(line)) return 'Line must be a valid number';

  // Number(null) is 0, which is finite -- so check for a missing id explicitly.
  const missing = (v: unknown) => v == null || v === '' || !Number.isFinite(Number(v));
  if (def.scope !== 'game' && missing(leg?.playerId)) return 'Each player prop needs a player';
  if ((def.sides === 'team' || def.sides === 'teamOverUnder') && missing(leg?.teamId)) {
    return `${def.label} needs a team`;
  }
  if (def.sides === 'team') {
    if (leg?.direction !== 'TEAM') return 'Spread and moneyline legs pick a team';
  } else {
    if (leg?.direction !== 'OVER' && leg?.direction !== 'UNDER') return 'Direction must be OVER or UNDER';
    if (line < 0) return 'Line cannot be negative';
  }
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
      const sport: Sport = leg.sport ?? 'mlb';
      const def = PROP_BY_KEY[leg.betType]!;
      const pk = Number(leg.gamePk);
      const { game, snapshot } = await upsertGame(sport, pk);
      if (snapshot.status === 'Final' && !allowFinal) {
        return res.status(409).json({
          error: `${game.awayAbbrev} @ ${game.homeAbbrev} is already final.`,
          code: 'GAME_FINAL',
        });
      }
      const teamId = leg.teamId != null ? Number(leg.teamId) : null;
      if (teamId != null && teamId !== game.homeTeamId && teamId !== game.awayTeamId) {
        return res.status(400).json({ error: `That team isn't playing in ${game.awayAbbrev} @ ${game.homeAbbrev}` });
      }
      const player = def.scope === 'game' ? null : await upsertPlayer(sport, Number(leg.playerId));
      resolved.push({ leg, def, sport, game, snapshot, player, pk, teamId });
    }

    const parlay = await prisma.parlay.create({
      data: {
        name: name || null,
        source,
        odds: oddsNum,
        stake: stakeNum,
        payout: payoutNum,
        bets: {
          create: resolved.map(({ leg, def, sport, game, snapshot, player, pk, teamId }) => ({
            sport,
            playerKey: player?.key ?? null,
            playerId: player ? Number(leg.playerId) : null,
            gameKey: game.key,
            gamePk: pk,
            teamId: def.scope === 'game' ? teamId : (player?.teamId ?? null),
            betType: leg.betType,
            source,
            direction: leg.direction,
            line: def.sides === 'team' && !def.handicap ? 0 : Number(leg.line ?? 0),
            status: snapshot.status === 'Preview' ? 'PENDING' : 'LIVE',
          })),
        },
      },
    });

    // Grade each distinct game once so the card shows real numbers now.
    for (const key of [...new Set(resolved.map((r) => r.game.key))]) {
      await pollGame(key).catch(() => {});
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
