# Wave report: Magpie Pockets (push your luck, catalog #27)

Branch `studio-push`, from `origin/studio-wave1`. Master untouched. Written 2026-11-04.

## What it is

Magpie Pockets: three to eight players share one deck of ten original trinkets. Each beat everyone
secretly picks draw or stay on their phone, one card is flipped for everyone who drew, a trinket you
already hold busts your pocket (it scores nothing), and staying banks it. First to 30 at the end of a
round wins, at most eight rounds. Code shuffles, flips, busts, banks and scores; the host narrates
what it is handed (the card, who banked or busted, and the odds, all computed in code) and never
knows a choice before the flip. The mechanic differs from Twenty Doors and Leading Questions (a secret
word and questions), Who Fits (nomination) and the other waves.

Files: `studio/kits/tap-push.ts` (the `push` style on the tap kit, with its tests), `studio/games/
magpie-pockets.ts` and `.md`, `tools/scenarios/magpie-pockets.ts`. Small additive edits: the blueprint
union in `studio/blueprint.ts` (tap now splits into nomination and push, and Who Fits only changed its
declared type), `studio/check.ts`, `studio/personas.ts`. The shelf edit (`studio/shelf.ts`) is the last
commit alone. Nothing in `room/` or the phone page core changed.

## What passes

- `npm run check` (verify.py, tsc, eslint, all tests) green on the last commit: 86 tests, 0 failures.
  eslint reports only the max-len warnings that were already on this branch, none in the new files.
- The default blueprint check: 30 rehearsals (6 paper styles x 5 seeds) at 3 players and at 5, with the
  model failing and succeeding, all end, every phase reached, no problems.
- Leak checks: a choice-secrecy role check (the same script with one player's choice reversed; the
  TV, host and other phones must not differ before the flip), the hidden next card on every view
  step, and a planted TV that shows the choices and a planted screen that names the next card are both
  caught. A live version is in the scenario: after one phone chooses, the TV scene and another
  phone's controls are byte-identical and no flip shows.
- `ROOM_STUDIO=1 node tools/scenarios/magpie-pockets.ts` against `GAME_ROOM_TEXT_ONLY=1` room: PASS five
  times on this machine, including once on the final code with the shelf entry in place. It plays whole games with four fake
  phones of different nerve (one never stays), and checks that every scoreboard after a round and at
  the end equals what the phones banked by staying. The room log shows "[studio] starting blueprint
  magpiePockets on the tap kit".
- Screens: screenshotted the real TV page at 1920x1080 with four and eight players and the real
  phone page at 390x844 (choosing, locked in, reveal, bust, round over). That found two problems that
  are fixed (the TV tally clips long labels, and the phone shell does not draw waiting lines on a
  phone that can talk), see the layout commit.

## How tested

Unit tests in `studio/kits/tap-push.test.ts` (13): deck and free first card, busts and banks with a
staged deck, round end and carried scores, one choice per beat, stale clocks, timeouts as stay, win,
tie, rounds running out, leavers, phone and TV content, decision validation (NaN, duplicates,
shouting lines), copy-on-build, the default check, and both planted leaks. The scenario above. A
simulation of four players with fixed stop rules, run outside the repo, set the target: 30 gives about
11 to 13 flips and three to five rounds a game, which is about four to five minutes with the clocks
(10 s to choose, which ends early when all have chosen, 4 s a flip, 7 s between rounds).

## Weaknesses

- Not played by people. Pace, whether stopping feels good, and whether eight at once is readable in a
  real room are guesses from a simulation and screenshots.
- The host is untested here: no model keys, so replies failed ("META_MODEL_API_KEY is not set") and
  the game ran silent on fallback lines. The facts it receives are printed in a test and read for
  tone, but the host's actual words, speed against the twelve-second limit, and the model's own
  tension lines are unheard. One host reply per flip is the intent (about 12 a game, under the
  20 a minute limit).
- The fallback tension line goes to the host only; the TV no longer shows it, because the TV could not
  fit it beside the clock. With a silent host the TV has no banter text.
- A round can drag for one person: when three have stayed and one keeps drawing, the table waits
  through up to 10 s beats. The clock bounds it, but a leader far ahead can still be dull to watch.
- No catch-up for someone who busts early, other than the next round. Scores can run past 30
  (a 40 was seen) because the round finishes first.
- The tally on the TV clips labels beyond about 380 units, so the scoreboard shows only names and
  totals, and pockets are roster chips. Very long names at eight players were not tried.
- "Magpie Pockets", the trinket names and the lines are original, but no trademark register was
  searched from here.

## What I could not verify

- A real iPhone and TV (touch feel, the 10 s clock, sound over the flips).
- Muse Spark's replies and the model-written tension lines, and ElevenLabs timing: no keys here.
- Node 24: this machine has Node 22.23 and runs the TypeScript with `--experimental-strip-types`.
- That the shelf entry looks right in the real Studio shelf with its art: it reuses the hero painting.

## To run on the Mac

```bash
GAME_ROOM_TEXT_ONLY=1 npm run room
```

```bash
ROOM_STUDIO=1 node tools/scenarios/magpie-pockets.ts
```

A pass prints `PASS` last and the room log shows the blueprint line. Then play it with four to six
real phones on `/screen/?studio=1` and note: does anyone stay too early, is the odds line useful to say
aloud, and does the host talk over the flip.
