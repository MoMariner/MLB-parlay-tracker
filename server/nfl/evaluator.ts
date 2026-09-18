/**
 * NFL prop values and settlement.
 *
 * The big difference from baseball: most football stats are NOT monotonic.
 * A run for a loss takes rushing yards away, a lost fumble takes fantasy
 * points away, and the margin on a spread swings both ways all game. So an
 * over only settles early when the prop is marked monotonic -- and even then
 * the poller keeps re-checking it until the final whistle, because a
 * touchdown can be overturned on review.
 */

import type { PropDef, BetStatus } from '../../shared/props.js';
import type { NflLine, NflSnapshot } from './stats.js';
import { periodScore } from './stats.js';
import { scoreNflFantasy } from './fantasy.js';

/**
 * How far clear of its line a yardage bet has to be before it's called.
 * Yards can come back -- a run for a loss -- but not five of them without a
 * carry going the other way, and every settled football leg is re-checked
 * until the whistle in case it does.
 */
const YARDS_CLEAR = 5;

/** Scoring plays that pay an anytime-TD bet. Passing TDs go to the receiver. */
export function anytimeTouchdowns(l: NflLine): number {
  return (
    l.rushing.touchdowns +
    l.receiving.touchdowns +
    l.returns.kickTouchdowns +
    l.returns.puntTouchdowns +
    l.defense.touchdowns
  );
}

/** Scoreboard margin from the picked team's side; positive means ahead. */
export function marginFor(teamId: number | null, s: NflSnapshot): number {
  return teamId === s.homeTeamId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore;
}

/** Margin in one period from the picked team's side; 0 before it starts. */
function periodMargin(teamId: number | null, s: NflSnapshot, period: number): number {
  const q = periodScore(s, period);
  if (!q) return 0;
  return teamId === s.homeTeamId ? q.home - q.away : q.away - q.home;
}

export function nflValue(
  betType: string,
  l: NflLine,
  s: NflSnapshot,
  teamId: number | null,
  source: string,
): number {
  switch (betType) {
    case 'NFL_PASS_YARDS':           return l.passing.yards;
    case 'NFL_PASS_TDS':             return l.passing.touchdowns;
    case 'NFL_PASS_COMPLETIONS':     return l.passing.completions;
    case 'NFL_PASS_ATTEMPTS':        return l.passing.attempts;
    case 'NFL_INTERCEPTIONS_THROWN': return l.passing.interceptions;
    case 'NFL_PASS_RUSH_YARDS':      return l.passing.yards + l.rushing.yards;

    case 'NFL_RUSH_YARDS':     return l.rushing.yards;
    case 'NFL_RUSH_ATTEMPTS':  return l.rushing.attempts;
    case 'NFL_RUSH_TDS':       return l.rushing.touchdowns;
    case 'NFL_LONGEST_RUSH':   return l.rushing.long;
    case 'NFL_RUSH_REC_YARDS': return l.rushing.yards + l.receiving.yards;

    case 'NFL_REC_YARDS':   return l.receiving.yards;
    case 'NFL_RECEPTIONS':  return l.receiving.receptions;
    case 'NFL_REC_TDS':     return l.receiving.touchdowns;
    case 'NFL_LONGEST_REC': return l.receiving.long;

    case 'NFL_ANYTIME_TD': return anytimeTouchdowns(l);

    case 'NFL_FG_MADE':        return l.kicking.fgMade;
    case 'NFL_KICKING_POINTS': return l.kicking.points;
    case 'NFL_XP_MADE':        return l.kicking.xpMade;

    case 'NFL_TACKLES':           return l.defense.tackles;
    case 'NFL_SACKS':             return l.defense.sacks;
    case 'NFL_DEF_INTERCEPTIONS': return l.defense.interceptions;

    case 'NFL_FANTASY_POINTS': return scoreNflFantasy(l, source);

    case 'NFL_GAME_TOTAL': return s.homeScore + s.awayScore;
    case 'NFL_TEAM_TOTAL': return teamId === s.homeTeamId ? s.homeScore : s.awayScore;
    case 'NFL_SPREAD':
    case 'NFL_MONEYLINE':  return marginFor(teamId, s);

    case 'NFL_1Q_WINNER':
    case 'NFL_1Q_SPREAD':  return periodMargin(teamId, s, 1);
    case 'NFL_1Q_TOTAL': {
      const q = periodScore(s, 1);
      return q ? q.home + q.away : 0;
    }

    default: throw new Error(`Unknown NFL prop: ${betType}`);
  }
}

export interface NflEvaluation {
  currentValue: number;
  status: BetStatus;
  progress: number;
  /** Smallest value that wins an over; the ceiling an under must stay below. */
  target: number;
}

export function evaluateNflLeg(
  bet: { betType: string; direction: string; line: number },
  def: PropDef,
  value: number,
  s: NflSnapshot,
): NflEvaluation {
  const isOver = bet.direction !== 'UNDER';

  // A postponed or cancelled game voids the leg rather than grading it.
  if (s.status === 'Other') return { currentValue: value, status: 'VOID', progress: 0, target: bet.line };

  // A quarter market is graded the moment that quarter ends; everything else
  // waits for the final whistle.
  const settled = def.period != null
    ? s.status === 'Final' || (s.period ?? 0) > def.period
    : s.status === 'Final';

  // ---- Spread, moneyline and quarter winner: pick a side ----
  if (def.sides === 'team') {
    // A spread's line is the margin the pick has to beat: +2.5 has to win by
    // 3, -2.5 can lose by 2. A moneyline just has to win, so its line is 0.
    const line = def.handicap ? bet.line : 0;
    const cover = value - line;
    const target = line;
    if (s.status === 'Preview') return { currentValue: value, status: 'PENDING', progress: 0, target };
    if (settled) {
      const status: BetStatus = cover > 0 ? 'WON' : cover < 0 ? 'LOST' : 'PUSH';
      return { currentValue: value, status, progress: cover > 0 ? 1 : 0, target };
    }
    // Progress for a side is filled in from the win probability by the caller.
    return { currentValue: value, status: 'LIVE', progress: 0, target };
  }

  // ---- Over / under ----
  const target = isOver
    ? (def.decimal ? bet.line : Number.isInteger(bet.line) ? bet.line + 1 : Math.ceil(bet.line))
    : bet.line;
  const progress = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;

  if (s.status === 'Preview') return { currentValue: value, status: 'PENDING', progress: 0, target };

  if (settled) {
    const status: BetStatus =
      value > bet.line ? (isOver ? 'WON' : 'LOST')
      : value < bet.line ? (isOver ? 'LOST' : 'WON')
      : 'PUSH';
    return { currentValue: value, status, progress, target };
  }

  // Only a stat that can't come back down may clear an over mid-game.
  if (def.monotonic && value > bet.line) {
    return { currentValue: value, status: isOver ? 'WON' : 'LOST', progress: 1, target };
  }

  // Yardage isn't monotonic, but a bet sitting this far past its line is in,
  // and reading "live" next to 40 yards on a 25.5 line helps nobody.
  if (def.kind === 'yards' && value >= bet.line + YARDS_CLEAR) {
    return { currentValue: value, status: isOver ? 'WON' : 'LOST', progress: 1, target };
  }

  return { currentValue: value, status: 'LIVE', progress, target };
}
