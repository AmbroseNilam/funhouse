# Studio wave 2: three games that take typed answers

Branch `studio-wave2-text`, from `master` at `2de0d6f`. Three complete games on three new kits, each
with a blueprint that passes `studio/check.ts`, a scripted scenario, a leak check and a run in a real
room. All of them sit on the `?studio=1` shelf only. Nothing in `room/`, `shared/` or the phone page
was edited.

| Game | Kit | Catalog | Players | One round |
| --- | --- | --- | --- | --- |
| Two Takes | `wit` | #6 head-to-head wit | 3 to 8 | One host-written prompt, two players answer in secret, the others vote, the host performs both answers and picks callbacks |
| The Blank Truth | `bluff` | #7 bluff trivia | 3 to 8 | A real fact with a blank, everyone writes a fake, answers that mean the same merge, the room picks the truth, the host reads every option in one voice |
| Ghost Writer | `bot` | #25 spot the bot | 3 to 8 | Everyone answers a prompt, the host's model writes one more, everyone votes for the machine's |

They differ in mechanic, not words. Who answers: two against the room, everyone against the truth,
everyone against a machine. What the vote is about: which is funnier, which is true, which is
not human. What scores: votes won, fooled friends, a spotted decoy.

## The one thing to know about every "pass" below

**This sandbox has no model keys, so no run here used Muse Spark.** Every room run used a stand-in
for the Meta Model API, `tools/fake-meta.ts`, pointed at with `META_BASE_URL`. Its "host" repeats
whatever the game last told it, word for word, which is the worst case for a leak: if a game ever
tells the host something private, the TV caption shows it and the scenario fails. Its content writer
returns fixed prompts, facts and a decoy; its moderation classifier says yes unless a line contains a
marker. So the runs prove the real room, the real shelf, the real local layer of the content filter,
the real screens and the games' rules work together. They prove nothing about Muse Spark's wording,
its judgement of a fact, its reading of which answers mean the same, or whether its decoy is any
good. Each of those is listed below under what to check on a machine with keys.

## What passes

Run before every push: `python3 tools/verify.py`, `npx tsc --noEmit`, `npx eslint .` and
`npm test` (all of `npm run check`). At the end: all three scenarios pass again on the final code (after the layout and style changes), and 179 tests pass, none fail, no ESLint errors, and no
warning in any file this branch added or changed (the seven that remain are in `cartridges/`, `phone/` and `room/`, and were there before).
The sandbox runs Node 22.23, not 24, with type stripping; nothing here needed a newer feature.

For each game:

- **Rehearsal** (`studio/check.ts`, no model): paper players play whole games on a virtual clock
  across five seeds. Two Takes: 10 personas, 50 rehearsals. The Blank Truth: 11 personas, two model
  behaviours (failing; and finding the first two answers alike, which makes the first fake the truth),
  110 rehearsals. Ghost Writer: 11 personas, two model behaviours (failing; and writing one line for
  everything), 110 rehearsals. Every one ends, every phase is entered, and the harness reports no leak,
  no unexplained fact, no throw and no mutation of state. The personas cover a full table, a silent
  table, one lone answer, identical answers, a hostile box, nobody voting, a writer who walks out, a
  voter who walks out, and a table that shrinks to two.
- **Planted faults are caught.** Each kit's tests rebuild the game with a leak planted (a private
  answer on the TV during writing; the true answer on the TV early; authors' names beside the answers
  in the vote) and check the rehearsal names it. A harness that can't see a leak isn't a leak check.
- **Unit tests** per kit (19, 23 and 19 tests) and for the shared helpers (9): private text stays
  private, the options show no names and nothing marking the right one, the right one lands in every
  position from some seed, nobody is offered their own answer, scoring, every way a round can end
  without a vote, a leaver, stale timers and a box that has already been used.
- **A scripted scenario in a real room**, against the stand-in model, each printing `PASS`:
  `tools/scenarios/two-takes.ts`, `blank-truth.ts` and `ghost-writer.ts`. Each plays the whole game
  with four fake phones and checks, in the room's own views, that: a bracketed instruction to the host,
  an email address and a line the classifier refuses are each refused with the box left open and are
  shown to nobody, ever (the TV, the host's captions and every phone's every view are searched); no
  private answer reached any other phone, the TV or the host before the vote; the vote shows no
  writer's name and nobody is offered their own answer; the reveal marks the right answer and the
  winner is the one the votes chose; and the game ends on its final scores. The room's log shows
  `[studio] starting blueprint ... on the ... kit` and one line per refusal naming only a category.
  For The Blank Truth it also checks the true answer typed as a fake is turned away, a fake the model
  reads as meaning the truth is dropped, two fakes it reads as one become one option, and a fact the
  second look rejected never appears. For Ghost Writer it also checks the decoy was trimmed to the
  humans' style.
- **The screens were looked at.** I built the TV and phone pages, ran each game with a real Chromium
  TV at 1920x1080 and a real Chromium phone at 390x844 (touch, device scale 2) beside fake phones,
  and read the screenshots. That found two problems, both fixed: a tall stack (a long prompt, five
  options, instruction and timer) ran into the lantern and hid the countdown, and the reveal table cut
  off each writer's name. Options now drop to normal type above three, redundant instruction lines are
  gone (the TV's turn banner already says them), and reveals are lines of text, not a table.

## Two Takes

- **Passes**: the above, plus matchups (everyone writes twice up to five people, at least once
  above that), refusal of a box that could open a ruling and a new box with a note, a walkover when
  one writer is silent, no vote when both write the same thing even spelled differently, and callbacks
  that only ever offer a line that already won and never the same line twice.
- **Host lines** (polished in the brief and in `script.md`): the host performs A, a beat, B, in one
  voice, then calls the vote; it is told not to pick, hint or guess authors; the reveal is told to
  praise the winner and give the other writer a kind word, never a joke at their expense; replies are
  about twenty-five words or fewer, with a register example it is told never to reuse.
- **Known weaknesses**: three players is a duel judged by one friend, with no ties, and works but is
  thin; eight players get one answer each in four rounds. The model's prompts come out mild because
  the room tells it its content is "suitable for all ages". An answer is capped at 80 characters by the
  room.

## The Blank Truth

- **Passes**: the above, plus a two-step fact path (see weaknesses), merging by spelling in code
  (case, punctuation, "the" and "a", plurals, number words, one slip; "round 1" never merges with
  "round 2"), the model's reading as a second merge pass, a fake that means the truth scoring for its
  writer, three tries at a fake and then the writer sits out without holding the round up, and a pick
  that is skipped when nobody has a real choice.
- **Host lines**: told the options in curly quotes, to read every one in the same voice at the same
  pace with no reaction, never told the true answer until the reveal (the truth is in no scene, brief
  or fact before the options open, and then it sits unmarked among them), to tease the fake and never
  the person it fooled.
- **Known weaknesses**:
  - **Fact accuracy is the real risk.** The model writes facts, and a second request asks it to
    confirm each one; only confirmed facts are used and anything else falls back to the bank of
    eleven. That is the model grading its own work: it lowers the chance of a wrong "truth" and does
    not remove it. The bank facts are things I'm confident of (flamingo group, bananas as berries,
    wombat droppings, three octopus hearts, the Scottish unicorn, Cleopatra and the Moon landing,
    crows and faces, the Eiffel Tower in summer, butterflies and their feet, polar bear hairs, a
    Venusian day against its year) but I checked them from memory, not against cited sources, and a
    reviewer should. Some have a second defensible answer a writer might type ("sun" for "heat").
  - Spelling merge is conservative; "Napoleon" and "Bonaparte" only merge through the model.
  - The truth typed as a fake is turned away privately, which tells that writer they had it.
  - The room strips underscores from what the host says, so the host is told to say "blank".

## Ghost Writer

- **Passes**: the above, plus the decoy path: the machine's answer is requested separately (so it is
  never in the host's own memory), shown up to four of the humans' answers as JSON data and none of
  their names, trimmed by code to their casing and punctuation, refused if it copies a human or is
  much longer than theirs or is unsafe, and replaced by the game's own answer for that prompt; if the
  prompt was the model's own there is no safe replacement, so the round is called off.
- **Host lines**: reads every answer the same, does not know the machine's, owns up dryly at the
  reveal, praises a human answer nobody took for the machine, never mocks anyone for sounding like one.
- **Known weaknesses**: how good the decoy is can't be measured here; a table playing is the test.
  The model's prompts are mild for the same reason as above. With three players a vote has three
  voters each seeing three answers. A decoy that beats the room every time is as bad as one that never
  does, and nothing tunes for it yet.

## What could not be verified

- Anything with Muse Spark: the host's actual words and register, fact checking, merge judgement,
  the decoy, prompt quality, how often the model's output passes the kit's checks, and the real
  classifier (the stand-in's only says no to a marker). **To run, on a machine with keys**:

  ```bash
  GAME_ROOM_TEXT_ONLY=1 npm run room
  ```

  ```bash
  ROOM_STUDIO=1 node tools/scenarios/two-takes.ts
  ROOM_STUDIO=1 node tools/scenarios/blank-truth.ts
  ROOM_STUDIO=1 node tools/scenarios/ghost-writer.ts
  ```

  A pass prints `PASS` as the last line. The Blank Truth and Ghost Writer scripts skip the checks
  that need to know the true answer or the decoy when the facts and prompts aren't the stand-in's, and
  say so; Ghost Writer then finds the decoy by elimination. Read the host's lines in the output for
  voice. Three things to watch for: the host reading the options with a tell, saying who wrote what
  before the reveal, and mocking a player.
- A real iPhone (touch, keyboard covering the box, autocorrect on a fake). The phone layouts were
  checked in Chromium at 390x844 only.
- The TV at 1366x768 was checked only for The Blank Truth's pick with four options after the fixes: it fits, but the options are in normal type (small at that size) and the timer's label touches the top of the lantern. Two Takes and Ghost Writer were checked at 1920x1080 only, and the five-option case at 1366x768 not at all.
- Voice. `GAME_ROOM_TEXT_ONLY=1` has no speech, so how long the host takes to read five options out
  loud against the 12 second reply limit is unmeasured.
- A real table. Whether the games are funny is not something a rehearsal says.

## Changes the core would need (not made: `room/`, `shared/` and the phone page are not mine)

1. **The phone's surface text contradicts its own box.** With a text box or ballot open, the phone
   shows the "Your turn" banner and a card, then "Phones are quiet for now / Marlowe will say when it's
   your turn" below (`room/room.ts:2108`, `phone/src/App.tsx:260`). In a typing phase the status for a
   muted phone should say something like "Type your answer above" or be left out.
2. **The content writer's system prompt says "family party game... suitable for all ages"**
   (`room/room.ts`, `writeContent`). The brief allows an adult table; every prompt, fact and decoy
   comes out mild. A game should be able to pass its own system line.
3. **The host's spoken text drops `_`, `*...*`, `#`, `` ` `` and `~`** (`room/host.ts:435`), so a blank
   written `____` vanishes from captions. The games tell the host to say "blank"; a caption that kept
   the underscores would be better for a fact with a blank.
4. **A text answer sent inside the room's one-second gap is dropped without a word**
   (`TEXT_ANSWER_GAP_MILLISECONDS`). A person won't hit it, a double tap might; the phone could say so.
5. **The TV places its blocks top to bottom with the lantern bottom left**, so a tall stack hides the
   timer. The games keep their stacks short; a layout that never overlaps would remove the constraint.
6. **No way to show a writer their own sent text back**, and the label on a sent box is a fixed
   "Sent." A phone that echoed the answer ("You wrote: ...") would let people spot a typo they can't fix.
7. `GameSession` has no error boundary around a cartridge, as `studio/HANDOFF.md` already says.
8. The seeded random in `studio/kit/primitives.ts` barely differs between neighbouring seeds, so
   rehearsal seeds 1 to 5 explore less than they look; the unit tests use well-spread seeds.

## Layout

- `studio/kit/text.ts`: shared helpers (line parsing, host-text check, shuffle, merging by spelling,
  reading the model's groups, scoring, quoting a player's words for the host).
- `studio/kits/wit.ts`, `bluff.ts`, `bot.ts`, each with a `.test.ts`.
- `studio/personas-text.ts`: the paper players for the three kits. `studio/rehearse.ts` gained an
  `answer` move and lets a persona see its phone's controls; `studio/check.ts` and
  `studio/blueprint.ts` dispatch the new kits.
- `studio/games/two-takes/`, `blank-truth/`, `ghost-writer/`: `blueprint.ts` and `script.md` (the
  experience script, the host's lines, awkward cases) for each.
- `tools/scenarios/two-takes.ts`, `blank-truth.ts`, `ghost-writer.ts`, `text-support.ts`;
  `tools/fake-meta.ts`, the stand-in model, and `tools/stand-in-marker.ts`.
- `tools/simulate.ts`: the fake screen and phone now keep every scene and view they were sent.

## Merging

Each game's shelf registration is its own commit and touches only `studio/shelf.ts`, so merging one
game without the others needs nothing else. One commit also changed `studio/shelf.ts` to compile
(the pause-action line no longer assumes a decision every kit has); it is in the first commit of the
Two Takes work. Commit hashes of the three registrations: see `git log --oneline -- studio/shelf.ts`.
