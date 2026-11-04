# Wave report: Pantomime Panic (act-it-out charades, catalog #12)

Branch `studio-actout`, from master at `cf29bf0`. Not on any shelf except `?studio=1`.

## What it is

One player at a time gets a private prompt on their own phone (a movie-style title, an action or a
character), picks how hard it is, and acts it out in silence while a clock runs on the TV. Everyone
else holds their phone and shouts guesses. **Code hears every guess as text and rules it**; the host
never holds the answer and has no rulings at all. Guesser and performer score the same (level points,
plus a bonus if the clock is less than half gone); a turn nobody guesses gives the performer a point for
trying. The performer rotates in seat order, each player once. The pause menu's "We give up" ends the
game with the scores.

Mechanic differs from the other games: a physical performance judged by a text matcher in code, with a
rotating performer, rather than questions to the host (Twenty Doors, Leading Questions), a quiz, or hidden roles.

## What is in the branch

| Path | What |
| --- | --- |
| `studio/kit/matching.ts` | Guess matcher: ignores small words and word order, stems endings, forgives a one-letter mishearing in words of five letters or more, rules `match`, `close` or `miss`. |
| `studio/kits/charades.ts` | The kit: phases `pick`, `ready`, `acting`, `reveal`, `end`; decisions; manifest; briefs; rules. |
| `studio/games/pantomime-panic.ts`, `...-prompts.ts` | The blueprint and **135 original prompts** (15 per kind and level), each with listed synonyms. |
| `studio/blueprint.ts`, `check.ts`, `personas.ts` | Kit wired into the blueprint union and the default rehearsal; eight paper personas. |
| `tools/scenarios/pantomime-panic.ts` | Scripted game with four simulated phones. |
| `studio/shelf.ts` | One-line shelf registration, in its own last commit. |

## What passes

- `python3 tools/verify.py`, `npx tsc --noEmit`, `npx eslint .` (no new warnings), `npm test`: 162 pass, 0 fail. Run before each commit.
- `studio/check.ts` on the blueprint: 40 rehearsals (8 personas × 5 seeds) all end, every phase reached, **no problems**. Endings reached: guessed fast, guessed late, time up, performer left, too few left, give up, abandoned pick.
- **Leak check:** a test puts each of the 135 prompts in play and checks the answer and every synonym reaches only the performer's phone (not the TV, host brief, or any other phone). A planted fault (answer on the TV) is caught by the rehearsal.
- **`ROOM_STUDIO=1` scenario passed** against a `GAME_ROOM_TEXT_ONLY=1` room (last line `PASS`; room log shows `[studio] starting blueprint pantomimePanic on the charades kit`). It plays three turns: a wrong guess; a near miss that the TV marks "(close)"; the performer "saying" the answer (ignored, that phone is muted); the right guess scoring guesser and performer equally; performer rotation; a swapped prompt answered with a listed synonym; a third turn ended from the pause menu; and a 20 ms watcher that the current prompt never appears on another phone, the TV or in host lines.
- Screens reviewed in Chromium: TV at 1920x1080 and 1366x768, phone at 390x844 (2x), for pick, ready, acting, reveal and final scores, as performer and as guesser. Performer's phone shows the prompt as a plain paper card, 44px, with "Your turn" above and "Act it out. No words." below; it is readable at arm's length. Fixed from review: surface text on the performer's phone, and the turn bar touching the lantern at 1366x768. Screenshots were not committed.

## How it was tested

Structural rehearsal with no model (`studio/check.ts`); unit tests (`studio/kit/matching.test.ts`, `studio/kits/charades.test.ts`) over rules, privacy, scoring, timers (including stale ones), leavers; the scripted scenario against a real local room; Playwright screenshots against a real room with one real browser phone and three simulated ones.

To rerun: `GAME_ROOM_TEXT_ONLY=1 npm run room`, then in another terminal `ROOM_STUDIO=1 node tools/scenarios/pantomime-panic.ts`. A pass takes about a minute.

## Weaknesses

- **Matching is lenient by design.** Any guess containing every key word counts, so a shotgun of many words can hit. Short synonyms such as "Ghost" for "A scared ghost" accept the bare noun at easy level. A misheard answer that is more than one letter off, or a homophone, is a miss; the room sees only "(close)" at best.
- **Host throughput.** Every heard guess still wakes the host, which the brief tells to reply `(quiet)`. A noisy room could hit the 20 replies a minute limit, and a close-guess cheer could arrive late or be dropped. The room, not this game, owns that.
- **Guessers' phones say "Waiting for X"** above "Hold and shout your guess", because the turn is one player's. The phone core is not editable here. First-time players also see the core's generic "Press and hold to talk" hint until they have held once.
- Prompts are untested on people: some hard ones may be unactable, and the swap button is the only escape. Fixed lists repeat across games for the same group after about 135 turns.
- Art reuses `art/hero.webp`; no painting for this game.
- The name was checked only with a web search that found no game of that name (and moved away from "Say Nothing", close to the registered "Say Anything"). That is not legal clearance. The prompts are invented, but nobody checked every title against every film.
- Content filter: all prompts and synonyms pass the room's local filter (tested). The classifier stage was not run.

## What I could not verify

- **The host's voice and lines.** No model or voice key in this environment: every host reply failed, so none of the host's commentary (opening, "close" cheers, ten-second nudge, reveal and closing lines) was heard. The briefs carry example lines in the house voice, but whether Muse Spark follows them, stays quiet on guesses, and avoids guessing the prompt is unchecked. Run the scenario on the Mac with keys and read the host lines it prints.
- Real speech: transcribed guesses, push-to-talk timing, and whether the performer's muted mic holds on iPhone. The scenario uses text-only speech.
- Feel on a real iPhone and a real TV across a room, and the sound.
- Node: this machine has Node 22; the repo asks for 24. Everything ran with `--experimental-strip-types`.
