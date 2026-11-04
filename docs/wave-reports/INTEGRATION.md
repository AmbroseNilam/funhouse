# Studio integration

Branch `studio-integration` (off master 2de0d6f): waves 1, 2, 3 (host, clue) and 4 merged. All of these
sit on the `?studio=1` shelf only; a normal room shows the default shelf. Start any of them by opening a
room at `/screen/?studio=1` and picking the game from the shelf by its name.

Last full check: `npm run check` passes (333 tests, warnings are line lengths). Scenarios ran with
`ROOM_STUDIO=1` against a text-only room. "Stub" means the stand-in model in `tools/stub-model.ts` or
`tools/stub-meta.ts`; nothing here has been played with the real host, a real phone or a real TV.

| Game | Mechanic | Players | Scenario status |
| --- | --- | --- | --- |
| Who Fits | everyone secretly taps who a prompt fits; counts shown | 3 to 8 | passed |
| Two Takes | two players answer a prompt in secret, the room votes (typed text, filtered) | 3 to 8 | needs the real classifier: not run (stub cannot refuse text) |
| Past the Gate | a keeper with a secret rule; players plead, code judges | 2 to 8 | not ready: scenario compares score rows by key order and fails (see below) |
| Off by a Mile | guess a number, bet on whose guess is closest | 3 to 8 | passed (rules only) |
| Mind the Gap | place a dated card in a growing row | 2 to 8 | passed (rules only) |
| Tin Can Telephone | two teams, clue-givers hold a hidden key on a shared board | 3 to 10 | passed with stub model (failed once in a batch, passed on rerun: flaky) |
| Wrong Room | everyone knows the place except one; ordered questions | 4 to 8 | passed with stub model |
| Stray Word | everyone but one holds the word; one word each in order | 4 to 10 | passed with stub model |
| Painted Whispers | write a line, the host paints it, next player describes the painting | 3 to 8 | passed with stub image model |
| Clue Gallery | storyteller clues one painting, others play matching ones, vote | 3 to 6 | passed with stub image model |
| Twenty Doors, Leading Questions | existing | 2+ / 4 to 8 | need real host keys; passed earlier on the merged tree |

Not tested on any device. Not played at a table. Image cost and latency are unmeasured.

## Not ready

- Past the Gate: `tools/scenarios/past-the-gate.ts` ~197 compares `JSON.stringify` of two score maps, so two
  players on equal points in a different order fail it. A scenario bug, not a rules bug; the builder should
  compare by name.
- Two Takes: its scenario checks that a refused line is refused; needs a real META key.
- Tin Can Telephone: flaky in the scenario ("timed out waiting for the guesser's turn"), once in two runs.

## Still to land

Hidden dice, push your luck, who am I, host guesses (studio-wave1, being built one after another); bluff
trivia and spot the bot (studio-wave2-text; wire to `mergeAnswers` once Main merges `jev-integration`); spy
and others as they report.

## Housekeeping found while merging

- Three stub servers exist (`tools/stub-host.ts`, `stub-model.ts`, `stub-meta.ts`) and two want port 8799.
- Every new kit edits the same if-chains in `studio/blueprint.ts`, `studio/check.ts` and `studio/shelf.ts`,
  and appends to `studio/personas.ts`; each merge conflicts there. A kit registry would end that.
