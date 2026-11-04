# Studio wave report: Blank Verdict (hand kit, catalog #20)

Branch `studio-hand`, based on cf29bf0 (see "Base" below). Author is the same as the latest commit on
`origin/master`, with no attribution lines.

## What was built

- `studio/kits/hand.ts`: a new kit for hand-and-judge card games, 3 to 8 players. Phases: `tone`,
  `playing`, `judging`, `reveal`, `end`. Code owns the deck, deals, judge rotation, clocks and scores.
  The host makes no rulings at all; it only narrates facts.
- `studio/games/blank-verdict.ts` and `blank-verdict-cards.ts`: the game. Original name "Blank Verdict".
  165 answer cards (106 family, 59 party) and 44 prompts (30 family, 14 party), all written for this game.
- Registered in `studio/blueprint.ts`, `studio/check.ts` and `studio/personas.ts` (eight paper personas).
- `tools/scenarios/blank-verdict.ts`: a scripted whole game with four fake phones.
- `studio/shelf.ts`: the one-line shelf edit, in its own last commit. No change to `room/`, `shared/`,
  the phone page or the screen.

## How a round plays

1. The first player to join chooses family or party on their phone (20 s, then family). Family rooms deal
   only family cards; party rooms use all cards. The room has no lobby tone setting for blueprints yet,
   so the choice is a game phase rather than a variant.
2. Each round the next seat judges. Everyone else holds six cards on their phone and plays one (50 s).
3. Plays are shuffled, so position says nothing about the player. The TV and the judge's phone list them
   by number. The judge's buttons stay disabled while the host reads (4 s plus 4 s per play).
4. The judge picks in secret. The TV says "The verdict is in." for 3 s, then shows the winning sentence,
   the winner and the points. The point is added only at that moment, so the host's score line cannot
   give the winner away during the beat. (A unit test found this bug before the first commit.)
5. Tables below five go round the judges twice, so three plays 6 rounds, four plays 8, five to eight play
   one each. Ties are reported as ties. Nobody is eliminated.

Clocks and exits: nobody plays, the round is void and the next judge is up; one play wins by walkover;
the judge's clock runs out, the code draws a play; the judge leaves, the round is void and cards go back
to hands; the chooser leaves, the next seat chooses; fewer than three left ends the game with the scores.

## What passes

- `npm run check` (verify, tsc, eslint, 143 tests): green. ESLint reports only warnings that were
  already on the base; none from these files.
- `studio/check.ts` default rehearsal (8 personas x 5 seeds = 40 rehearsals): all 40 end, every phase is
  reached, zero problems from the per-viewer hidden-value check.
- `ROOM_STUDIO=1 node tools/scenarios/blank-verdict.ts` against `GAME_ROOM_TEXT_ONLY=1 npm run room`:
  PASS, three times (the first two before small copy changes; the last on the final kit code). The room
  log shows `[studio] starting blueprint blankVerdict on the hand kit`.

## How it was tested

- 34 unit tests in `studio/kits/hand.test.ts`: card counts, language filter on every card and on all
  7,260 filled sentences (`localCategory`), no card inside another, deal sizes and uniqueness, the tone
  filter over 20 seeds, determinism from a seed, copy-on-create, tone choice rights, per-phone hand
  privacy, the gated pick, the secret beat, scoring, shuffle fairness (first seat's play leads about
  1 time in 4 of 4), same screen/host/judge views whatever the submission order, full games at 3, 4, 5
  and 8 players with the deck never running dry, clocks, leavers and ties.
- Leak check, with negative controls: the rehearsal hides every dealt card from everyone but its owner
  and every author's name beside their card until the reveal. Two tests break the kit on purpose (every
  hand shown on every phone; author names on the TV) and require the check to catch each.
- The scenario checks from outside the room: only the first player is offered the tone; after every
  single play no unplayed card appears on another phone or the TV; the judge cannot press while the host
  reads; the TV's sentence, winner and tally match the judge's pick; every player judges twice at four;
  the final board matches the wins counted by the script; a host line containing a card still in a hand
  fails the run.
- Screens: a real Chromium phone (390x844, 2x) and TV (1920x1080) played a three-player game against the
  local room. Captured and read: tone, hand of six, played, waiting, judge reading, judge choosing,
  beat, reveal, end. Six cards fit without scrolling. TV text is large and on the room's paper style.

## Weaknesses

- No model keys here, so the host never spoke in any run. Its lines (`hostBrief`, the facts, the beat
  and the reveal) are written and reviewed but unheard. The brief tells it to read plays as short
  numbered sentences; if the 12 s reply limit cuts a seven-play reading short, split the `plays` fact.
- The shell's copy under the controls reads "Phones are quiet for now. Marlowe will say when it's your
  turn" while the phone has a hand to play. That is core page text I was told not to touch. The judge's
  pill also says "Your turn" while the buttons are still disabled for the reading.
- The art is the existing `art/hero.webp`; no Muse Image painting was made for this game.
- Tone is chosen in-game by the first joiner, not in a lobby; the room's `GameSession.start` only uses
  default variants. Moving it to the lobby would be a small `room/` change.
- Cards are grammatical only loosely by design (noun phrases into a gap); a few combinations will read
  oddly. The party set is petty, rude and awkward, not hateful, but taste is a human call.
- A whole four-player game takes about five minutes on real clocks, so the scenario is slow.
- The rehearsal skips the pairing check for a player whose name appears in a card on the table (the
  paper player "Spoon" and any spoon card), since the check cannot tell them apart.

## Could not verify

- Real iPhone feel: tap targets, scrolling with long cards on a small phone, the screen staying on.
- The host's voice, comic timing, and whether it stays inside the content rules in party tone.
- Behaviour of the room's own content filter on the host's output beyond `localCategory`; the model
  classifier step needs keys.
- Real transcription and microphones: all phases here are muted, so nothing in this game depends on them.
- Eight real phones at once; the scenario and tests used up to eight simulated players.

## Base

`origin/master` does not contain cf29bf0 (the Studio work lives on the session branch), so this branch
starts at cf29bf0 itself, as the task allowed ("at or after"). Nothing was pushed to or changed on `master`.
