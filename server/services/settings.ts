/**
 * App settings (spec §25) -- polling interval, fantasy scoring configs and
 * display prefs, persisted as JSON in the Setting table.
 */

import { prisma } from '../db.js';
import { DEFAULT_SCORING, setScoringConfigs, getScoringConfigs, type ScoringFormat } from './fantasyScoring.js';

export interface AppSettings {
  /** Poll cadence for games that are in progress, in ms. */
  livePollIntervalMs: number;
  /** Poll cadence for scheduled games, waiting for first pitch, in ms. */
  previewPollIntervalMs: number;
  /** Keep settled bets on the LIVE BETS screen until their game ends. */
  keepSettledOnDashboard: boolean;
  /** Big-screen mode: larger type, fewer chrome elements. */
  tvMode: boolean;
  demoMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  livePollIntervalMs: 15_000,
  previewPollIntervalMs: 60_000,
  keepSettledOnDashboard: true,
  tvMode: false,
  demoMode: false,
};

let cached: AppSettings = { ...DEFAULT_SETTINGS };

async function readKey<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await readKey<Partial<AppSettings>>('app', {});
  cached = { ...DEFAULT_SETTINGS, ...stored };

  const scoring = await readKey<Record<string, ScoringFormat>>('scoring', DEFAULT_SCORING);
  // Merge so a format added in a later release still shows up for existing users.
  setScoringConfigs({ ...DEFAULT_SCORING, ...scoring });

  return cached;
}

export function getSettings(): AppSettings {
  return cached;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  cached = { ...cached, ...patch };
  await writeKey('app', cached);
  return cached;
}

export async function saveScoring(next: Record<string, ScoringFormat>): Promise<Record<string, ScoringFormat>> {
  setScoringConfigs(next);
  await writeKey('scoring', next);
  return next;
}

export async function resetScoring(): Promise<Record<string, ScoringFormat>> {
  return saveScoring(structuredClone(DEFAULT_SCORING));
}

export { getScoringConfigs };
