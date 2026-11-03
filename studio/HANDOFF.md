# Studio handoff

For an agent continuing on branch `studio` with the repository only: no private notes, no
hardware and no model keys. Written 2026-11-03. Read `DESIGN.md` and `CLAUDE.md` first; both
are binding. Then read `studio/research/studio.md` for the design and `studio/research/plan.md`
for the original phases, with the changes below.

## Goal, in order

1. **Reusable game kits.** A kind of game is a small, reviewed cartridge that declares typed
   decisions; a blueprint is `{ kit, decisions, box }` rather than a description of every rule.
   The Phase 0 interpreter in `studio/interpreter.ts` becomes the first kit (guessing: a secret
   the host holds, a judge that rules on speech, a count that runs out). Pull the parts a second
   kit will need into shared primitives: seat scores, rotation, collect-then-reveal, tally with
   ties, seeded random, a question budget. Build only what Leading Questions needs; don't
   generalise ahead of it.
2. **Leading Questions**, the first new game (working name, unchecked against trademark
   registers). Its shape is below. Deliver the game and its experience script together.
3. Out of scope for now: games that need typing on phones (one-word-clue and judge games), the
   builder site, and anything to do with drinking. Nothing in the demo narrative needs this
   branch; don't shape work around the hackathon video.

## What is here

- `studio/blueprint.ts`: a game as data, Phase 0 shape. `studio/interpreter.ts`: turns one into a
  `Cartridge<State>`. `studio/rehearse.ts`: a structural rehearsal with paper players and no
  model. `studio/shelf.ts`: installs blueprints and swaps them in for hand-written games with
  the same id. `studio/games/twenty-doors.ts`: Twenty Doors as a blueprint.
- A room opened with `/screen/?studio=1` gets the Studio shelf: the blueprint Twenty Doors in
  place of the hand-written one, and blueprint games with new ids after the hand-written ones.
  Every other room is unchanged. The server-wide `GAME_ROOM_STUDIO_SHELF` flag this note first
  described is gone; the room needs no flag, and a scenario asks for a Studio room with
  `ROOM_STUDIO=1`. Starting a blueprint game logs which one ran.
- `master` now carries an optional `turn` on the cartridge contract (`shared/turn.ts`): `anyone`,
  `everyone` with done ids, `one`, and `secret` with a label only. Map asking to `anyone`, a vote
  to `everyone`, and dealing a role to `secret`. Never show a count on a secret turn.

## Findings to design by

These come from research that is not in the repository. Treat them as constraints.

- **What the host can judge.** It is reliable for one utterance against a closed list of rulings
  when the truth is in its brief, and for matters of taste. It is unreliable at holding state,
  counts or scores, at resisting persuasion (players will lobby out loud, and the failure
  direction is leniency), at keeping a secret under pressure, at speed, and at anything visual.
  The rule: ask the model only where a wrong answer costs a funny moment, never the game's
  integrity. Code decides everything else.
- **Never give the host hidden roles.** Code deals them and shows them on phones. The host may
  hold the word, as it does in Twenty Doors, and a leak is a recoverable moment, not a breach.
- **Host throughput.** One ruling per reply, a 12 s reply limit, 20 replies a minute per room.
  A four-minute question phase can exceed that, so the game keeps a question budget in code
  and says how many are left.
- **Why not copy Werewords' shape.** Its tension comes from a Mayor who may secretly be the
  werewolf and may lie. A host answers honestly, so that version loses its point. Insider's
  shape fits: a trusted answerer, one hidden helper who already knows the word, and a vote.
  This is untested at a real table; the script and a playtest decide whether the tension holds.
- **Group size.** Design for 4 to 8. Three is a dead zone for most party games; say what the
  game does with three. Above eight, yes/no games turn chaotic; cap or split.
- **What kills a session and what fixes it.** Sessions die from stalling on one player, silence,
  the wrong number of people and stale prompts. The structural fixes: a timer on the spotlight
  role, no elimination, everyone acting at once where possible, and every round ending as a
  success. Four of seven failure modes belong to the host: explaining too long, pacing, rulings
  and a flat ending. Write the host's brief to own them.
- **The rehearsal harness is not yet trustworthy.** Fed twelve deliberately broken Twenty Doors
  variants, it caught two and crashed on one. It missed secrets placed in a roster badge, a
  tally label and on every phone, secrets spelled with spaces or reversed, rulings that silently
  stopped working, and in-place state mutation. It also cannot rehearse Werewolf or Quizmaster,
  because timers fire before anyone can act. Before relying on it: a per-viewer diff of hidden
  values, a virtual clock, rehearsal generic over any `Cartridge<State>`, and an error boundary
  around a cartridge in `GameSession`.
- **Free text is a trust boundary.** Host text in a blueprint reaches the live host's brief, so
  it comes from templates and fixed manners, never from a creator. Word lists get the same
  content check the host's own output gets.
- **Audience.** Adults, 18 and over. The host keeps its friendly table tone by default; that tone
  holds adult rooms. No drinking content and no framing around children.
- **Rights.** Mechanics and folk games are free to use; names, card text, word lists and a
  product's look are not. Use original names, let the host write words at play time, ship no
  published word list, and don't use "Werewords", "Insider" or any other product name anywhere a
  player sees.
- **A trending cousin.** The late-2025 short-video hit is a word game where everyone gets the
  same word except one person, clues go round the circle one word at a time, then everyone
  votes. It could be a second mode on the same kit later; note it, don't build it yet.

## First tasks: findings from an independent review of this branch

A read-only review on 2026-11-03 confirmed the conflict resolution and the shelf migration and
found these, each reproduced. Fix them while building the kit, since each one is a kit concern:

1. The rehearsal checks only title and text blocks for the secret and never checks phone
   controls. A blueprint whose count label equals the fallback secret passes. Check every
   viewer's whole view, including labels, rosters, tallies and controls (`studio/rehearse.ts`).
2. Installed blueprints keep references to the caller's objects, so mutating a blueprint after
   installing it changes a running game. Copy on install (`studio/shelf.ts`, `studio/interpreter.ts`).
3. Replacing a shelf entry by id changes a running game's pause actions, because the shell
   resolves the active game's metadata from the shelf each time. A running game must keep the
   entry it started with (`room/room.ts` install, `room/shell.ts`).
4. Validation accepts ruling names the room reserves, such as `quit`, which sends everyone to
   the shelf instead of applying the ruling. Reject reserved names (`studio/blueprint.ts`).
5. Validation accepts non-finite numbers: a budget of `NaN` never runs out. Require finite
   integers for budgets, warnings and player bounds.
6. The rehearsal personas hardcode the give-up action id and ruling names, so a valid blueprint
   with a renamed give-up action is reported as never ending. Personas must read the decisions.
7. Blueprint remarks reach a verbatim remark log in the room, so a remark must never contain a
   fallback secret; and host text in a blueprint is prompt input, as the trust-boundary note says.
8. Style: a missing doc comment on the exported blueprint in `studio/games/twenty-doors.ts`,
   several untyped locals and callbacks in `studio/rehearse.ts` and the tests, and lines over
   the limit in `studio/interpreter.ts`, `studio/rehearse.ts`, `studio/rehearse.test.ts` and
   `studio/games/twenty-doors.ts`.

Already fixed here: the blueprint game now reports whose turn it is, matching the hand-written
Twenty Doors.

## Leading Questions: the shape to script

- 4 to 8 players, about 8 minutes a round.
- The host thinks of a word (a content request, with a fallback bank, as Twenty Doors does) and
  keeps it in host scope. Code deals one player the Plant: their phone shows the word on a
  secret card; everyone else sees a waiting card. The host does not know who the Plant is.
- Asking: anyone holds to talk and asks a yes/no question. The host rules from a closed list
  (yes, no, sort of, correct) and code spends the question budget and shows it on the TV. The
  Plant's job is to steer the room to the word without being obvious.
- If the word is found inside the budget, a vote: who was the Plant? Phones show a choice;
  the TV shows the tally. If the budget runs out, the round ends with the reveal and no vote.
- Scoring is yours to write; keep it so every round ends with something to laugh at, not a
  loser. Reveal the word and the Plant, then offer another round.
- Phases map to the manifest: `choosing` (muted), `asking` (hold to talk), `vote` (muted,
  phones), `end`. Rulings stay closed and named.

The experience script is a scene, not a feature list. For one full round, write what the host
says in its voice (plain, dry, warm, short, no jokes forced), what the TV shows, what each phone
shows, and what players say and do. Then the voice design: when people hold to talk, what the
host does when interrupted, misheard or lobbied, and what happens on silence (the host cannot
speak up unprompted today; say where it should). Then the awkward cases: three players, ten,
someone leaving mid-round, the Plant being too obvious, a leak, a question that isn't yes/no.
Then what the app would need that doesn't exist yet. Put the script at `studio/games/leading-questions.md`
beside the game.

## What can be run here and what needs the Mac

- Here: `python3 tools/verify.py`, `npx tsc --noEmit`, `npx eslint .`, `npm test`, and the
  structural rehearsal, which never calls a model. The room boots with `GAME_ROOM_TEXT_ONLY=1`,
  but anything that reaches a model or the voice needs keys and is not available here.
- On the Mac: the scenario proofs in `tools/scenarios/` against a text-only room, and a real
  table with phones and a TV. When something needs that, say exactly what to run and what a
  pass looks like, and leave it for the Mac.
- Independent code review runs on the Mac too, with local tools a cloud session cannot reach.
  Expect a review of each push, and answer its findings in the next commit or say why not.

## Rules

- Commits are by Ambrose Nilam, `15184721+AmbroseNilam@users.noreply.github.com`, with no
  attribution lines of any kind. Small commits whose messages say why and what was really
  verified. Never backdate.
- No employer references, no names of people who tested the game, no server or deployment
  details, anywhere.
- Stay on branch `studio`. No merges, no pull requests, no deployment, and never touch `master`.
  Changes to `room/` and `shared/` stay small and additive; say so in the commit message when
  one is unavoidable.
- Logs never contain what anyone said, what the host replied, or a player's name. Never read or
  print `.env`. Nothing that costs money runs without approval.
- `DESIGN.md` governs everything a player sees, including the host's words.
