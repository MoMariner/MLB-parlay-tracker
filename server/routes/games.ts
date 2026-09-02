/** Schedule + single-game lookup (spec §3, §19). */

import { Router } from 'express';
import { getSchedule, getGameFeed, isoDate } from '../services/mlbApi.js';
import { extractGameSnapshot } from '../services/statExtractor.js';
import { buildDemoFeed, isDemoGame } from '../services/demoMode.js';

export const gamesRouter = Router();

gamesRouter.get('/', async (req, res) => {
  const start = String(req.query.startDate ?? req.query.date ?? isoDate(0));
  const end = String(req.query.endDate ?? req.query.date ?? isoDate(0));
  const teamId = req.query.teamId ? Number(req.query.teamId) : undefined;
  try {
    res.json({ games: await getSchedule(start, end, teamId) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

gamesRouter.get('/:gamePk', async (req, res) => {
  const gamePk = Number(req.params.gamePk);
  if (!Number.isFinite(gamePk)) return res.status(400).json({ error: 'Invalid gamePk' });
  try {
    const feed = isDemoGame(gamePk) ? buildDemoFeed() : await getGameFeed(gamePk);
    res.json({ game: extractGameSnapshot(feed) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
