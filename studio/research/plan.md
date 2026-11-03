# Funhouse Studio: build plan

_Phases that each end in something a person can use. Written 2026-11-03 against `master` at
`f0d1c1f`. Effort is in working days for one developer who knows the repository, with an agent
writing against the contract; it does not include design review on a real television, which is
listed separately in each phase. Risks are at the end, biggest first. Nothing here is started._

## The first usable slice

Remix a shipped game by changing its decisions, rehearse it with paper players, put it on your
shelf and play it. Twenty Doors is the game, because it already carries every structure the slice
needs (a secret, a judge, a clock in the form of a door count, a reveal) and has the simplest
scenario script to adapt. The slice is usable without the model at all: a creator can change the
door count, the categories and the warnings, rehearse without the host, keep it, and play it with
the real host, and nothing in that path calls Spark until the game is played.

## Phase 0: foundations (4 to 5 days)

What a person can use at the end: nothing new on the TV. The team can express Twenty Doors as a
blueprint and run it through the existing room and scenario.

- A `studio/` folder with the blueprint type: structures, decisions, name, box lines, host manner,
  fallback content. Decisions are a closed set of typed values; no free text except word lists.
- The interpreter cartridge: one `Cartridge<State>` configured by a blueprint, covering the secret
  and judge structures, with `init`, `onEvent`, `apply`, `publicScene`, `privateControls`,
  `hostFacts`, `outcome`, and "because" facts on the `system` scope.
- Twenty Doors expressed as a blueprint, registered beside the hand-written one, passing
  `tools/scenarios/twenty-doors.ts` unchanged against the room in text-only mode.
- A mutable installed-games source given to `Room` (contract item 1), read by `brief`, `startGame`
  and the shell, with `GAMES` as its initial contents.
- The in-process structural harness: fixed random, scripted personas, the invariant checks listed
  in `studio.md`, a tally. Run as `node --test` like the Werewolf tests.

Needs from the contract: item 1 (shelf source), and a decision on item 5 (prefix option ids for
now). Verified by: `npm run check`; the Twenty Doors scenario passing against the blueprint version;
twenty structural rehearsals of the blueprint version in under a second with all invariants
holding; a deliberately broken blueprint (secret in a public fact) failing the leak check.

## Phase 1: make it yours (7 to 9 days)

What a person can use: open Twenty Doors, choose "Make it yours", change cards, rehearse without
the host, keep it, see it on the shelf, play it with friends. The first usable slice.

- Shell screens for the card row and the box (contract item 3): `ShellScreen` grows, `room/shell.ts`
  handles focus and flip, the screen renders cards as paper with hard shadows, the phone shows the
  touch surface and a single card for a slow choice.
- The rehearsal screen, structural mode only: paper players, the real scene blocks at speed, pause
  on hold or tap, the cards in play below the frozen scene, replay from the round start with the same
  seed.
- "Keep this": a version in the store (contract item 2), the box on this room's shelf, the
  back-of-box lines generated from decisions, name suggestions as plain concatenation (no model).
- Pause menu row "Change this game" for the creator, opening the card row at the current moment.
- The box name card with "Say it" as the one model-free voice path (transcription only).

Needs from the contract: items 2 and 3. Verified by: `npm run check`; a new scenario script that
drives the shelf to "Make it yours", changes the door count by navigation events, rehearses, keeps,
and plays the kept game to the end with the real host, failing if the kept game's door count is not
the changed one; screenshots of every Studio screen at 1920x1080 and 1366x768 in all states (empty,
one card, long name, model unavailable, disconnected); one evening with a real phone and a real
television, recorded as done or not done in the commit message.

## Phase 2: rehearse with the host, explain, repair (5 to 6 days)

What a person can use: a rehearsal where the host rules on the paper players' speech; "why" at any
pause; a proposed card after a rehearsal; a change replayed on the same round.

- Host rehearsal through the text-only path inside the same process: `FakePhone` and `FakeScreen`
  equivalents driven by the rehearsal screen, a question bank per structure, the leak check as a
  general invariant over host-scoped facts, a "studio" budget line (contract item 7).
- The trace and the why column, built from "because" facts and the timeline, read by the host.
- One proposal after a rehearsal: a card with old and new values from the tally, applied by a tap.
- Versions listed on the box page, named by the biggest change, step back and forward, pinned per
  room.

Needs from the contract: item 7; no other change. Verified by: a scenario that rehearses with the
host, asks why at a known moment, checks the column names the right card, changes it, and checks the
replay differs only where it should; a measured cost per host rehearsal in Spark calls and seconds,
written into the commit message; the leak check failing on a blueprint whose host brief names the
secret.

## Phase 3: roles, votes, clocks; the structure shelf (8 to 10 days)

What a person can use: start from a structure, compose structures, make a game in the Werewolf and
Quizmaster families without code, say a game to the host and get cards back.

- The interpreter grows to roles and teams, votes with a tie decision, phase clocks, and the reveal
  phase with a picture; Werewolf and Quizmaster expressed as blueprints passing their scenarios.
- The structure shelf with ten-second examples; composition rules between structures.
- "Say it to me": structured output from Spark constrained to structure ids and decision values,
  three questions at most, guessed values marked, the odd constraint kept as a card.
- Box art through a studio-level drawing call (contract item 4).
- Browsing remarks, pitch and the host's per-phase briefs generated per version, shown as cards.

Needs from the contract: item 4; item 6 resolved for `choice.multiple` if any structure needs a
multi-select, otherwise avoided. Verified by: both shipped scenarios passing against blueprint
versions; a scenario that says a described game and checks the cards laid match a fixed expectation
for a fixed transcript (the model's output is recorded and replayed in the test); structural
rehearsals showing the Mafia balance curve for 5 to 10 players against the theory; design review of
the structure shelf screenshots by someone who did not build it.

## Phase 4: sharing (4 to 5 days)

What a person can use: give a game a code, add it to another room's shelf, see lineage and a line of
thanks, see plays finished on the box.

- Codes and lookup in the store; "Add a game" on the shelf; lineage on the box; the thanks line by
  voice; play counts recorded at `outcome`.
- Several short shelf rows ranked by plays finished and replays in the week, no single list, no
  likes.
- Content moderation at the boundary: names, word lists and thanks lines pass the same family-table
  rule the host already applies to content, and a game can be removed from a shelf.

Needs from the contract: none beyond the store. Verified by: two rooms in one process exchanging a
game by code; a scenario where a room pinned to version 2 keeps playing it while version 3 is kept
elsewhere; the ranked rows changing when plays are recorded.

## Phase 5: measurement and the next structure (ongoing; first pass 3 days)

What a person can use: the same product, with the questions the evidence could not answer being
measured.

- Sessions to a second game; mechanical distance between a remix and its source (which decisions
  changed, which structures were added); return after friends have played; cost per accepted
  change; rehearsals per kept version.
- The first structure outside the five, chosen from what creators asked the host for and could not
  get, logged as counts only (never the words). Each new structure is a programmer's work with its
  own controls or blocks and its own personas.

## Totals

| Phase | Days | Cumulative |
| --- | --- | --- |
| 0 Foundations | 4 to 5 | 5 |
| 1 Make it yours | 7 to 9 | 14 |
| 2 Rehearse, explain, repair | 5 to 6 | 20 |
| 3 Structures and intent | 8 to 10 | 30 |
| 4 Sharing | 4 to 5 | 35 |
| 5 Measurement | 3, then ongoing | 38 |

About eight working weeks for one developer to the end of Phase 4, with the television review
evenings on top. The estimate assumes the shell and screen code are as regular as the room code is;
the screen renderer has not been read for this plan, and a day of reading it belongs at the start
of Phase 1.

## Risks, biggest first

1. **Every game comes out the same.** Five structures with a few decisions each is a small space,
   and the model will pull creators toward the same defaults [E19, E20]. Mitigation: mechanisms not
   genres on the shelf; the odd constraint kept as a card; mechanical distance measured from Phase 1
   and read every week; a new structure added when the measure flattens. If after Phase 3 most kept
   games differ from their source by one numeric decision, the design has failed its own bar and the
   structure vocabulary, not the interface, is what to change.
2. **Authoring on a television with a thumb does not work.** Card rows and flips are untested on a
   real set and phone; the evidence for direct manipulation is from desktop tools [E24]. Mitigation:
   Phase 1 ends with a real television evening before Phase 2 starts, and the design accepts that a
   word list is the one thing typed on a phone.
3. **Host rehearsals are slow, costly and nondeterministic.** Each is a real game with real model
   calls; the scenario scripts take minutes. Mitigation: structural rehearsals carry the loop and
   host rehearsals run only on "Keep this" and on request; the question bank keeps the paper players
   cheap; recorded model output makes the tests replayable, as the planning notes' review already
   proposed.
4. **A leak through the host brief.** `GameSession.brief` passes `hostFacts` to the host unfiltered,
   and the host brief text is generated. The interpreter is the one place that decides what the host
   knows, so one mistake leaks in every Studio game. Mitigation: the leak invariant runs on every
   structural rehearsal and on the generated brief text; the scenario leak check is kept.
5. **The shelf and the store are new infrastructure in a product that has none.** Persistence,
   codes and moderation of shared names and word lists are outside everything the room does today.
   Mitigation: a file per blueprint, codes without accounts, the host's content rule applied at the
   boundary, and removal from a shelf before any gallery.
6. **The declared-but-unenforced fields mislead the design.** `hostMayInterject`, `silenceSeconds`,
   the `silence` event and `choice.multiple` look available and are not. Mitigation: Studio offers
   no decision that depends on them until the room implements them; the plan lists them in Phase 3
   as "avoided or resolved".
7. **The structural harness passes games that are not games.** A blueprint can terminate, reach
   every phase and leak nothing and still be dull. Mitigation: the tally never claims more than it
   counted, and Phase 5 measures whether kept games get played to the end by friends, which is the
   only measure of fun this plan trusts.
8. **Estimate error.** The screen renderer and phone are unread for this plan, and the Studio
   screens are the largest new surface. The Phase 1 range is the least certain; a 50 percent overrun
   there moves the total to ten weeks.
