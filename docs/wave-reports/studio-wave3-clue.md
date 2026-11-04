# Studio wave 3: three word and bluffing games

Branch `studio-wave3-clue`, from `origin/master` at 2de0d6f. Three complete games, each a new kit with
a blueprint, tests, a scripted game and an experience script. All three are on the `?studio=1` shelf
only. Nothing here was run against Muse Spark, a real voice, a real phone or a real TV: this environment
has no model key and no hardware. Read "What I could not verify" before trusting any of it.

| Game | Kit | Players | Mechanic no other Studio game has |
| --- | --- | --- | --- |
| Tin Can Telephone | `clueboard` | 3 to 10 | Two teams race over one shared board; two givers hold an asymmetric hidden key; clues are checked by code before the host rules; the host can voice a side's giver |
| Wrong Room | `stranger` | 4 to 8 | A hidden role who is the absence of knowledge; an enforced order of play (pick, ask, answer) with a live mic only for whoever is up; a last guess judged by the host |
| Stray Word | `oddword` | 4 to 10 | The whole table says one word at a time in an enforced order under a one-word rule the code checks; Leading Questions turned inside out (everyone but one holds the word) |

## Commits

Per game: the kit, blueprint, tests and experience script; then the scripted game; then, last and alone,
the shelf registration. A small fix after the scripted game for Stray Word sits before its registration.

- Tin Can Telephone: `bd20fc5`, `f898bac`, `2add185`
- Wrong Room: `7169691`, `0ddcdd1`, `38a85e6`
- Stray Word: `a8c3602`, `2a91cba`, two small fixes found in screenshots (`dc45509`, `2180093`), then `2372ab4`

Author on every commit is Ambrose Nilam, the author of the latest commit on `origin/master`. No
attribution lines anywhere. `master` was not touched.

## What passes, and how it was tested

For each game: the kit's unit tests (31, 23 and 22 tests), the default blueprint check
(`studio/check.ts`, which rehearses every paper persona on five seeds, with the model failing and
succeeding, and checks every viewer's whole view for hidden values, spaced or reversed), a role or key
blindness check, a scripted game in the real room, and screenshots. `npm run check` passes on the final commit (194 tests, no lint errors; the 21 lint warnings are line lengths).

- **Rehearsal:** Tin Can Telephone 60 games (13 personas, also with three at the table), Wrong Room 65,
  Stray Word 55 (each also with the fewest players). Every game ends, every phase is reached, no
  problems. Personas cover every ending: team cleared its words, trapdoor, turn limit, forfeit, caught
  and missed, caught and named it, split vote, wrong accusation, early reveal, silent host, silent table,
  leavers.
- **Leak checks.** Hidden values per game: the key's owner for each unturned word (givers only); the
  place and who the Stranger is (insiders and the host get the place, nobody gets the Stranger); the
  word and who the Stray is. Rehearsal checks the TV, every phone and the host's brief on every step.
  Role blindness deals the Stranger and the Stray to every seat and compares what the TV, the host and
  every other phone see, step by step; for Tin Can Telephone a unit test shows two different keys look
  the same to the TV, the host and the guessers until a card is turned. The scenarios check the real
  room: the Stranger's phone never shows the place, the Stray's never the word, a guesser's never the
  key, the TV's scene shows no owner before a card is turned, and the host's spoken lines never contain
  the secret before the end.
- **Scripted games (`tools/scenarios/`)**, all with `ROOM_STUDIO=1`, all printing PASS:
  `tin-can-telephone.ts` (five players, and `SCENARIO_PLAYERS=3` where the host gives a side's clues),
  `wrong-room.ts` and `stray-word.ts` (each also with `SCENARIO_GUESS=right`; Stray Word was run four
  times in a row with a different Stray each time). Each scenario's header says how to run it.
- **Screenshots** at 1920x1080 and 1366x768 for the TV and 390x844 for phones, taken with Playwright
  against the real room, were reviewed for each game. Four things they caught were fixed: the board
  overlapping the lantern, the key peek card being used for guessers, a run-on list of words, and a
  number word being dropped from a one-word game.

**Every scripted run used a stub model, not Muse Spark.** `tools/stub-host.ts` and `tools/stub-model.ts`
are a rule-based stand-in served over the Chat Completions interface (`META_BASE_URL`). It writes the
board, the place, the word, a clue for a voiced giver, and the host's rulings; its lines are canned. It
proves the room, the rules and the screens work end to end. It says nothing about the host's wit,
fairness or rulings.

## Game by game

### Tin Can Telephone
Passes: everything above. A board of 25 plain words (the host writes it; the game falls back to 64 of its
own), nine, eight, seven and one dealt from a seed. Clues are spoken or typed in one box ("harbour 2");
the code refuses a board word, a part of one, a shared start, and a number out of range, and the host
rules the rest fair or foul; no ruling in eight seconds counts as fair; two fouls pass the turn.
Guessers tap words; the code counts guesses, ends turns and decides the win. Three players: the lone
side's giver is the host, whose clue comes from a content request that holds that side's key and is
checked by the same code, asked again once, and passed if it fails twice.
Known weaknesses: guessers see a scrolling list of buttons, not the grid; the first tap from any
guesser wins, there is no undo; the host's fair/foul is the only check for spelling or rhyming clues;
a voiced clue the model gets wrong twice costs that team its turn; a clue word `to`, `too`, `for` or
`won` is read as a number.

### Wrong Room
Passes: everything above. Place and eight roles from the host (fallback: 10 places of its own); roles
dealt by seat, independently of the Stranger, so no other phone can tell who it is. Strict order: the
asker picks (never self, never the one who just asked them), asks, the target answers, and becomes the
asker; only whoever is up has a live mic. Each step has a 30 s clock, a stalled step moves on quietly.
Call the vote with a majority of the table, or at 12 questions or 7 minutes; the Stranger can announce
they know the place. A tie or wrong accusation lets the Stranger win; a caught Stranger gets one guess,
ruled by the host if spoken and checked by code if typed.
Known weaknesses: the TV chip "Picks who to ask:" duplicates the title; typed questions and answers
appear on the TV by design but spoken ones show only in the room's caption; the host never speaks up
on a stalled step; typed guesses are matched loosely (a word inside the place counts).

### Stray Word
Passes: everything above. Category and word from the host (fallback: 24 entries of its own); everyone
sees the category, everyone but the Stray sees the word. Two rounds in an enforced order, one word per
turn; code strips filler, refuses several words, repeats, and the secret from anyone who knows it (a
note on the speaker's own phone only); the Stray's word is never refused for being the secret, since
they don't know it. Vote, then a caught Stray gets one guess.
Known weaknesses: the room's live captions show what was said aloud, so a secret blurted into the room
is on the TV as caption text, and nothing in a game can prevent that (the game still refuses to count it
as their word); the Stray's category hint makes the guess easier than a bare "no word"; ten players
means the last speaker waits through nine words.

## Host lines

Each kit owns every line the host is told (no creator text reaches the brief), written to be said short
and dry; the room's persona does the voicing. The experience scripts in `studio/games/*/*.md` list what
the host says per moment. Examples the briefs steer toward: "Harbour, two." "Bystander. That's your
turn." "Time to vote. Who is the stranger?" "It's a thing in a kitchen, and Spoon goes first." Quiet
moments (each question, answer and word) are quiet facts that never wake the host, to stay under the
room's 20 replies a minute. None of this has been heard from the real host.

## Changes I made outside Studio, for review

I did not edit `room/` or the phone page. I did make two small additive changes elsewhere:

1. `shared/scene.ts` gains a `board` scene block (columns and cells with an owner, a turned flag and a
   label), drawn by `screen/src/App.tsx` and `screen/src/styles.css`. Without it the TV has no way to
   show a shared grid. It sits at 1150 wide, with its clock to its right, so nothing touches the lantern
   at 1366x768.
2. `studio/rehearse.ts` gains `contentFor` so a rehearsal can answer two kinds of content request, and
   `studio/shelf.ts` stops assuming every non-plant kit has a give-up button. `studio/kit/words.ts`
   imports `localCategory` from `room/content-filter.ts` (read only) so a word the model writes passes
   the room's local filter.

## Core changes I would want (not made)

- A grid control for phones: Tin Can Telephone's guessers get a list of buttons, and the giver's key is
  four lines on a peek card. A board of tappable cards, with the key painted on it for givers, is the
  real design.
- A way for a game to ask for a spoken line or a nudge when a step stalls (Wrong Room, Stray Word): the
  host cannot speak unprompted today, so the TV moves on without a word.
- Content requests carry no id; kits track what they are waiting for and drop a stale reply. An id on
  `contentReady` would make a game that asks twice safer.
- Captions: the room prints what was said aloud, including a blurted secret. A per-phase "no captions"
  switch for hidden-word games would help.
- Variants: Tin Can Telephone's "Host gives the second team's clues" is declared as a variant; I did not
  check whether the lobby shows it.

## What I could not verify

- Anything with Muse Spark: whether it rules clues fair or foul sensibly, rules a guess right or wrong
  against a place or word it knows, writes a good board, place or word, and gives a legal, clever clue
  when voicing a side. The hosts' lines are untested.
- A real voice: whether push-to-talk and Muse Voice Transcribe turn "ocean, three" into one word and a
  number, or "kettle" into "kettles", and how often a typed fallback is needed.
- A real phone and TV: how the peek card, the 26-button guess list and the textboxes feel on an iPhone,
  and whether the board reads from across a room. Only 1920x1080, 1366x768 and 390x844 browser
  screenshots exist.
- That a muted phone's speech never reaches a game: the games ignore anyone who is not up, which is what
  the scenarios check, but the room's own muting was not exercised.
- Fun: nobody played these. Whether twelve questions, two rounds, a nine-word board or 90-second clue
  clocks are the right length is a guess.
