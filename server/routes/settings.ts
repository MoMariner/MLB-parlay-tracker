/** Settings screen backend (spec §25): API status, polling, scoring, display. */

import { Router } from 'express';
import { getSettings, saveSettings, saveScoring, resetScoring, getScoringConfigs } from '../services/settings.js';
import { checkApiStatus } from '../services/mlbApi.js';
import { pollerStats, retimeAll, syncPollers } from '../services/gamePollingManager.js';
import { resetDemo } from '../services/demoMode.js';
import { DEFAULT_SCORING } from '../services/fantasyScoring.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json({ settings: getSettings(), scoring: getScoringConfigs(), defaultScoring: DEFAULT_SCORING });
});

settingsRouter.patch('/', async (req, res) => {
  const patch = req.body ?? {};

  for (const key of ['livePollIntervalMs', 'previewPollIntervalMs'] as const) {
    if (patch[key] === undefined) continue;
    const n = Number(patch[key]);
    // Floor of 5s keeps the app from hammering statsapi.
    if (!Number.isFinite(n) || n < 5_000 || n > 600_000) {
      return res.status(400).json({ error: `${key} must be between 5000 and 600000 ms` });
    }
    patch[key] = n;
  }

  const wasDemo = getSettings().demoMode;
  const settings = await saveSettings(patch);
  if (patch.demoMode === true && !wasDemo) resetDemo();
  retimeAll();
  await syncPollers();
  res.json({ settings });
});

settingsRouter.put('/scoring', async (req, res) => {
  const next = req.body?.scoring;
  if (!next || typeof next !== 'object') return res.status(400).json({ error: 'scoring object required' });

  // Every points value must be a finite number before it reaches the engine.
  for (const [name, format] of Object.entries(next as Record<string, any>)) {
    for (const group of ['batting', 'pitching'] as const) {
      for (const [stat, value] of Object.entries(format?.[group] ?? {})) {
        if (!Number.isFinite(Number(value))) {
          return res.status(400).json({ error: `${name}.${group}.${stat} must be a number` });
        }
        format[group][stat] = Number(value);
      }
    }
  }

  res.json({ scoring: await saveScoring(next) });
});

settingsRouter.post('/scoring/reset', async (_req, res) => {
  res.json({ scoring: await resetScoring() });
});

settingsRouter.get('/status', async (_req, res) => {
  res.json({ mlb: await checkApiStatus(), polling: pollerStats(), settings: getSettings() });
});
