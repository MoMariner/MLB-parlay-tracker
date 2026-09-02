/** Bet CRUD (spec §10, §11, §12, §22) + the prop catalog. */

import { Router } from 'express';
import { prisma } from '../db.js';
import { getPlayer, getSchedule, getGameFeed } from '../services/mlbApi.js';
import { extractGameSnapshot } from '../services/statExtractor.js';
import { pollGame, syncPollers } from '../services/gamePollingManager.js';
import { PROPS, PROP_BY_KEY, BET_SOURCES } from '../../shared/props.js';
import { buildDemoFeed, isDemoGame, DEMO_PLAYERS, DEMO_PITCHER, DEMO_TEAM_HOME } from '../services/demoMode.js';

export const betsRouter = Router();

const OPEN = ['PENDING', 'LIVE'];
const SETTLED = ['WON', 'LOST', 'PUSH', 'VOID'];
const VALID_SOURCES = new Set(BET_SOURCES.map((s) => s.key));

/** Catalog for the bet-type picker. */
betsRouter.get('/props', (_req, res) => {
  res.json({ props: PROPS, sources: BET_SOURCES });
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
 * Ensure Player and Game rows exist for a new bet. Shared across bets, so a
 * second prop on the same player/game reuses them rather than duplicating.
 */
async function upsertPlayer(playerId: number) {
  if (isDemoGame(playerId) || playerId < 0) {
    const demo = [...DEMO_PLAYERS.map((p) => ({ ...p, type: p.type })), { ...DEMO_PITCHER, slot: 0 }]
      .find((p) => p.id === playerId);
    if (!demo) throw new Error('Unknown demo player');
    const data = {
      fullName: demo.fullName, teamId: DEMO_TEAM_HOME.id, teamName: DEMO_TEAM_HOME.name,
      teamAbbrev: DEMO_TEAM_HOME.abbreviation, position: demo.position, positionType: demo.type,
    };
    return prisma.player.upsert({ where: { id: playerId }, create: { id: playerId, ...data }, update: data });
  }

  const p = await getPlayer(playerId);
  if (!p) throw new Error(`Player ${playerId} not found in MLB data`);
  const data = {
    fullName: p.fullName, teamId: p.teamId, teamName: p.teamName,
    teamAbbrev: p.teamAbbrev, position: p.position, positionType: p.positionType,
  };
  return prisma.player.upsert({ where: { id: playerId }, create: { id: playerId, ...data }, update: data });
}

async function upsertGame(gamePk: number) {
  const feed = isDemoGame(gamePk) ? buildDemoFeed() : await getGameFeed(gamePk);
  const s = extractGameSnapshot(feed);
  const data = {
    gameDate: s.gameDate ? new Date(s.gameDate) : new Date(),
    officialDate: (s.gameDate || new Date().toISOString()).slice(0, 10),
    status: s.status, detailedState: s.detailedState,
    homeTeamId: s.homeTeamId, homeName: s.homeName, homeAbbrev: s.homeAbbrev,
    awayTeamId: s.awayTeamId, awayName: s.awayName, awayAbbrev: s.awayAbbrev,
    homeScore: s.homeScore, awayScore: s.awayScore,
    inning: s.inning, inningState: s.inningState, outs: s.outs,
    balls: s.balls, strikes: s.strikes,
    onFirst: s.onFirst, onSecond: s.onSecond, onThird: s.onThird,
    currentPitcherId: s.currentPitcherId, currentPitcherName: s.currentPitcherName,
  };
  const game = await prisma.game.upsert({ where: { gamePk }, create: { gamePk, ...data }, update: data });
  return { game, snapshot: s };
}

betsRouter.post('/', async (req, res) => {
  const {
    playerId, gamePk, betType, direction, line,
    source = 'manual', odds = null, stake = null, allowFinal = false,
  } = req.body ?? {};

  // ---- validation (spec §8: the line must be a real number) ----
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
    const { game, snapshot } = await upsertGame(pk);

    // Spec §3 -- a finished game can't quietly become a new live bet.
    if (snapshot.status === 'Final' && !allowFinal) {
      return res.status(409).json({
        error: 'That game is already final. Re-submit with allowFinal to log it anyway.',
        code: 'GAME_FINAL',
      });
    }

    await upsertPlayer(pid);

    const bet = await prisma.bet.create({
      data: {
        playerId: pid,
        gamePk: pk,
        teamId: game.homeTeamId, // corrected below once the feed places the player
        betType, source, direction, line: lineNum,
        odds: oddsNum, stake: stakeNum,
        status: snapshot.status === 'Preview' ? 'PENDING' : 'LIVE',
      },
      include: { player: true, game: true },
    });

    // Fix teamId from the player record when MLB knows their club.
    if (bet.player.teamId && bet.player.teamId !== bet.teamId) {
      await prisma.bet.update({ where: { id: bet.id }, data: { teamId: bet.player.teamId } });
    }

    // Evaluate immediately so the card shows real numbers, then make sure the
    // shared poller for this game is running.
    await pollGame(pk);
    await syncPollers();

    const fresh = await prisma.bet.findUnique({
      where: { id: bet.id },
      include: { player: true, game: true },
    });
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
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Line must be a valid number' });
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
      await pollGame(bet.gamePk).catch(() => {});
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
    res.json({ ok: true, gamePk: bet.gamePk });
  } catch {
    res.status(404).json({ error: 'Bet not found' });
  }
});

export { upsertGame, upsertPlayer };
