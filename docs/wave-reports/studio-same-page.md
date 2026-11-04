# Studio: Same Page

Branch `studio-same-page`, from `origin/master`. One new kit (`match`) and one game on it (Same Page,
id `samePage`; `same-page` was a working name), level `held`, so it appears only on the held shelf. Nothing
here was run against the real host, a real voice, a real phone or a real TV: this environment has no model
key and no hardware. Read "What I could not verify" before trusting any of it.

Author on every commit is Ambrose Nilam, the author of the latest commit on `origin/master`. No
attribution lines anywhere. `master` was not touched. `room/`, `phone/`, `shared/` and `screen/` were not
edited. The only shared file touched is `tools/fake-meta.ts` (test tooling: the stand-in model learned to
answer the closed "same thing" question).

## What it is

Eight prompts, 20 seconds to type, 10 seconds to look; 3 to 8 players; about six minutes. The host writes
each prompt from a fixed stem (six general, two about the room) with a bank of 24 in code behind it. Cards
that match stack. You score one point per other card in your stack; a stack of exactly two scores two each;
the lone card takes the hat; whoever holds it at the end loses two; ties on the hat go to nobody; no hat at
three players. Files: `studio/kits/match/` (kit, pure `stacks.ts`, paper players, tests),
`studio/games/same-page/` (`blueprint.ts`, `game.meta.json`, `script.md`), `tools/scenarios/same-page.ts`.

## What passes, and how it was tested

- `npm run check` on the final commit: verify.py ok, tsc clean, eslint 0 errors (44 line-length warnings,
  3 of them in the new scenario file; the rest were there before), 631 tests pass.
- **Kit tests (32):** the local merger and near-misses, the hat, scoring, prompts from the host or the
  bank, privacy of cards, hostile line, stale or late events, the seam and the closed question (join on
  yes; "no", garbage, a stale round number, an out-of-range pair and a missing reply all mean separate),
  leaving players, no names sent to the seam or told to the host.
- **Rehearsal (`studio/check.ts` default):** nine paper players (one mind, one odd card, everyone
  different, pairs, look-alikes, hostile box, silent table, one writer, walkouts) on five seeds, at five
  seats and at three: 90 games, every one ends, every phase reached, no problems. The leak check covers
  every viewer's whole view for every typed card until the reveal.
- **Scripted game in the real room, with the stand-in model (PASS):** `tools/scenarios/same-page.ts`.
  Game one, four players, all eight prompts; game two, three players, all eight prompts. It checks:
  - **Hostile lines:** a bracketed instruction and a line the classifier refuses are both refused with the
    box left open, and reach no phone, the TV or the host.
  - **Leak check:** no card reached any other phone, the TV, or the host before the reveal, and not even
    its author's phone; the host was never told a player's name beside a card.
  - **Merges:** "Pizza", "pizzas" and "Pizza!" stack; bat, bait, bag and bar stay four cards; "ice cream"
    and "cream cheese" stay apart; "bat", "bats" and "baseball bat" stack after the closed question.
  - **Scoring:** a pair scores two each, a stack of three two each, four three each, a lone card nothing.
  - **Silent player:** one player stays silent and the others get a full reveal at the clock.
  - **The hat:** moves to the only lone card, stays on a tie, costs two at the end (final 13, 11, 9, 5).
  - **Three players:** no hat anywhere, final screen included.
  The first run found a real bug (below), and the second found a bad regex of mine in the scenario.
- **Screens:** screenshots of the real TV page (1280x720) and a real phone page (390x844, iPhone-shaped) during a game are readable: the prompt, the
  cards-in marks and the countdown; paper cards for the stacks with the hat's card in wine; a phone
  that shows the prompt above a box and, at the reveal, one large line. Not committed; they are in the session scratchpad.

## Choices on ambiguous words

- The same word typed twice is one stack whatever each player meant: "bat" and "bat" stack even if one
  meant the animal.
- A word beside a longer phrase ("bat", "baseball bat") is a doubt, not a match: it goes to the seam,
  then the closed question, and stays apart without a yes. With no model it is separate.
- Near-misses never merge locally (bat/bait, tea/team, sun/son, ice/rice, ham/hamster, pen/pencil,
  mist/mint). Synonyms only merge if the seam says so. Nothing chains (moon, moonlight, light).
- "Ties on the hat go to nobody": with two or more lone cards in a round the hat stays where it was. A
  round with fewer than two cards moves nothing.

## What the real room taught me

The room does not seat players in join order. My first scenario run showed a stack's "first card" and the
closed question's pair were wrong for that reason. Fixed: a stack is named by its shortest card and the
question carries the exact pair of cards that looked alike.

## Weaknesses

- **The seam cannot say whether Jev answered.** `mergeRequest` returns groups only, so a silent Jev and a
  Jev that said "no" look the same. I send a made-up pair ("quillbeam lamp", "quillbeam lamps") along with
  the answers: if the seam merges it, it is alive and its "no" is final; if not, the closed question is
  asked, for up to four look-alike pairs. A Jev that misses the made-up pair would hand its "no" over to
  the closed question. A core change (a `source` on `answersMerged`) would remove this workaround.
- The closed question reuses the content seam: one call, no ids, so I put the round number in each
  line and ignore replies for another round. A late reply from round N is ignored in round N+1.
- **Stacks on the TV** are one paper card per stack with "stack of 3" under it, not a drawn pile. A real
  stacked-card look needs a `screen/` change (new block type); I did not touch `screen/`.
- On the phone, the shell's muted-phase text ("Phones are quiet for now / Marlowe will say when it's
  your turn") sits under the box during writing. It is core copy, and it reads as if the player
  has no turn while the box is open. A core fix.
- Three players is the thinnest table: with no hat the game is only matching.
- Synonyms ("couch", "sofa") merge only through Jev; without it they never do.
- No nudge at ten seconds: the host cannot speak unprompted; the countdown does that job.
- Scores can go below zero (the hat's cost at the end).

## What I could not verify

- Anything with the real host or Jev: the wording of the host's lines, whether the host's prompts from
  the stems are good, how Jev and Spark judge real pairs, and the 800 ms seam timing under load. The
  stand-in model repeats the last game note word for word and answers the closed question by a
  rule (yes only for bat and bats pairs), so it proves the plumbing, not the judgement.
- A real phone and TV: iOS keyboard behaviour, the 20 second clock under real typing, voice.
- Whether a table finds it funny. Run it with people before changing the level to `visible`.

## To run

```
node tools/fake-meta.ts
META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=<any text> GAME_ROOM_TEXT_ONLY=1 STUDIO_ALL=1 STUDIO_ALL_KEY=testing npm run room
ROOM_SWITCHES="studio=all&key=testing" SCENARIO_STAND_IN=1 node tools/scenarios/same-page.ts
```

A pass prints PASS and takes about five minutes. With real keys, drop the stand-in lines; the closed
question's answers will differ, so the bat round's stack may differ.
