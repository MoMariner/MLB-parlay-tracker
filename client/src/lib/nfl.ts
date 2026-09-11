/** Football display helpers shared by the add-bet flow, the slip and the cards. */

import type { Bet, Game, NflLine, PropCategory, PropDef } from './types';
import { num } from './format';

export function signed(n: number): string {
  return n > 0 ? `+${num(n)}` : num(n);
}

/** A spread as a book prints it: "+3.5", "−3.5", "PK" for a pick'em. */
export function formatSpread(n: number): string {
  if (n === 0) return 'PK';
  return n > 0 ? `+${num(n)}` : `\u2212${num(Math.abs(n))}`;
}

type TeamSides = { homeTeamId: number; homeAbbrev: string; awayAbbrev: string };

export function teamAbbrev(g: TeamSides | undefined, teamId: number | null): string {
  if (!g || teamId == null) return '';
  return teamId === g.homeTeamId ? g.homeAbbrev : g.awayAbbrev;
}

export function teamLogoFor(
  g: { homeTeamId: number; homeLogo?: string | null; awayTeamId: number; awayLogo?: string | null },
  teamId: number | null,
): string | null {
  if (teamId === g.homeTeamId) return g.homeLogo ?? null;
  if (teamId === g.awayTeamId) return g.awayLogo ?? null;
  return null;
}

export interface LegText {
  /** "Over", "LAR", "LAR Over". */
  side: string;
  tone: 'over' | 'under' | 'team';
  /** "249.5", "-3.5", or empty for a moneyline. */
  line: string;
  label: string;
}

/** How a leg reads: "Over 249.5 Passing Yards", "LAR -3.5", "SF Moneyline", "LAR Over 24.5 Team Total". */
export function describeLeg(
  prop: PropDef | undefined,
  leg: { betType: string; direction: string; line: number; teamId: number | null },
  g?: TeamSides,
): LegText {
  const ou = leg.direction === 'UNDER' ? 'Under' : 'Over';
  const tone = leg.direction === 'UNDER' ? 'under' : 'over';
  const team = teamAbbrev(g, leg.teamId);
  switch (prop?.key) {
    case 'NFL_SPREAD':     return { side: team, tone: 'team', line: formatSpread(leg.line), label: 'Spread' };
    case 'NFL_MONEYLINE':  return { side: team, tone: 'team', line: '', label: 'Moneyline' };
    case 'NFL_TEAM_TOTAL': return { side: `${team} ${ou}`, tone, line: num(leg.line), label: 'Team Total' };
    case 'NFL_ANYTIME_TD':
      // "Over 0.5 Anytime Touchdown" is how a database says it, not a bettor.
      if (leg.direction !== 'UNDER') {
        return leg.line < 1
          ? { side: 'Anytime', tone, line: '', label: 'Touchdown' }
          : { side: `${Math.ceil(leg.line)}+`, tone, line: '', label: 'Touchdowns' };
      }
      return { side: ou, tone, line: num(leg.line), label: 'Touchdowns' };
    default:               return { side: ou, tone, line: num(leg.line), label: prop?.label ?? leg.betType };
  }
}

export function legTextString(t: LegText): string {
  return [t.side, t.line, t.label].filter(Boolean).join(' ');
}

/** "Q3 8:42", "HALFTIME", "OT 5:00", "FINAL", "FINAL/OT". */
export function quarterLabel(g: { status: string; period?: number | null; clock?: string | null; detailedState?: string | null }): string {
  if (g.status === 'Final') return (g.period ?? 4) > 4 ? 'FINAL/OT' : 'FINAL';
  if (g.status !== 'Live') return '';
  if (/halftime/i.test(g.detailedState ?? '')) return 'HALFTIME';
  const p = g.period ?? 1;
  const q = p > 4 ? (p === 5 ? 'OT' : `${p - 4}OT`) : `Q${p}`;
  return g.clock ? `${q} ${g.clock}` : q;
}

/** "2nd & 7", "1st & Goal". */
export function downShort(g: { down: number | null; distance: number | null; yardsToEndzone: number | null }): string {
  if (!g.down) return '';
  const ord = ['', '1st', '2nd', '3rd', '4th'][g.down] ?? `${g.down}th`;
  const goal = g.distance != null && g.yardsToEndzone != null && g.distance >= g.yardsToEndzone;
  return `${ord} & ${goal ? 'Goal' : g.distance ?? '?'}`;
}

interface StatusMeta { label: string; icon: string; tone: string }

const FIELD_STATUS: Record<string, StatusMeta> = {
  ON_OFFENSE:       { label: 'ON THE FIELD',         icon: '🏈', tone: 'live' },
  RED_ZONE:         { label: 'IN THE RED ZONE',      icon: '🔴', tone: 'redzone' },
  ON_DEFENSE:       { label: 'ON THE FIELD',         icon: '🛡️', tone: 'live' },
  IN_FG_RANGE:      { label: 'IN FIELD GOAL RANGE',  icon: '🎯', tone: 'redzone' },
  OFF_FIELD:        { label: 'WAITING FOR THE BALL', icon: '⏸', tone: 'waiting' },
  HALFTIME:         { label: 'HALFTIME',             icon: '⏸', tone: 'waiting' },
  BETWEEN_PLAYS:    { label: 'BETWEEN PLAYS',        icon: '⏸', tone: 'waiting' },
  GAME_NOT_STARTED: { label: 'GAME NOT STARTED',     icon: '⚪', tone: 'waiting' },
  GAME_FINAL:       { label: 'GAME FINAL',           icon: '⚫', tone: 'final' },
  POSTPONED:        { label: 'POSTPONED',            icon: '⚫', tone: 'final' },
};

/** Football's "coming up": is this player's unit on the field right now? */
export function fieldStatusMeta(status: string | null, category?: PropCategory): StatusMeta | null {
  if (!status) return null;
  const base = FIELD_STATUS[status];
  if (!base) return null;
  // A defender is off the field precisely when his own offense has the ball.
  if (status === 'OFF_FIELD' && category === 'defense') return { ...base, label: 'HIS OFFENSE HAS THE BALL' };
  return base;
}

/** "Covering by 3.5", "Needs 2 more to cover", "Leads by 7". */
export function marginNote(prop: PropDef | undefined, leg: Pick<Bet, 'currentValue' | 'line' | 'game'>): string | null {
  if (leg.game.status !== 'Live' && leg.game.status !== 'Final') return null;
  if (prop?.key === 'NFL_SPREAD') {
    const cover = leg.currentValue + leg.line;
    if (cover > 0) return `Covering by ${num(cover)}`;
    if (cover < 0) return `Needs ${num(-cover)} more to cover`;
    return 'Right on the number';
  }
  if (prop?.key === 'NFL_MONEYLINE') {
    const m = leg.currentValue;
    return m > 0 ? `Leads by ${num(m)}` : m < 0 ? `Trails by ${num(-m)}` : 'Tied';
  }
  return null;
}

export function paceUnit(prop?: PropDef): string {
  if (!prop) return '';
  if (prop.kind === 'yards') return 'yds';
  if (prop.kind === 'points') return 'pts';
  return prop.short.toLowerCase();
}

type Chip = { k: string; v: string | number };

/** The stat line worth seeing for a leg, on one row. */
export function nflChips(prop: PropDef | undefined, l: NflLine, position: string | null): Chip[] {
  const P = l.passing, R = l.rushing, C = l.receiving, K = l.kicking, D = l.defense;
  const passing: Chip[] = [
    { k: 'C/ATT', v: `${P.completions}/${P.attempts}` }, { k: 'YDS', v: P.yards },
    { k: 'TD', v: P.touchdowns }, { k: 'INT', v: P.interceptions }, { k: 'SACK', v: P.sacks },
    { k: 'RUSH', v: `${R.attempts}-${R.yards}` },
  ];
  switch (prop?.category) {
    case 'passing': return passing;
    case 'rushing': return [
      { k: 'CAR', v: R.attempts }, { k: 'YDS', v: R.yards }, { k: 'TD', v: R.touchdowns },
      { k: 'LONG', v: R.long }, { k: 'REC', v: C.receptions }, { k: 'REC YDS', v: C.yards },
    ];
    case 'receiving': return [
      { k: 'REC', v: C.receptions }, { k: 'TGT', v: C.targets }, { k: 'YDS', v: C.yards },
      { k: 'TD', v: C.touchdowns }, { k: 'LONG', v: C.long }, { k: 'RUSH', v: `${R.attempts}-${R.yards}` },
    ];
    case 'scoring': return [
      { k: 'RUSH TD', v: R.touchdowns }, { k: 'REC TD', v: C.touchdowns },
      { k: 'CAR', v: R.attempts }, { k: 'REC', v: C.receptions }, { k: 'YDS', v: R.yards + C.yards },
    ];
    case 'kicking': return [
      { k: 'FG', v: `${K.fgMade}/${K.fgAttempts}` }, { k: 'XP', v: `${K.xpMade}/${K.xpAttempts}` },
      { k: 'PTS', v: K.points }, { k: 'LONG', v: K.long },
    ];
    case 'defense': return [
      { k: 'TKL', v: D.tackles }, { k: 'SOLO', v: D.solo }, { k: 'SACK', v: D.sacks },
      { k: 'INT', v: D.interceptions }, { k: 'PD', v: D.passesDefended },
    ];
    default:
      if (P.attempts > 0 || position === 'QB') return passing;
      return [
        { k: 'CAR', v: R.attempts }, { k: 'RUSH', v: R.yards }, { k: 'REC', v: C.receptions },
        { k: 'REC YDS', v: C.yards }, { k: 'TD', v: R.touchdowns + C.touchdowns }, { k: 'FUM', v: l.fumbles.lost },
      ];
  }
}

/** Points by quarter for each side, from the stored JSON arrays. */
export function linescoreChips(g: Game): Chip[] | null {
  const parse = (s: string | null) => {
    try { return s ? (JSON.parse(s) as number[]) : null; } catch { return null; }
  };
  const a = parse(g.awayLinescores);
  const h = parse(g.homeLinescores);
  if (!a || !h) return null;
  return [{ k: g.awayAbbrev, v: a.join(' · ') }, { k: g.homeAbbrev, v: h.join(' · ') }];
}
