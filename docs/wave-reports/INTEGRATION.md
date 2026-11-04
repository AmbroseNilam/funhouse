# Studio integration

Branch `studio-integration` (off master 2de0d6f): waves 1, 2, 3 (host, clue) and 4 merged, with master merged in on 2026-11-04. All of these
sit on the `?studio=1` shelf only; a normal room shows the default shelf. Start any of them by opening a
room at `/screen/?studio=1` and picking the game from the shelf by its name.

Last full check: `npm run check` passes (586 tests, warnings are line lengths). Scenarios ran with
`ROOM_STUDIO=1` against a text-only room. "Stub" means the stand-in model in `tools/stub-model.ts` or
`tools/stub-meta.ts`; nothing here has been played with the real host, a real phone or a real TV.

| Game | Mechanic | Players | Scenario status |
| --- | --- | --- | --- |
| Who Fits | everyone secretly taps who a prompt fits; counts shown | 3 to 8 | passed |
| Two Takes | two players answer a prompt in secret, the room votes (typed text, filtered) | 3 to 8 | passed with the real key at 53436e7; on the shelf (vote line reworded after that run) |
| Past the Gate | a keeper with a secret rule; players plead, code judges | 2 to 8 | passed (rules only), after fixing its score comparison |
| Off by a Mile | guess a number, bet on whose guess is closest | 3 to 8 | passed (rules only) |
| Mind the Gap | place a dated card in a growing row | 2 to 8 | passed (rules only) |
| Tin Can Telephone | two teams, clue-givers hold a hidden key on a shared board | 3 to 10 | passed with stub model (failed once in a batch, passed on rerun: flaky) |
| Wrong Room | everyone knows the place except one; ordered questions | 4 to 8 | passed with stub model |
| Stray Word | everyone but one holds the word; one word each in order | 4 to 10 | passed with stub model |
| Painted Whispers | write a line, the host paints it, next player describes the painting | 3 to 8 | passed with stub image model |
| Clue Gallery | storyteller clues one painting, others play matching ones, vote | 3 to 6 | passed with stub image model |
| Under the Cup | hidden dice under a cup; bid on the total, challenge a bid (tap only) | 3 to 8 | passed; visible on the shelf (tap only, no model) |
| Magpie Pockets | everyone secretly draws or stays; a repeated trinket busts (tap only) | 3 to 8 | passed; visible on the shelf (tap only, no model) |
| Name Tag | each player wears a name tag only the others see and finds out who they are by asking | 3 to 8 | passed with stub model; held back, no run with the real host yet |
| Cold Read | the table hides a thing and the host asks yes/no questions to guess it | 2 to 8 | passed (win and lose plans) with a stand-in host in `tools/stub-host-model.ts`; held back, no run with the real host yet |
| Blank Verdict | dealt cards fill a prompt's gap, a rotating judge picks | 3 to 8 | scenario FAILED on the merged tree in 4 runs on a timing check (a phone is read before it updates; the unmerged branch fails the same way); rules covered by unit tests and rehearsal; held back |
| Lonely Clues | one-word clues cancel when they match; the guesser sees only the survivors | 3 to 8 | passed with stub model on rerun (first run failed once on seat order, a join-order race in the scenario); held back, no run with the real host yet |
| Pantomime Panic | one player acts a prompt in silence, the rest shout guesses | 3 to 10 | passed with stub model; held back, no run with the real host yet |
| Blank Truth | a real fact with a blank; write fakes, then pick the true one | 3 to 8 | passed with stand-in model (`tools/fake-meta.ts`); held back, no run with the real host yet |
| Ghost Writer | answer a prompt in secret; the host writes one more; vote for the machine | 3 to 8 | passed with stand-in model (`tools/fake-meta.ts`); held back, no run with the real host yet |
| Twenty Doors, Leading Questions | existing | 2+ / 4 to 8 | need real host keys; with the stub model they time out waiting for the host to speak |

Not tested on any device. Not played at a table. Image cost and latency are unmeasured.

## Not ready

- Two Takes: its scenario checks that a refused line is refused; needs a real META key.
- Tin Can Telephone: flaky in the scenario ("timed out waiting for the guesser's turn"), once in two runs.

## Still to land

All of waves 1 and 2 are merged (above). Spy and others as they report. The bluff and bot kits could
adopt `mergeAnswers` from master later; they keep their own matching for now.

## Housekeeping found while merging

- Stub servers: `tools/stub-model.ts` (port 8799, text host; it serves `stub-host.ts`) and `tools/stub-meta.ts`
  (port 8798, images and the classifier). Use one or the other per room.
- Kits and games are discovered by `studio/discovery.ts`, which scans `studio/kits/<kit>/` (a `kit.meta.json` and an
  `index.ts` exporting `KIT`) and `studio/games/<game>/` (a `game.meta.json` and a `blueprint.ts`) at startup. Adding
  either is adding a folder, so no shared file is edited and `.gitattributes` no longer has union lines.
- Tin Can Telephone's scenario timed out once in five runs ("waiting for the guesser's turn"), only while other
  scenarios were running at the same time; it passes alone. Not made deterministic; treat as load-sensitive.

## Browser QA (Haiku testers, stub models, 2026-11-04)

Each tester opened `/screen/?studio=1` in the browser pane, ran the game's scenario against that room, took
screenshots of the TV, and opened one phone page at 390x844. Phones only got as far as the join screen, so
phone-side game screens were not looked at. Pre-reveal secrecy was checked on the TV only where a screenshot
happened to land before the reveal; the scripted scenarios check it exhaustively.

| Game | Browser result |
| --- | --- |
| Who Fits | passed; no console errors; TV readable |
| Past the Gate | passed; no hidden rule or cargo on the TV before reveal |
| Off by a Mile | passed; no guesses or bets on the TV before reveal |
| Mind the Gap | passed; row of 7 wraps and fits; new card's date before reveal not captured |
| Wrong Room | passed; no place or stranger on the TV before reveal in the shots taken |
| Stray Word | passed; no word or stray on the TV before reveal in the shots taken |
| Tin Can Telephone | scenario timed out in the shared run; fixed the scenario (it followed one guesser) and it passes twice alone |
| Painted Whispers | played to the end, readable; its scenario failed only because another game shared the picture stub; passes alone |
| Clue Gallery | same shared-stub failure; passes alone; pre-reveal card spread not captured |
| Two Takes | not browser-tested; passes with the real key |

Found: the shelf screen's spine labels are clipped and broken across lines once the shelf is long ("Pas / the
/ Gat"). That is the shelf UI, not a game. One caption on Painted Whispers link 3 looked faint against its glow;
not confirmed.

## Held back

A game's `"level": "held"` and `reason` in its `game.meta.json` (collected as `HELD_BACK` in `studio/shelf.ts`) keep Painted Whispers and Clue Gallery off (Two Takes was cleared after its real-key pass) the `?studio=1` shelf
until a run against the real picture model (cost and latency) and the real classifier clears them; delete the
game's line to put it on. Start the room with `STUDIO_SHOW_HELD=1` to see them anyway (the scenarios need it).
Any new game that passes goes here until a human or real-host run clears it, except tap-only games.

## Real-key runs (Application, at 22fe2ec)

- Painted Whispers: passed; 4 pictures, 8.8 to 21.7 s each, about $0.04 a game.
- Clue Gallery: passed; 20 pictures, 7.6 to 24.4 s (median about 17 s), about $0.20 a game (listed $0.01 per
  image; bill not checked). The room's cap of 40 pictures covers only two Clue Gallery games. A failed picture
  was not exercised (none failed).
- Two Takes: did not pass at 22fe2ec because of two scenario faults (a race in the refused-line step and a
  literal "Answer A:" the real host does not say). Both fixed at 299a97e; one more real-key run pending.

## How to start the newest games

Open `/screen/?studio=1` and pick the game by name. Under the Cup and Magpie Pockets (and Who Fits) are on
the shelf. Name Tag, Cold Read, Blank Verdict, Lonely Clues, Pantomime Panic, Blank Truth and Ghost Writer
have level `held` in their `game.meta.json`, so the room server must be started with `STUDIO_SHOW_HELD=1` to show them. Each is
held with the reason "no run with the real host yet" until someone plays it with the real host.

Scenarios in `tools/scenarios/`: games on the stub model use `tools/stub-model.ts` (Cold Read needs
`tools/stub-host-model.ts` with `STUB_PLAN=win` or `lose`; Blank Truth, Ghost Writer and Two Takes use
`tools/fake-meta.ts`). Blank Verdict and Lonely Clues take about five minutes on real clocks.

## Shelf levels

- `/screen/?studio=1`: the curated Studio shelf (games whose level is `visible`).
- `/screen/?studio=all&key=...`: the same plus every held game, each with "Testing." at the start of its pitch.
  Off unless the server has `STUDIO_ALL=1` and `STUDIO_ALL_KEY`, and the key matches; otherwise it is the plain
  shelf. The new-room button keeps the query, so a testing room stays a testing room.
- Anything else: the plain shelf.
