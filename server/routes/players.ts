/** Player search + selection + their games (spec §1, §2, §3). */

import { Router } from 'express';
import { searchPlayers, getPlayer, getPlayerGames } from '../services/mlbApi.js';
import { categoriesForPosition, propsFor } from '../../shared/props.js';
import { getSettings } from '../services/settings.js';
import { DEMO_PLAYERS, DEMO_PITCHER, DEMO_TEAM_HOME, DEMO_GAME_PK, buildDemoFeed } from '../services/demoMode.js';

export const playersRouter = Router();

function demoRoster() {
  return [
    ...DEMO_PLAYERS.map((p) => ({
      id: p.id, fullName: p.fullName,
      teamId: DEMO_TEAM_HOME.id, teamName: DEMO_TEAM_HOME.name, teamAbbrev: DEMO_TEAM_HOME.abbreviation,
      position: p.position, positionType: p.type, active: true, jerseyNumber: String(p.slot),
    })),
    {
      id: DEMO_PITCHER.id, fullName: DEMO_PITCHER.fullName,
      teamId: DEMO_TEAM_HOME.id, teamName: DEMO_TEAM_HOME.name, teamAbbrev: DEMO_TEAM_HOME.abbreviation,
      position: DEMO_PITCHER.position, positionType: DEMO_PITCHER.type, active: true, jerseyNumber: '1',
    },
  ];
}

playersRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ players: [] });

  try {
    const real = await searchPlayers(q);
    // In demo mode the fake roster is offered alongside real players so the
    // whole flow is exercisable with no live games on the schedule.
    const demo = getSettings().demoMode
      ? demoRoster().filter((p) => p.fullName.toLowerCase().includes(q.toLowerCase()))
      : [];
    res.json({ players: [...demo, ...real] });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

playersRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid player id' });

  if (id < 0) {
    const p = demoRoster().find((d) => d.id === id);
    return p ? res.json({ player: p }) : res.status(404).json({ error: 'Demo player not found' });
  }

  try {
    const player = await getPlayer(id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json({ player });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/** Spec §3 -- the player's upcoming/live games, chronologically. */
playersRouter.get('/:id/games', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid player id' });

  if (id < 0) {
    const feed = buildDemoFeed();
    const gd = feed.gameData;
    const ls = feed.liveData.linescore;
    return res.json({
      games: [{
        gamePk: DEMO_GAME_PK,
        gameDate: gd.datetime.dateTime,
        officialDate: gd.datetime.dateTime.slice(0, 10),
        status: gd.status.abstractGameState,
        detailedState: gd.status.detailedState,
        homeTeamId: gd.teams.home.id, homeName: gd.teams.home.name, homeAbbrev: gd.teams.home.abbreviation,
        awayTeamId: gd.teams.away.id, awayName: gd.teams.away.name, awayAbbrev: gd.teams.away.abbreviation,
        homeScore: ls.teams.home.runs, awayScore: ls.teams.away.runs,
        inning: ls.currentInning, inningState: ls.inningState,
      }],
    });
  }

  try {
    res.json({ games: await getPlayerGames(id) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * Spec §13/§14 -- prop menu tailored to the player's position, so a pitcher
 * never sees batting props first and nobody picks "batter or pitcher" by hand.
 */
playersRouter.get('/:id/props', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid player id' });

  try {
    let position: string | null = null;
    let positionType: string | null = null;

    if (id < 0) {
      const p = demoRoster().find((d) => d.id === id);
      position = p?.position ?? null;
      positionType = p?.positionType ?? null;
    } else {
      const player = await getPlayer(id);
      if (!player) return res.status(404).json({ error: 'Player not found' });
      position = player.position;
      positionType = player.positionType;
    }

    const categories = categoriesForPosition(position, positionType);
    res.json({
      position,
      positionType,
      categories: categories.map((c) => ({
        category: c,
        label: c === 'pitching' ? 'Pitching Props' : 'Batting Props',
        props: propsFor(c),
      })),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
