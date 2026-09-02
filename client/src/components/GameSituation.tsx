import type { Bet } from '../lib/types';
import { gameTime, ordinalInning } from '../lib/format';

/**
 * Live scoreboard strip: score, base diamond, outs and who's pitching --
 * the context you'd otherwise flip to a broadcast for.
 */
export function GameSituation({ game }: { game: Bet['game'] }) {
  const live = game.status === 'Live';
  const final = game.status === 'Final';

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
 * Bases, outs and the count, kept as their OWN block pinned to the right edge
 * of a leg row so the glanceable field state never crowds the player's name.
 */
export function FieldState({ game }: { game: Bet['game'] }) {
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

/**
 * Inning and half, the way a scoreboard shows it: a caret up for the top of
 * the inning, down for the bottom.
 */
function Inning({ inning, state }: { inning: number | null; state: string | null }) {
  if (!inning) return null;
  const half = (state ?? '').toLowerCase();
  const top = half.startsWith('top') || half.startsWith('mid');
  const arrow = top ? '\u25B2' : '\u25BC';
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
