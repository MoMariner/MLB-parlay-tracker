import type { Game } from '../lib/types';
import { gameTime, ordinalInning } from '../lib/format';
import { downShort, quarterLabel } from '../lib/nfl';

/**
 * Context strip under a leg: who's pitching (MLB), or the down and the last
 * play (NFL) -- the things you'd otherwise flip to a broadcast for.
 */
export function GameSituation({ game }: { game: Game }) {
  const live = game.status === 'Live';
  const final = game.status === 'Final';

  if (game.sport === 'nfl') {
    if (!live) return null;
    return (
      <div className="situation nfl">
        {game.downDistanceText && <span className="dd">{game.downDistanceText}</span>}
        {game.lastPlay && <span className="last-play" title={game.lastPlay}>{game.lastPlay}</span>}
      </div>
    );
  }

  if (!live && !final) return null;
  return (
    <div className={`situation${live ? ' live' : ''}`}>
      {live && game.currentPitcherName ? (
        <span className="pitching"><i>P</i> {game.currentPitcherName}</span>
      ) : null}
    </div>
  );
}

/**
 * Score and field state as their OWN block pinned to the right edge of a
 * leg row, so the glanceable situation never crowds the player's name.
 */
export function FieldState({ game }: { game: Game }) {
  if (game.sport === 'nfl') return <NflFieldState game={game} />;

  const live = game.status === 'Live';
  const final = game.status === 'Final';

  if (!live && !final) {
    return (
      <div className="field-state">
        <div className="fs-score upcoming">{game.awayAbbrev} @ {game.homeAbbrev}</div>
        <div className="fs-when">{gameTime(game.gameDate)}</div>
      </div>
    );
  }

  return (
    <div className="field-state">
      <div className="fs-score">
        <span><b>{game.awayAbbrev}</b> {game.awayScore ?? 0}</span>
        <span><b>{game.homeAbbrev}</b> {game.homeScore ?? 0}</span>
      </div>
      {live ? (
        <div className="fs-field">
          <Inning inning={game.inning} state={game.inningState} />
          <Diamond first={game.onFirst} second={game.onSecond} third={game.onThird} />
          <Outs outs={game.outs ?? 0} />
        </div>
      ) : (
        <div className="fs-when">FINAL</div>
      )}
    </div>
  );
}

/** Football: score with a ball beside whoever has it, the clock, down and field position. */
function NflFieldState({ game }: { game: Game }) {
  const live = game.status === 'Live';
  const final = game.status === 'Final';

  if (!live && !final) {
    return (
      <div className="field-state nfl">
        <div className="fs-score upcoming">{game.awayAbbrev} @ {game.homeAbbrev}</div>
        <div className="fs-when">{gameTime(game.gameDate)}</div>
      </div>
    );
  }

  const ball = live ? game.possessionTeamId : null;
  return (
    <div className="field-state nfl">
      <div className="fs-score">
        <span className={ball === game.awayTeamId ? 'has-ball' : ''}><b>{game.awayAbbrev}</b> {game.awayScore ?? 0}</span>
        <span className={ball === game.homeTeamId ? 'has-ball' : ''}><b>{game.homeAbbrev}</b> {game.homeScore ?? 0}</span>
      </div>
      {live ? (
        <div className="fs-field nfl">
          <span className="fs-inning">{quarterLabel(game)}</span>
          <FieldBar yardsToEndzone={game.yardsToEndzone} redZone={game.isRedZone} hasBall={ball != null} />
          <span className="fs-down">{downShort(game)}</span>
        </div>
      ) : (
        <div className="fs-when">{quarterLabel(game)}</div>
      )}
    </div>
  );
}

/**
 * The field from the offense's own goal line (left) to the end zone it's
 * attacking (right), with the ball where the next snap is. Red zone tinted.
 */
function FieldBar({ yardsToEndzone, redZone, hasBall }: { yardsToEndzone: number | null; redZone: boolean; hasBall: boolean }) {
  const known = yardsToEndzone != null && hasBall;
  // Playable field sits between two 9%-wide end zones.
  const left = known ? 9 + (100 - (yardsToEndzone as number)) * 0.82 : 0;
  return (
    <span
      className={`field-bar${redZone ? ' rz' : ''}`}
      role="img"
      aria-label={known ? `${yardsToEndzone} yards from the end zone` : 'Ball position unknown'}
      title={known ? `${yardsToEndzone} yards to go for a touchdown` : undefined}
    >
      <i className="ez own" />
      <i className="rz-zone" />
      <i className="ez goal" />
      {known && <em className="ball" style={{ left: `${left}%` }} />}
    </span>
  );
}

/**
 * Inning and half, the way a scoreboard shows it: a caret up for the top of
 * the inning, down for the bottom.
 */
function Inning({ inning, state }: { inning: number | null; state: string | null }) {
  if (!inning) return null;
  const half = (state ?? '').toLowerCase();
  const top = half.startsWith('top') || half.startsWith('mid');
  const arrow = top ? '▲' : '▼';
  const word = top ? 'Top' : 'Bottom';
  return (
    <span className="fs-inning" title={`${word} of the ${ordinalInning(inning)}`}>
      <i>{arrow}</i>{ordinalInning(inning)}
    </span>
  );
}

/** Bases occupied, drawn as the usual rotated-square diamond. */
function Diamond({ first, second, third }: { first: boolean; second: boolean; third: boolean }) {
  const label = [second && '2nd', first && '1st', third && '3rd'].filter(Boolean).join(', ');
  return (
    <span
      className="diamond"
      role="img"
      aria-label={label ? `Runners on ${label}` : 'Bases empty'}
      title={label ? `Runners on ${label}` : 'Bases empty'}
    >
      <i className={`b second${second ? ' on' : ''}`} />
      <i className={`b third${third ? ' on' : ''}`} />
      <i className={`b first${first ? ' on' : ''}`} />
    </span>
  );
}

/** Two circles: nobody out, one out, two out. Three ends the inning. */
function Outs({ outs }: { outs: number }) {
  return (
    <span className="outs" role="img" aria-label={`${outs} out`} title={`${outs} out`}>
      <i className={outs >= 1 ? 'on' : ''} />
      <i className={outs >= 2 ? 'on' : ''} />
      <em>OUT</em>
    </span>
  );
}
