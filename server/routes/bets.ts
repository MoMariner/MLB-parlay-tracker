/** Bet CRUD + the prop catalog. Player and Game rows are shared across bets. */

import { Router } from 'express';
import { prisma } from '../db.js';
import { getPlayer } from '../services/mlbApi.js';
import { nflGetPlayer } from '../nfl/espnApi.js';
import { pollGame, syncPollers } from '../services/gamePollingManager.js';
import { ALL_PROPS, PROP_BY_KEY, BET_SOURCES, type Sport } from '../../shared/props.js';
import { buildDemoFeed, DEMO_PLAYERS, DEMO_PITCHER, DEMO_TEAM_HOME } from '../services/demoMode.js';
import { adapterFor, gameKey, playerKey } from '../sports/index.js';

export const betsRouter = Router();

const OPEN = ['PENDING', 'LIVE'];
const SETTLED = ['WON', 'LOST', 'PUSH', 'VOID'];
const VALID_SOURCES = new Set<string>(BET_SOURCES.map((s) => s.key));

/** Catalog for the bet-type picker, every sport. */
betsRouter.get('/props', (_req, res) => {
  res.json({ props: ALL_PROPS, sources: BET_SOURCES });
});

betsRouter.get('/', async (req, res) => {
  const scope = String(req.query.scope ?? 'open');
  const where =
    scope === 'settled' ? { status: { in: SETTLED } }
    : scope === 'all' ? {}
    : { status: { in: OPEN } };

  const bets = await prisma.bet.findMany({
    where,
    include: { player: true, game: true },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ bets });
});

/**
 * Ensure a Player row exists. Shared across bets, so a second prop on the
 * same player reuses it rather than duplicating.
 */
export async function upsertPlayer(sport: Sport, playerId: number) {
  const key = playerKey(sport, playerId);
  let data: {
    fullName: string; teamId: number | null; teamName: string | null;
    teamAbbrev: string | null; position: string | null; positionType: string | null;
  };

  if (sport === 'nfl') {
    const p = await nflGetPlayer(playerId);
    if (!p) throw new Error(`Player ${playerId} not found in NFL data`);
    data = {
      fullName: p.fullName, teamId: p.teamId, teamName: p.teamName,
      teamAbbrev: p.teamAbbrev, position: p.position, positionType: p.positionType,
    };
  } else if (playerId < 0) {
    const demo = [...DEMO_PLAYERS, { ...DEMO_PITCHER, slot: 0 }].find((p) => p.id === playerId);
    if (!demo) throw new Error('Unknown demo player');
    data = {
      fullName: demo.fullName, teamId: DEMO_TEAM_HOME.id, teamName: DEMO_TEAM_HOME.name,
      teamAbbrev: DEMO_TEAM_HOME.abbreviation, position: demo.position, positionType: demo.type,
    };
  } else {
    const p = await getPlayer(playerId);
    if (!p) throw new Error(`Player ${playerId} not found in MLB data`);
    data = {
      fullName: p.fullName, teamId: p.teamId, teamName: p.teamName,
      teamAbbrev: p.teamAbbrev, position: p.position, positionType: p.positionType,
    };
  }

  return prisma.player.upsert({
    where: { key },
    create: { key, sport, id: playerId, ...data },
    update: data,
  });
}

/** Ensure a Game row exists and is current; returns it with the live snapshot. */
export async function upsertGame(sport: Sport, gamePk: number) {
  const adapter = adapterFor(sport);
  // Reading the demo game must not advance its simulated clock.
  const feed = sport === 'mlb' && gamePk < 0 ? buildDemoFeed() : await adapter.fetchFeed(gamePk);
  const snapshot = adapter.snapshot(feed);
  const data = adapter.gameRow(snapshot);
  const key = gameKey(sport, gamePk);
  const game = await prisma.game.upsert({
    where: { key },
    create: { key, sport, gamePk, ...(data as any) },
    update: data,
  });
  return { game, snapshot };
}

/** Single MLB bet (the slip endpoint in routes/parlays.ts is the main path). */
betsRouter.post('/', async (req, res) => {
  const {
    playerId, gamePk, betType, direction, line,
    source = 'manual', odds = null, stake = null, allowFinal = false,
  } = req.body ?? {};

  const pid = Number(playerId);
  const pk = Number(gamePk);
  const lineNum = Number(line);

  if (!Number.isFinite(pid)) return res.status(400).json({ error: 'A player is required' });
  if (!Number.isFinite(pk)) return res.status(400).json({ error: 'A game is required' });
  if (!PROP_BY_KEY[betType]) return res.status(400).json({ error: `Unknown bet type: ${betType}` });
  if (direction !== 'OVER' && direction !== 'UNDER') {
    return res.status(400).json({ error: 'Direction must be OVER or UNDER' });
  }
  if (!Number.isFinite(lineNum)) return res.status(400).json({ error: 'Line must be a valid number' });
  if (lineNum < 0) return res.status(400).json({ error: 'Line cannot be negative' });
  if (!VALID_SOURCES.has(source)) return res.status(400).json({ error: `Unknown source: ${source}` });

  const oddsNum = odds === null || odds === '' ? null : Number(odds);
  if (oddsNum !== null && (!Number.isFinite(oddsNum) || Math.abs(oddsNum) < 100)) {
    return res.status(400).json({ error: 'Odds must be American format, e.g. -120 or +150' });
  }
  const stakeNum = stake === null || stake === '' ? null : Number(stake);
  if (stakeNum !== null && (!Number.isFinite(stakeNum) || stakeNum < 0)) {
    return res.status(400).json({ error: 'Stake must be a positive number' });
  }

  try {
    const { game, snapshot } = await upsertGame('mlb', pk);
    if (snapshot.status === 'Final' && !allowFinal) {
      return res.status(409).json({
        error: 'That game is already final. Re-submit with allowFinal to log it anyway.',
        code: 'GAME_FINAL',
      });
    }
    const player = await upsertPlayer('mlb', pid);

    const bet = await prisma.bet.create({
      data: {
        sport: 'mlb',
        playerKey: player.key,
        playerId: pid,
        gameKey: game.key,
        gamePk: pk,
        teamId: player.teamId ?? game.homeTeamId,
        betType, source, direction, line: lineNum,
        odds: oddsNum, stake: stakeNum,
        status: snapshot.status === 'Preview' ? 'PENDING' : 'LIVE',
      },
    });

    await pollGame(game.key);
    await syncPollers();

    const fresh = await prisma.bet.findUnique({ where: { id: bet.id }, include: { player: true, game: true } });
    res.status(201).json({ bet: fresh });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

betsRouter.patch('/:id', async (req, res) => {
  const { line, odds, stake, status } = req.body ?? {};
  const data: Record<string, unknown> = {};

  if (line !== undefined) {
    const n = Number(line);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'Line must be a valid number' });
    data.line = n;
  }
  if (odds !== undefined) data.odds = odds === null || odds === '' ? null : Number(odds);
  if (stake !== undefined) data.stake = stake === null || stake === '' ? null : Number(stake);
  if (status !== undefined) {
    if (![...OPEN, ...SETTLED].includes(status)) return res.status(400).json({ error: 'Unknown status' });
    data.status = status;
    data.settledAt = SETTLED.includes(status) ? new Date() : null;
  }

  try {
    const bet = await prisma.bet.update({
      where: { id: req.params.id }, data, include: { player: true, game: true },
    });
    if (data.line !== undefined || data.status !== undefined) {
      await pollGame(bet.gameKey).catch(() => {});
      await syncPollers();
    }
    res.json({ bet });
  } catch {
    res.status(404).json({ error: 'Bet not found' });
  }
});

betsRouter.delete('/:id', async (req, res) => {
  try {
    const bet = await prisma.bet.delete({ where: { id: req.params.id } });
    await syncPollers();
    res.json({ ok: true, gameKey: bet.gameKey });
  } catch {
    res.status(404).json({ error: 'Bet not found' });
  }
});
