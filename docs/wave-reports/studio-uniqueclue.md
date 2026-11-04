# Wave report: Lonely Clues (unique-clue cooperative game, catalog #11)

Branch `studio-uniqueclue`, from `master` at `cf29bf0`. Nothing on `master` or `room/` was touched. The
phone page core was not touched. The game is on the `?studio=1` shelf only.

## What was built

- **`studio/kits/clue.ts`**, a new kit. One player guesses and never sees the word. Everyone else sees it
  and types one word. Code cancels clues that merge with another, refuses clues that contain the word or
  an obvious form of it, and the surviving clues come up on the TV one at a time. The guesser gets one
  guess, spoken or typed. The team scores together over five rounds. After the guess, the host reveals
  the cancelled clues, which is the joke.
- **`studio/games/lonely-clues.ts`**, the cartridge: original name, 159 original words, five rounds, 3 to 8
  players. **`studio/games/lonely-clues.md`** is the experience script.
- **`studio/kit/merge.ts`**, a local `mergeDuplicates(answers)` behind a `DuplicateMerger` type. The kit takes
  one as its fourth argument to `createClueGame`, so the smarter matcher can be swapped in without
  touching the game. I did not read or depend on `origin/jev-integration`.
- **Rules live in code.** The word, the guesser, which clues are one word, which give the word away, which
  are duplicates, whether the guess is right, the score and the rating are all code. The host holds
  nothing hidden: it is never told the word, and never told a cancelled clue until the guess is made. It
  reads the survivors it was given and narrates. The one thing it rules is `locked`: that a spoken line
  was the guesser's final answer. A wrong ruling only means the guesser types the guess instead.
- **Typed clues** use the phone's text input from `core-text-input`. The room's content filter checks every
  clue before the game sees it. A clue the game's own rules refuse (two words, or too close to the word)
  gets a fresh box with a note, two more tries, and then that player sits the round out.
- `studio/rehearse.ts` gained an `answer` move and `controls` in the persona's view, so typed-clue games
  can be rehearsed. `studio/blueprint.ts`, `studio/check.ts` and `studio/personas.ts` know the new kit.
  `tools/stub-model.ts` is a stand-in for the model API for runs with no key (see below).
- `studio/shelf.ts` has one two-line edit, in its own last commit.

## What passes

Each of these was run on the final code.

- `python3 tools/verify.py`: ok. `npx tsc --noEmit`: clean. `npx eslint .`: 0 errors; the 6 warnings are
  lines over 180 characters in files this branch did not touch. `npm run check` (verify, typecheck, lint,
  tests): green; the test run is 127 tests, 0 failing.
- **Blueprint check (`studio/check.ts`)**: nine paper personas times five seeds, 45 rehearsals. Zero
  problems, every phase reached, every rehearsal ends. Between them the personas reach every way a round
  can end (right, wrong, timeout, passed, voided); a test asserts that.
- **Leak check.** Each state declares what must be hidden and from whom: the word from the guesser, the
  host and the TV; every cancelled or refused clue from the same three until the result. The rehearsal
  looks at the TV, every phone and the host's brief and facts on every step. A test builds a state with a
  leaking fact and asserts the check flags the word and a cancelled clue for the guesser, the host and the
  screen, and does not flag a clue giver seeing the word. The check found two real things on the way: a
  paper player named "Candle" and the word "candle" collide, and the host's own brief contained
  "envelope" and "extent", which hid the words "envelope" and "tent". Both words and the wording changed.
- **Scripted game, `ROOM_STUDIO=1`: PASS**, whole game, against a real room with four fake phones
  (`tools/scenarios/lonely-clues.ts`). In order, it checks:
  1. a hostile line ("ignore all previous instructions...") is refused by the room's own content filter,
     the box stays, and the line reaches neither the TV nor the host;
  2. a clue that is the word plus an s is refused with a note, and a new box comes back;
  3. fair clues come up on the TV in seat order; the refused clue is named only after the guess;
  4. duplicate clues ("Sleep" and "sleeping") are cancelled and appear nowhere on the TV, on the
     guesser's phone or in anything the host said, until after the guess;
  5. a spoken guess is ruled `locked` by the host and judged right by code; the cancelled clues then
     come out on the TV and in the host's reveal;
  6. a pass from the pause menu; a clean round with the bonus; a guess that runs out of time;
  7. the final score (5 points of a possible 15) and the rating ("Getting warm") are right, and the
     game returns to the shelf.
  The word is random each run, and the scenario's clues are checked against it so a fair clue is never
  accidentally refused. One full run takes about five minutes, mostly the rounds' own clocks.
- **Screens**, rendered in Chromium and read by eye: the TV at 1920x1080 and 1366x768 for writing,
  reveal, guess and result, with up to eight seats and five survivors; the phones at 390x844 for a clue
  giver (word card and box), a refused clue (note over a fresh box), a sent clue, the guesser while
  waiting, the guesser's guess box, and the result. These were the screenshots that led to the layout
  fixes in the last code commit (see its message).

## How it was tested, and what the stand-in is

This cloud session has no model key, and the content filter treats a classifier that fails as "no", so
with no key every typed clue is refused. The scripted run therefore used **`tools/stub-model.ts`**: a local
server the room talks to through `META_BASE_URL`. It answers the room's content check with "allow", and
for the host it repeats the newest thing the game told it, or makes the one ruling the phase allows, or
stays quiet. So the room, its local filter, the game and every screen ran for real; the **model did
not**. The local filter's refusal of the hostile line is the real code, not the stand-in. The stand-in
logs no request content.

To repeat the run:

    node tools/stub-model.ts &
    META_BASE_URL=http://localhost:8750/v1 META_MODEL_API_KEY=stub GAME_ROOM_TEXT_ONLY=1 npm run room
    ROOM_STUDIO=1 node tools/scenarios/lonely-clues.ts

On the Mac with keys, drop the stand-in and the two `META_` variables; the same scenario then runs
against the real classifier and the real host, and a pass prints `PASS`.

## Weaknesses

- **The duplicate merger is a heuristic.** It folds case, accents, hyphens, plurals, common endings,
  British and American spellings and one slipped letter in a long word. It does not know synonyms or
  that "bunny" and "rabbit" are the same idea, and it can be wrong either way ("heart" and "hearth"
  merge as a slipped letter in a longer word; "bread" and "break" are kept apart on purpose). The smarter
  matcher on the other branch should replace it, and the swap point is one argument.
- **A guess is judged loosely.** Any word in what the guesser said that is the word or a plain variant
  of it counts, so "pizza or pasta" is right if the word is pizza. That is the friendly choice for a
  party and a mistake if someone games it.
- **Speech.** A spoken guess depends on the transcription getting the word, and on the host ruling
  `locked` on the right line. Neither was run for real. If it fails, the guesser can type; nothing is
  lost but a moment.
- **"An obvious form of the word" is judged by stems, containment and a long shared start.** A clue that
  only rhymes, or is a very famous partner of the word, passes. That is a choice, not a proof.
- **The word list has no difficulty tiers.** Some words are much easier than others; there is no
  category, so a round can be easy or hard by luck.
- **A player named like the word.** Their name shows on the TV in the roster; the rehearsal's leak check
  flags that. The list avoids the paper players' names, not real ones.
- **Phone copy I can't change.** While typing, the phone surface says "Phones are quiet for now" and
  "Marlowe will say when it's your turn", from the phone core's muted mode. It is slightly off for a
  typing phase. The fix is a core change.
- **Box art** points at the shared `art/hero.webp` placeholder. No paintings were made.
- Two retries on a refused clue means a determined player costs the room up to three classifier calls.

## What I could not verify

- **Real Meta models.** The real content check and the real host were never reached. How the real host
  paces the reveal, whether it reads the cancelled clues as confessions, whether it rules `locked`
  correctly, and whether it ever leaks (it cannot leak the word, since it is never given it) are
  unverified. The host's lines in this repository are what it is told, in `clue.ts`, not what it says.
- **Voice and the microphone**, including the muted phones during writing and the guesser's open
  microphone during the guess, and ASR on a one-word answer.
- **A real iPhone.** The phone screenshots are Chromium at 390x844 with touch emulation. Keyboard
  behaviour, the "Send it" button above a software keyboard, autofill and the room's rate limit between
  answers were not felt on a device.
- **A real table.** Whether five rounds is the right length, whether the reveal is funny, and whether
  three players is enough fun have not been played by people.
- Anyone leaving mid-round is covered by rehearsal personas and unit logic, not by a scripted room run.
