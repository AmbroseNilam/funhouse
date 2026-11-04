# Wave report: Under the Cup (catalog 21, bid and challenge)

Branch `studio-dice`, from `origin/studio-wave1`. One game: a hidden-dice bluffing game for three to
eight people, on the tap kit. Original name; the mechanic is a folk game, the name, the card text
and the look are ours. The name has not been checked against any trademark register.

## What it is

Each player rolls three dice that show only on their own phone, on a face-down card that turns over
while pressed. Players take turns raising a bid about how many dice show one face across every cup
(ones wild except in a bid on ones), or challenging the last bid. The cups stay down for five seconds,
then the TV shows every hand, the count and who loses a die. A challenger who meets an exactly right bid
loses two. Players with no dice are out. The last player with dice wins; after twelve challenges the most
dice wins. The host never sees a die until the lift and makes no rulings: it talks the table up and down.
Rules, rolls, bid order, counting, odds, clocks and elimination are all code.

Mechanic against the others: one person up at a time, private uneven information, a public claim about
a private thing. Twenty Doors and Leading Questions turn on a word the host holds and spoken questions;
Who Fits is simultaneous secret taps with no right answer.

## Where things are

| Piece | Path |
| --- | --- |
| Pure rules (bid order, counting, odds, paging) | `studio/kits/tap-dice-rules.ts` |
| Kit: the cartridge, host briefs, scenes, controls | `studio/kits/tap-dice.ts` |
| Blueprint (decisions and box) | `studio/games/under-the-cup.ts` |
| Notes, how it differs, awkward cases | `studio/games/under-the-cup.md` |
| Paper players and the secrecy check | `dicePersonas` and `diceSecrecyCheck` in `studio/personas.ts`; wired in `studio/check.ts` |
| Tests | `studio/kits/tap-dice.test.ts`, `studio/kits/tap-dice-rules.test.ts` |
| Scenario with four simulated phones | `tools/scenarios/under-the-cup.ts` |
| Shelf entry | `studio/shelf.ts`, its own last commit |

Outside `studio/` and `tools/` nothing changed. `room/`, `shared/` and the phone page are untouched.
`TapBlueprint` in `studio/blueprint.ts` became generic over its decisions so Who Fits keeps its types, and
`who-fits.ts` gained a type annotation for that; nothing about Who Fits behaves differently.

## What passes

Run in this container (Node 22.23.4, not the 24 the repo asks for):

- `npm run check`: `verify.py` ok, `tsc` clean, `eslint` no errors (the five warnings left are in files this
  branch does not touch), `npm test` 101 of 101 (28 are the dice game's).
- Blueprint passes `studio/check.ts` at three, four and five players: 30 rehearsals each, all 30 end, no
  phase unreached, no problems. Endings reached: last player standing, the twelve-challenge cap, and
  players walking out. The model-content options in that check do nothing here, since the game asks the
  model for no content; it fails and succeeds identically.
- `ROOM_STUDIO=1 node tools/scenarios/under-the-cup.ts` against a text-only room: PASS three times at the
  default three challenges, and PASS once with `DICE_ROUNDS=all`, which played seven challenges to a winner
  in about six minutes. The room log shows `[studio] starting blueprint underTheCup on the tap kit`, and no
  name, word or die.
- Phone at 390 by 844 (a real browser page, two-times scale) and TV at 1920 by 1080, for these states:
  looking, peeking at the card, my turn on the quantity list, the face list, someone else's turn, the lift,
  the reveal, and the next round; and an eight-player table with a 19-character name for looking and the
  reveal. After fixes, every TV state ends above the lantern and Challenge is visible without scrolling.
  Screenshots are not committed.

## How it was tested

- **Rules**: unit tests for bid order, the quantity pages, counting with and without wild ones, the odds, how
  bids are spoken, and finding the next seat with dice.
- **Flow**: unit tests with scripted dice: two-step bidding, an illegal bid and the wrong player refused, the
  draft invisible to the TV and every other phone, the cups-down beat, exact, over and bluff results, ones as
  ones, the next round rolling fresh dice with the loser opening, elimination and the skipped seat, the
  challenge-limit ending, the idle clock opening and calling, a stale clock ignored, a leaver voiding the
  round, the game ending when one player is left, a result staying up when someone leaves, eight hands on four
  lines.
- **Leak check, three layers.** (1) The kit declares every cup of three or more dice as hidden from everyone
  but its owner, and the standard rehearsal searches the TV, the host's brief and every phone for it on every
  step of every paper game. (2) A swap check deals one player different dice in each game and requires the TV,
  the host's brief and every other phone to be identical through the bids and the challenge itself; a unit
  test plants a TV, a host fact and a phone that show a die and confirms each is caught. (3) The scenario
  searches every other phone, the TV and every host line for each cup's dice in several spellings at every
  bid, and I planted a leak (every cup printed on the TV while looking) to confirm it fails with the cup's
  owner named, then reverted it.
- **Browser**: Playwright drove a real phone page and a real TV page against the real room, with three fake
  phones, for the screenshots above.

## Weaknesses

- **The host has not spoken.** No model keys here. Everything the host is told, and every instruction it has,
  is written and tested as text; whether Muse Spark turns it into good, short, dry lines, keeps quiet when
  told, and counts dice correctly at the reveal is unknown. At the reveal it is given every die and the
  verdict, so a wrong count from it is a recoverable moment, not a wrong result.
- **Chatter budget.** A bold bid, a challenge, a lift, a reveal and a round start each ask the host to speak;
  routine bids are told quietly. With bold bidders that could press the 20 replies a minute and 12 second
  limits. Untested.
- **Length is unmeasured with people.** The script is fast. Seven challenges took six minutes with four
  scripted phones; people think and talk, and eight players start with 24 dice. The cap of twelve challenges and
  the double loss on an exact bid are guesses at keeping it bounded.
- **Elimination.** Players with no dice only watch. That cuts against the handoff's "no elimination" rule; the
  game is built around it. Nothing yet gives an out player a job.
- **Dice are digits.** The card shows "5 6 1" in the phone's small card text, not dice. Fine to read, not
  pretty, and the phone core is not mine to change.
- **Holding the card to peek takes a thumb.** Peek, release, then bid. Not felt on a real iPhone.
- **Quantity paging.** Five numbers and More/Fewer was chosen from a screenshot, not a person. A bid above the
  lowest raise plus four takes a press on More.
- **Idle players.** After thirty seconds the clock bids a modest opening or challenges for them, which can cost
  a die. That keeps the table moving; it may feel unfair the first time.
- **Seat order.** The first seat opens round one, not a random player.
- **Leak check limits.** The text search for a cup uses digits and can false-alarm on numbers beside a name;
  round headers were reworded to avoid that. Cups of one or two dice are not text-searched, and the swap check
  covers round one only. Later rounds rely on the text search and on the same code paths.
- **Three players** is nearly a duel; the game allows it.

## What I could not verify

- Any real host line, voice, caption timing or lull behaviour.
- A real phone: touch, the peek card, scrolling the private area, vibration, and mic hold while bidding.
- A real table: whether bluffing happens, whether the cup lift feels dramatic, how long a game runs.
- Leaving mid-round through the room. The cartridge handles it and is unit-tested and rehearsed; the room holds
  a disconnected seat for two to three minutes before it reports a leave, so the scenario can't reach it quickly.
- Node 24, and the Mac-only independent review.
- Trademark clearance for the name.

## To run it

```bash
GAME_ROOM_TEXT_ONLY=1 npm run room
```

```bash
ROOM_STUDIO=1 node tools/scenarios/under-the-cup.ts
```

A pass prints `PASS` last. `DICE_ROUNDS=all` plays to a winner. Open a room with `/screen/?studio=1` to see
the game on the shelf.
