# Wave report: Name Tag (who-am-I identity game)

Branch `studio-whoami`, from `origin/studio-wave1`. Game notes: `studio/games/name-tag.md`.

## What was built

- `studio/kits/identity.ts`: the identity kit. Code deals each player a name tag (person, creature
  or thing) that every other phone shows and the owner's does not. Players take turns on the spot,
  ask the room yes-or-no questions by push-to-talk, and the room answers out loud. Code judges the
  guess from the real name, keeps the clocks and question count, scores and ends the game.
- `studio/games/name-tag.ts`: the blueprint (3 to 8 players, 26 fallback identities), plus notes.
- Small additions: `publicOnly` on `RoleCheck` in `studio/rehearse.ts`, identity personas and a
  role check in `studio/personas.ts`, the kit wired into `blueprint.ts` and `check.ts`.
- `tools/scenarios/name-tag.ts`: a whole game with four simulated phones.
- `studio/shelf.ts`: the one-line shelf entry, in its own last commit. `?studio=1` only.

The host is never told a name tag before its reveal and makes no rulings, so it cannot leak or
misjudge one. The rules a model could get wrong (who guessed right, the count, the clock, the score)
are all code.

## What passes

- `python3 tools/verify.py`, `npx tsc --noEmit`, `npx eslint .` (0 errors; line-length warnings,
  some in the new files, like the existing ones), `npm test` (86 tests, 13 new). All run on Node 22.23,
  not 24, since this container has 22.
- `blueprintProblems` is empty and `checkBlueprint` is clean at 3 and 5 paper players, with the
  model failing and with hostile model content (names equal to player names, blocked names).
  Six personas reach found-out, out of questions, clock, pass, leaver mid-turn, and mumbling with
  a misspelt name. Every phase is reached.
- Leak check, two layers. On every step of every rehearsal, an unrevealed name tag (and its
  surname) must not appear on the TV, in the host's brief and facts, or on the owner's phone.
  A unit test plants a leak to each of the owner's phone, the TV and the host and the check
  catches all three. The role check deals the tags differently and requires the TV and host views
  to stay identical; a planted TV that shows a tag's kind is caught.
- `ROOM_STUDIO=1 node tools/scenarios/name-tag.ts` against `GAME_ROOM_TEXT_ONLY=1 npm run room`:
  PASS, twice. It reads each player's tag off another phone, checks it never reaches their own
  phone, the TV or a host line before the reveal, checks an out-of-turn speaker is not counted,
  ends turns by a guess in two questions, one question, a pass and twelve questions, and checks the
  TV's points (5, 5, 1, 1). The room log showed `starting blueprint nameTag on the identity kit`.
- Screenshots in headless Chromium, phone 390x844 at 2x, TV at 1920x1080 and 1366x768: intro,
  on the spot, the hint, the reveal and the end. The phone and TV turn screens were clear. The end
  screen at 1366x768 was cramped (truncated names, under the lantern), which I fixed.

## Weaknesses

- The room's answers are not checked. The host knows nothing and code never hears the room, so a
  wrong or joking answer stands. Only the player on the spot is heard; other phones are muted.
- A question is any utterance of two or more words from the player on the spot, so "hmm let me
  think" costs one. Counting is deliberately generous in the wrong direction rather than asking the
  host to rule.
- Guess matching is deterministic but tuned by guess: whole-name and surname matches, one wrong
  letter forgiven from seven letters, two from twelve. Real transcripts may spell names worse
  (for example "Da Vinci" for "Leonardo da Vinci" is matched only through the fallback alias).
  Saying a name inside a question ("Am I not Cleopatra?") still counts as a guess.
- The deny-list for model-written names is a backstop. It is a substring match, so it rejects
  innocent names (anything containing "sex", say, such as Sussex) and misses everything not listed.
  The request asks for gentle, well-known names but I could not see what the real model writes.
- The hint (person, creature or thing) is a deliberate half-way aid, not a leak, but it is partial
  information about the secret and anyone reviewing "never reaches your phone" should know.
- Turn order is the room's seat order. Fewer than three players left ends the game.
- Who an unsolved player was is told to the room at the end of every turn, which is the design,
  but a player who looks at a neighbour's phone during their own turn will see their tag. The tags
  are not hidden behind a hold-to-peek card, so they are readable at a glance.

## What I could not verify

- The host's real lines, tone and timing. There are no model keys here, so the scenario ran with
  the host silent and the "host line" half of its leak check had nothing to read. The unit and
  rehearsal checks cover the host's brief and facts, not what a model says given them.
- That the model's fresh list parses: only a literal example string was tested, not its output.
- Real push-to-talk, real transcription of names, and the voice. The scenario uses text-only
  `say`.
- The new end screen, and the on-the-spot phone with the question count, were not photographed
  again after the fix. A second screenshot run hung and was killed.
- A real iPhone and a real TV; a playtest; whether twelve questions in 75 seconds is the right
  pace; the box art (the hero painting stands in).

## To run on the Mac

```bash
GAME_ROOM_TEXT_ONLY=1 npm run room
ROOM_STUDIO=1 node tools/scenarios/name-tag.ts
```

A pass prints `PASS`. With keys, the host's lines print and the script fails if any contains the
tag of a player on the spot before the reveal.
