# MLB Live Bet Tracker

Enter the props you bet, put the page on a TV, forget about it. The app finds each
player's game, pulls the live MLB feed, tracks their stats, and tells you where every
bet stands — including when the player is coming up to hit.

No sportsbook login. You enter the bet; MLB provides the statistics.

## Run it

```bash
npm install && npm run db:push && npm run dev
```

- Dashboard: http://localhost:5173
- API: http://localhost:4000
- Both bind `0.0.0.0`, so a TV or phone on the same Wi-Fi can open the LAN URL printed at startup.

`npm run verify` runs the settlement and batting-status edge cases.
`npm run replay <timecode>` replays a real game state through the extractor
(get timecodes from `/api/v1.1/game/<gamePk>/feed/live/timestamps`).

## Adding a bet

Search a name → pick the player → pick their game → pick a prop → OVER/UNDER → line →
**ADD TO SLIP**. Repeat for each leg, then submit the slip. One leg is a straight bet;
two or more is a parlay that needs every leg to hit.

You never type a player ID, game ID, or team. The prop menu follows the player's
position: pitchers get pitching props first, position players get batting props first,
two-way players get both.

Stake and payout are optional and editable later — the **EDIT** button on any slip
opens inline stake/payout fields, and profit is derived from them.

## The dashboard

One wide card per slip, every leg a row inside it: photo, the bet in full words
("Over 1.5 Total Bases", not "1.5 TB"), a progress bar, a live win %, and the game's
scoreboard pinned to the right — score, base diamond, outs.

The headline number on a card is the **slip's** chance to win, not any one leg's.

### Live win probability

Each leg is re-simulated every poll:

1. **What's needed** — line minus current value.
2. **Chances left** — projected plate appearances from the inning, outs and the
   player's spot in the order; for pitchers, projected batters faced.
3. **How good they are at it** — season per-plate-appearance rates, shrunk toward
   league average when the sample is thin (a September call-up doesn't get treated
   as a true-talent .400 hitter off 12 at-bats).

Then 4,000 Monte Carlo trials of the remaining chances. Simulation rather than a
closed form keeps one code path for binary props (home runs) and compound ones
(total bases, fantasy points).

The slip's number is the product of its legs. **This is an estimate from season
rates, not a sportsbook price** — it ignores the opposing pitcher, park, platoon
splits and weather, and legs in the same game are positively correlated, so a
same-game parlay's true odds are slightly better than the product shown.

### Where the number has been

Beside the chance-to-win sits a thin trace of the slip's recent probability, the
size of the last move in percentage points, the total change since the slip was
added, and a short reason for the move — "Skenes -3 Fantasy Points", "Soto +2
Total Bases", "Fewer chances left".

Reasons come from diffing each leg against the previous sample, so the line never
moves without saying why. A sample is only recorded when the probability actually
moves (half a point or more) or a leg settles, and the last 60 are kept per slip.

Negative moves on fantasy props are real, not a bug: earned runs score negative,
so a pitcher who gives up a crooked number loses points.

### When they're up

Batting legs show *"Expected to bat in the Top of the 7th"*, worked out from the
current half-inning, outs, and how many hitters sit between the batter at the plate
and the player's spot, at roughly 4.4 hitters per half-inning.

Pitching legs show *"Expected to pitch ~2 more innings"*, built from that pitcher's
**last 10 appearances** — average outs and pitches per outing, plus his longest
outing as a ceiling. Live pitch count and outs are measured against that baseline,
and allowing more earned runs than usual shortens the projection to reflect a
quicker hook. Both are approximations: a long inning moves hitters up, and a real
hook depends on the bullpen and the score, which the stats API doesn't expose.

## How it's wired

```
client/src/            React dashboard (Vite)
server/
  routes/              players · games · bets · settings
  services/
    mlbApi.ts          MLB Stats API client, short-TTL cached
    statExtractor.ts   live feed -> per-player stat lines + batting status
    propEvaluator.ts   one calculator per prop, plus evaluateBet()
    fantasyScoring.ts  configurable scoring formats
    gamePollingManager.ts   one poller per game
    demoMode.ts        synthetic feed in the real feed's shape
shared/props.ts        the prop catalog
    winProbability.ts  Monte Carlo win % per leg
    seasonStats.ts     season rates, shrunk toward league average
    pitcherWorkload.ts last-10-appearance baseline for the hook
    parlays.ts         slip rollup from its legs
prisma/schema.prisma   Parlay · Player · Game · Bet · Setting
```

### One request per game, not per bet

Bets are grouped by `gamePk`. Each distinct game gets exactly one poller, so ten bets
on one game cost one MLB request per tick. Settings shows a live counter
("Feed requests since start") so you can confirm this.

Pollers start when a bet needs them, speed up from 60s to 15s when a game goes live,
and stop once every bet on that game has settled.

### Props

Batting: hits, home runs, RBIs, runs, total bases, stolen bases, walks, strikeouts,
at bats, H+R+RBI, fantasy points.
Pitching: strikeouts, pitches, hits allowed, runs allowed, earned runs, walks, outs,
innings, fantasy points.

Adding a prop means appending one entry to `shared/props.ts` and one calculator to
`propEvaluator.ts`. The picker, the API and the bet cards all read from that list.

**"Underdog" is a bet source, not a statistic.** An Underdog hits bet and a manual hits
bet track the same MLB number. The source only changes the label — and, for fantasy
points, which scoring column applies.

### Fantasy scoring

Scoring is data, not code. Four formats ship (simple, Underdog, DraftKings, FanDuel);
every value is editable in Settings and persisted. Change a value and open bets
re-score on the next poll. The shipped sportsbook numbers are reasonable defaults —
check them against your book and edit if it has changed its rules.

### Bet lifecycle

A slip loses the moment any leg misses — no waiting on the other games. It wins only
when every leg has hit. Pushed or voided legs drop out rather than sinking the slip.

Per leg: `PENDING` before first pitch, `LIVE` once the game starts. Counting stats only go up,
so an OVER that clears its line settles `WON` immediately, mid-game — and an UNDER that
gets passed settles `LOST` the same way. Everything else resolves at final.
Whole-number lines can `PUSH`.

Finished games are refused as new bets unless you confirm — so a completed game can't
quietly become a live bet.

### Demo mode

Settings → Demo mode adds a simulated game and roster to player search, so the whole
flow works when no game is on. It emits a payload in the real feed's shape and runs
through the same extractor, evaluator and poller — there are no mock branches in the
app. Real bets keep tracking real games while it's on.
