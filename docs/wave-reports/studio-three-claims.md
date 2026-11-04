# Studio: Three Claims (Two Truths and a Lie, with a host that interviews)

Branch `studio-three-claims`, from `origin/master` at fc11cdf. One new kit (`claims`) and one new game on it
(`threeClaims`, folder `studio/games/three-claims/`), level **held**, so it appears only on the testing shelf.
The id `three-claims` is a working name, as briefed; the box id has to be letters only, so it is `threeClaims`.
Nothing in `room/`, `phone/` or `shared/` was edited. Commits are by the same author as master's latest commit,
with no attribution lines.

**The one thing to know first:** there is no model key here. Every run below is the real room, real fake phones
and the real rules against a stand-in model (`tools/stub-claims-model.ts`). The stand-in host follows the game's
latest note with one short question or a tally. What is proven is the rules, the views, the leak checks and what
the room sends a host. What is not proven is anything the real host says or does.

## What it is

Three to eight players. Everyone types three claims about themselves (60 characters at most, one box at a time)
and taps the one that is false. Code keeps the mark. Then one claimant at a time, in a dealt order:

1. The TV shows the three claims, lettered A, B, C in a shuffled order, with the claimant's place card lit.
2. The host asks two questions by voice, one about each of two claims, each asking for a detail, a date, a place or a
   name. After each question only the claimant's phone is heard.
3. The host names a player (the one who has asked least), who asks one question of their own. Only that phone is
   heard, then only the claimant's again.
4. Everyone else taps the claim they think is the lie.
5. Reveal: three points to the claimant for each person fooled, two to each catcher. At three players the claimant faces
   two, and a sweep by either side doubles (both fooled: twelve; both catch it: four each). The host reads the tally and
   teases the result, never the person.

Clocks: writing 150 s (ends the moment everyone is ready); then 18 + 18 + 14 + 18 + 16 + 8 s at the most per claimant
(92 s), and each step moves on the moment the right person has spoken or voted. About 8.5 to 11.5 minutes at six.

**Rules, scoring and the secret are all code.** The mark lives in state and is never read by anything that builds a
view, a host fact or a brief. The host is told which claim was the lie in one fact, at the reveal. It makes no
rulings at all, so the one-ruling-per-reply cap cannot be broken.

## What passes

- `npm run check`: verify.py ok, `tsc --noEmit` clean, eslint 0 errors (the 42 warnings are line lengths; none are
  in these files), `npm test` 621 pass, 22 of them new in `studio/kits/claims/claims.test.ts`. Node 22.23 here, not 24.
- **Default rehearsal** (`studio/check.ts`): 12 paper-player ways of playing across 5 seeds, 60 rehearsals, all end,
  every phase reached, no problems: the full table, a table that sees through every lie, a table fooled every time,
  a split table, a silent table, a claimant who never speaks, a table where one player never finishes, claims the
  game turns down, the claimant walking out, the named player walking out, a voter walking out, and a table that
  shrinks to two.
- **Lie mark never reaches anyone before the reveal.** Three layers:
  1. The rehearsal hides each unrevealed claimant's claims and mark (the mark's claim text counts only beside the word
     "lie") from the TV, every phone but the owner's, and the host's brief and facts, on every step.
  2. A unit test plays the same game three times with a different claim marked each time and requires every
     viewer's whole view, the TV, the host's brief and facts, and every phone including the claimant's, to be
     **identical, step by step, until the reveal**, and different at the reveal. This also proves the order of the
     claims, who the host asks about and who is named to ask do not depend on the mark.
  3. The scenario (below) reads everything the TV, every phone and the host's captions showed, and every request the
     room made to the stand-in model.
  I also **broke the game on purpose** (the TV marked "(the lie)" on the lie during the vote). The rehearsal, the
  mark-blind test, the brief test and the scenario each failed. The file was restored before committing.
- **The host's brief and facts.** Tests assert: the brief says "ask for a detail, a date, a place or a name", "Never ask
  for a reason", "Never touch health, sex, money, family or work" and "One question per reply"; every instruction to
  ask carries exactly one "Ask for", only the four allowed things, "One question only, never a reason", no "why", no
  question mark; the two questions in a turn ask for different things; the named-player step says "Do not ask a
  question yourself"; no phase gives the host a ruling.
- **Host cap.** The game wakes the host at most 6 times per claimant (open, second question, name the asker, hand back,
  vote open, result), 92 s at the slowest, so at most about 4 a minute; even at four seconds a step it is 15 a
  minute. A test asserts both. In the scenario the room's actual requests to the model were checked: never more than
  20 in any minute (17 in a whole four-player game, counting the replies to speech that the stand-in answers with
  "(quiet)").
- **One speaker at a time.** The phases give hold-to-talk to the claimant in the interview and answer, to the named
  player in the challenge, and nobody in the vote and reveal; the room drops everyone else's audio. Tested in the
  rules, and in the scenario a bystander speaking during the interview, and the claimant talking over the named
  player's question, never reached the host (checked in the stand-in's request log). A cough, "hm", is not an answer.
- **Claims are filtered before anything sees them.** The room's content filter runs first (it is the room's, not
  mine). In the scenario, the first claim box was given: a bracketed instruction to the host, an email address, a
  phone number ("call me on 555 867 5309") and a line the stand-in classifier refuses. Each was turned down, the box
  stayed on the same claim, and none reached the TV, another phone or the host. Then the game's own turn-down: "My
  dad got me a job at his office" (family and work), which the room lets through and the game refuses with a note.
  The game also refuses claims with brackets, repeats and empty text, and cuts a long one to 60 characters.
- **Claims stay on their owner's phone until their turn.** The scenario checks, at the start of every turn, that no
  claim of anyone still to come had been seen by the TV, the host or another phone.
- **Scenario** `tools/scenarios/three-claims.ts` (run instructions in its header), four players and, with
  `CLAIMS_PLAYERS=3`, three: PASS each, and again after the last code change. It checks the points against
  its own copy of the scoring (turns with everyone fooled, one catch, everyone catching, a split; at three players the
  sweeps), that the reveal marks exactly the right claim, and that the final table is the sum. The room log shows
  `[studio] starting blueprint threeClaims on the claims kit` and contains no claims, names or spoken words.
- **Screens.** A real phone page at 390x844 (2x) and the TV page at 1920x1080 and 1366x768, in headless Chromium,
  against that room: gathering, the claim box and the lie tap, on the stand, waiting, the named player's turn, the
  vote, voted, the vote on the TV, the reveal, and final scores. Everything was readable; the fixes are in the last
  commit: the notices repeated the "Your turn" badge, and the vote's progress bar pushed the countdown label under
  the lantern at 1366x768. The screenshots are not committed.

## Weaknesses

- **Seat colour on the claims.** The brief asked for the claims "with the claimant's seat colour". The scene
  vocabulary has no colour on a block, so the colour shows only on the claimant's place card, which the turn lights
  (and on their phone background). Doing it properly needs a core change (see below), which I did not make.
- **The topic filter is a blunt word list.** Claims with "dad", "work", "money", "doctor" and the like are refused,
  which will annoy someone with a good claim about a grandfather. It also misses plenty ("I had an operation").
  It is a second layer under the host's brief, and it cannot see what is *said*: a claimant can talk about anything,
  and the host hears it.
- **The real host may not obey.** Code can say "Ask for a place, one question only". It cannot stop a model from
  asking two things, asking why, or commenting on health when the claimant brings it up. Nothing here tested that.
- **A spoken answer is any two or more words.** "I don't know" counts, and so does silence plus noise the transcriber
  hears as two words. A confession aloud shows on the TV caption and reaches the host.
- **Clocks start when a phase opens, not when the host stops talking.** A host line takes several seconds to speak, so
  a claimant may have 10 to 12 of the 18 seconds. The clocks may need to go up, which lengthens a turn. Not measured.
- **The host is woken on every utterance of the person who may speak**, so a claimant who holds and releases
  repeatedly can use the room's 20-replies-a-minute limit up. The room then skips replies, and the game still moves.
- **One slow writer holds the table** for up to 150 s. Three round trips per player, one box at a time, is slow on a
  phone; a three-field form would be faster and needs a new control. The 150 s is also partly the rehearsal's
  virtual clock (every action costs six seconds, so five paper players need 120).
- **Eight players is about twelve minutes** of interviews. Fine for a long night, long for a demo.
- **The art is the shared placeholder** (`art/hero.webp`); no painting for this game was made here.
- **A player who leaves and rejoins** was not tried; a player who leaves is out for the rest of the game.

## What I could not verify

- **Anything with the real host (Muse Spark).** Whether it asks one question, asks for the right thing, never asks why,
  avoids the five subjects, stays quiet when told, names the right player, reads a tally without teasing a person, and
  stays inside 12 seconds a reply. The stand-in has none of its judgement. Run
  `ROOM_STUDIO=1 node tools/scenarios/three-claims.ts` on a machine with `GAME_ROOM_TEXT_ONLY=1 STUDIO_SHOW_HELD=1
  npm run room` and a key; the scenario's request checks apply to the real host's prompts too, but its question
  and tally lines are the stand-in's, so listen to a real table.
- **Real microphones**, hold to talk on the muted and live phones in turn, the transcript of a real spoken answer, and
  whether the 18-second clocks feel right with the voice's real latency. The scenario uses the room's text-only
  `say`, which respects the same listening modes.
- **A real iPhone**: typing three claims, the keyboard covering the lie choice, the feel of the vote.
- **The real classifier** on claims (the stand-in refuses only a marker, and the room's local filter did the rest),
  and the real voice's reading of a claim in curly quotes.
- **A real table**: whether three claims plus two host questions is enough to make a lie hard to spot, whether the
  scoring is fair (three per fooled claimant against two per catch), and whether the three-player doubling is needed.

## Core changes that would help (not made)

- `shared/scene.ts` and `screen/`: an optional seat on a block (for example `accent: playerId`) so a title or text can
  take a seat's colour. This is what the brief's "claimant's seat colour" needs.
- `room/`: a multi-field text control, so three claims are typed and sent together, cutting the three round trips.

## How to run it

```bash
node tools/stub-claims-model.ts
```

```bash
META_BASE_URL=http://localhost:8741/v1 META_MODEL_API_KEY=x GAME_ROOM_TEXT_ONLY=1 STUDIO_SHOW_HELD=1 npm run room
```

```bash
ROOM_STUDIO=1 node tools/scenarios/three-claims.ts
```

A pass ends with `PASS`. Add `CLAIMS_PLAYERS=3` for the three-player game. The held game shows on the shelf only in a
room opened with `?studio=1` and a server started with `STUDIO_SHOW_HELD=1`.

## Files

- `studio/kits/claims/`: the kit (`claims.ts`), its paper players (`personas.ts`), tests, `index.ts`, `kit.meta.json`.
- `studio/games/three-claims/`: `blueprint.ts`, `game.meta.json` (level `held`), `script.md` (the experience script).
- `tools/scenarios/three-claims.ts`, `tools/stub-claims-model.ts`.
