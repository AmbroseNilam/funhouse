# Wave report: Cold Read (host-guess kit)

Branch `studio-hostguess`, from `origin/studio-wave1`. Catalog #18: reverse twenty questions, where the
players hold the secret and the host is the contestant. Original name: Cold Read, id `coldRead`.
Registered on the `?studio=1` shelf only, in the last commit.

## What was built

- `studio/kits/host-guess.ts`: the kit. Rules, host brief, TV and phone screens, blueprint checks.
- `studio/games/cold-read.ts` and `cold-read.md`: the blueprint (six categories, 15 questions, 3
  guesses, 2 to 8 players) and the game's notes.
- `studio/personas.ts`, `studio/check.ts`, `studio/blueprint.ts`: six paper-player styles for the
  default check, and the kit's place in the blueprint union.
- `studio/rehearse.ts`: one small addition, a `rule` move, so a persona can play a host that moves
  first (the ask or guess text sits inside the ruling). Nothing existing changed.
- `tools/scenarios/cold-read.ts` and `tools/stub-host-model.ts`: the scripted round and the stand-in
  model. `room/`, `shared/` and the phone page core are untouched.
- `studio/shelf.ts`: the only edit there is the registration, in its own last commit.

## The game

The table votes on a category on their phones (ties broken by the random source), then agrees on one
thing in it and taps ready. The thing is never typed or spoken to the game, so it cannot leak. The host
asks by writing `[[ask: question]]` and guesses with `[[guess: thing]]`, then says the same words
aloud. Each phone shows the question with Yes, No and Sometimes. Most taps wins, a tie is Sometimes,
nobody answering is recorded as no answer. Code owns:

- the question budget (15) and the guess allowance (3); a wrong guess before the last costs a question;
- which guess is final: the last allowed, or the first after the questions are gone;
- the board (every question and answer, with the split), shown to the host on every turn so it never
  has to remember;
- turning back a repeat question, a second question while one is open, a question after the budget, a
  guess it already got wrong, and unusable text, each with a note to the host;
- every clock, and a nudge clock that prods a silent host three times and then calls the round off;
- people leaving at any step (their taps go, the phase settles if everyone left has acted).

The final guess goes up with "hold your phone and say what it was, then tap whether the host was right".
Earlier guesses are judged with Yes, that's it or No, not it. The host reacts with flair at the end,
a small bow if right, gracious and openly impressed if wrong, and asks about another round.

The "model is smart" part is the host's brief: cut what is left in half each time, use the whole board,
never repeat or double up, treat Sometimes as a fuzzy question to sharpen, keep a shortlist, guess when
fairly sure. Whether Muse Spark does that is not tested here.

## What passes

Run on Node 22.23 (the repository wants 24; see below), after `npm ci`:

- `python3 tools/verify.py`: ok.
- `npx tsc --noEmit`: clean.
- `npx eslint .`: no warnings in the new files (the warnings left are in files this branch does not
  touch).
- `npm test`: 101 pass, 0 fail, including 28 new kit tests.
- `npm run check` runs those four in order; each was run on the tree before the last commit but the
  shelf one, and again with the shelf edit in place.
- The default check (`checkBlueprint`) at 2, 4 and 5 players: 30 rehearsals each, all 30 end, every
  phase reached, no problems. Outcomes: guessed after 3, guessed after 4, stumped after 15, and the
  host never made its final guess.
- `ROOM_STUDIO=1 node tools/scenarios/cold-read.ts`, against a real text-only room with four fake
  phones and the stand-in model, both plans, last run on the final code before the report:
  - win: category vote, ready, three Yes answers, the host guesses a lighthouse after the third, the
    table taps Yes, that's it; end screen "Marlowe got it", PASS.
  - lose (`SCENARIO=lose`, stand-in `STUB_PLAN=lose`): all 15 questions asked and counted, the final
    guess is made at 15 of 15, the table says what it was and taps the host was wrong; end screen
    "Marlowe is stumped", PASS.
  - the room log shows `starting blueprint coldRead on the hostGuess kit`.
- Screens: a real Chromium TV at 1920x1080 and 1366x768 and a phone page at 390x844 (device scale 2)
  were driven through category, secret, a question, thinking, a guess and the end, and looked at.
  Fixed what that showed (see the second commit). The phone shows one paper card of buttons on every
  step; the TV shows one question at a time.

## How it was tested

Unit tests drive the cartridge directly (votes and ties, every clock, stale clocks, majority and tie
rules, the budget and warnings, duplicate and over-budget turn-backs, mid-guess and final-guess
paths, a silent host, leavers at each step, two players, decisions that cannot run, copying the
blueprint). The rehearsal plays six styles: a quick win, a table that stumps the host, a table that
never taps, a host that never acts, a player who leaves with a question open, and a careless host
that repeats and over-asks. The scenario runs the real room, shelf, host loop, rulings parser and
screens, with the stand-in model replying where Spark would.

## Weaknesses

- The stand-in host is a small fixed tree. A pass proves the plumbing and the rules, not that the
  real host asks sharp questions, reads the board well, or writes the ruling in the right form.
- The mid-game wrong-guess path, the nudge and a rejected question are covered by unit tests and the
  rehearsal, not by the room scenario, because the stand-in never does them.
- Nothing wakes a host that stays silent except the game's own nudge clock (25 s, three times). The
  room does not use `silenceSeconds`. A host that fails to start a turn costs the table up to 75 s.
- Each question needs one model reply and one text-to-speech line before the table can answer
  comfortably. Reply limit is 12 s and 20 a minute per room, so the budget fits, but real latency
  per question decides how the round feels. The answer clock is 25 s from the ruling, not from the
  end of the host's speech.
- A tie on a guess counts as wrong; a tie on a question is Sometimes. Both are choices, not tested
  with people.
- The host must put the whole question inside the ruling. A question containing a closing square
  bracket would be cut; the kit strips brackets from what it shows, but cannot repair a cut one.
- With two players a split is common, and Sometimes then carries little. The box allows two.
- The final guess is judged by tap after the table says the thing aloud. A table that lies, or
  disagrees about "close enough", is not something code can see.
- The category vote tally truncates a long name at 1366x768; the six names fit at both sizes.
- The box art is the hero painting, as Who Fits uses.

## What could not be verified

- Muse Spark's behaviour: question quality, whether it writes `[[ask: ...]]` first and speaks the
  same question, whether it replies (quiet) while a question is open, and its flair. No model key
  here, so nothing ran against the real host.
- Voice: the text-only room has no speech, so hold-to-talk at the final guess, mishearing, and the
  host's speaking time against the answer clock were not tried.
- A real iPhone. The phone page was a desktop Chromium emulating 390x844; touch feel, the mic
  prompt and the pad were not felt.
- Node 24. This machine has Node 22.23.4 and runs TypeScript directly with it; the repository pins 24.
- The ElevenLabs and OpenAI voices, and the tunnel latency.
- Any table of real people, including whether fifteen questions is the right count, how long a round
  takes, and whether the game is fun.
