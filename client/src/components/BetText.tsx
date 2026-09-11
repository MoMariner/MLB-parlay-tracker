import type { LegText } from '../lib/nfl';

/**
 * How a pick reads, in words: "Over 249.5 Passing Yards", "LAR −3.5 Spread",
 * "SF Moneyline", "Anytime Touchdown". One component for the slip, the live
 * card and history, over one phrasing function (describeLeg), so a bet never
 * reads two different ways.
 */
export function BetText({ text }: { text: LegText }) {
  return (
    <>
      <span className={text.tone}>{text.side}</span>
      {text.line ? <> <b>{text.line}</b></> : null}
      {text.label ? <> {text.label}</> : null}
    </>
  );
}
