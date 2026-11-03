# Funhouse Studio: the design

_The creator's journey from "I have an idea" to "my friends are playing it", as scenes. Written
2026-11-03 against the code as it is on `master` at `f0d1c1f`. Decisions are stated with reasons and
traced to `principles.md` by number. Every part is mapped onto the contract in `shared/cartridge.ts`
and the room that runs it; where the contract must grow, the section "What the contract must grow"
says exactly what and why; where a programmer is needed, it says so. `DESIGN.md` is binding; the
last section lists where the evidence disagrees with it._

## Words used here

- **Structure.** One of five things a party game is made of: a secret, a judge, a vote, a clock, a
  reveal; plus roles and teams, which give the first four someone to belong to. Each structure is a
  small amount of TypeScript that exists once and is configured by decisions.
- **Decision.** A finite choice with a value: a number, an on-off, one of a few named options, or a
  short list of words. "Doors: 20." "Ties: nobody is out." Decisions are the only thing a creator
  edits.
- **Card.** A decision as it appears on the TV: a piece of paper with the decision's name, its value
  and one line of consequence.
- **Blueprint.** The complete set of structures and decisions for one game, plus its name, its box
  art and the host's manner. It is data, never code. One blueprint becomes one `CartridgeManifest`
  and one configured `Cartridge<State>`.
- **Rehearsal.** The game run on the TV with paper players, at speed, pausable, from a fixed seed.
- **Trace.** What a rehearsal recorded: every event in, every step out, and for each fact the
  decision that produced it.
- **Version.** A committed blueprint, named by the decision that changed.

The paper players are called Teacup, Spoon, Candle, Saucer and Matchbox. They are drawn as paper
cutouts standing at the table, in seat colours, with no faces.

## Where intent is captured, and why

Four doors into Studio, in the order creators will use them, with reasons.

1. **Remix a game on the shelf.** Every box on the shelf has a "Make it yours" row on its page. This
   is the main door. Evidence: people start by changing something that works, not from a blank
   canvas; endowed progress raises completion; finishing raises ownership [E2, E57, E58, principle
   1]. It is also the only door that needs no model call to produce a running game.
2. **Say it to the host.** At the shelf or inside Studio, holding to talk and describing a game.
   The host asks a few concrete questions, one at a time, each answerable by a word or a tap, and
   lays decisions on the TV as it goes. Evidence: a description is a good start and a bad spec; the
   model must turn it into decisions the creator can see [E8, E11, E13, principle 2]. The
   conversation is used only here and for "why" questions later [principle 3].
3. **Pick a structure from the shelf.** A second shelf inside Studio holds the five structures,
   each as a small box whose page runs a ten-second example. Choosing one starts a game with that
   structure and its decisions. Evidence: mechanisms over genres produce mechanically different
   games; new capabilities need to be shown, not described [E16, E21, E22, principle 9].
4. **Change the moment you are in.** While playing any game, the pause menu offers "Change this
   game". The TV shows the decisions in play at that moment. This is where most real changes will
   come from ("that tie rule was stupid") and it is the cheapest to express. Evidence: a concrete
   correction during a replay is the best source of a rule [E14, E34].

Not a door: typing a description. The phone has a text input control, but a paragraph typed on a
phone with everyone watching a TV is the wrong instrument. Typing is kept for word lists, as a
fallback to saying them.

## How the design is shown back

The bundle's hypothesis is a "playable rulebook" with four linked views: intent, editable rulebook,
stage preview, play trace. Challenged against the evidence and the room it must live in:

- Four views is three too many for a television read from a couch. A rulebook is read; the
  product's bar is that nobody reads. The critical print size puts body text at the threshold at
  three metres [E47].
- The evidence for understanding a system is strongest for watching it run and asking why, and
  weakest for reading rules [E1, E34, E35].
- A stage preview and a play trace are the same thing seen at different speeds.

So the design is shown back as one thing: **the rehearsal**. The game runs on the TV with paper
players. The host narrates it in the second person ("Now Teacup asks a question, and I rule on it,
and a door opens because you said every answer opens a door"). Pausing the rehearsal shows, below
the frozen scene, the cards for the decisions in play at that moment. The rulebook survives only as
the back of the box: three to five lines, generated from the decisions, at caption size, the same
lines the shelf already shows under `howToPlay`. Intent survives as the game's name and the one line
the creator said, kept on the box. The trace is what the pause reveals [principle 6].

What is lost: a view of the whole game at once. The rehearsal shows the whole game only over time.
To compensate, the row of cards can be browsed with the game paused at any phase, and swiping along
the row scrubs the rehearsal to the moment each card first bites. The whole game is a row of cards,
and the row is in the order a round happens.

## The scenes

### Scene 1: the shelf, with a new row on every box

The TV shows the shelf as today. A box is focused. Its page has the painting, the pitch, how to
play, and the rows "Play" and "How to play". A new row, "Make it yours", sits last. The phone shows
the touch surface with the driver's colour. The host, after a moment on the row, might say one of
its browsing remarks: "Go on. Change something." (eight words, recorded ahead, as DESIGN.md
requires).

A second box on the shelf is Studio itself: a plain card box with a lantern drawn on it, no
painting. Its page says what Studio is in two lines and has rows "Start from a structure" and "Say
it to me". Behind it on the shelf are the creator's own games, if any, each with its painting once
one exists and a plain card until then.

When it goes wrong: a room with one player sees everything; Studio works alone. A room with no
driver for five seconds lets anyone take over, as today.

### Scene 2: making it yours

The creator taps "Make it yours" on Twenty Doors. The TV changes in under 400 ms: the box's page
slides left and a table appears with a row of cards laid along it, the first in focus and lifted with
a hard shadow and a lamp edge. Each card has a name in Fraunces at caption size, a value below it,
and one line of consequence in body size. For Twenty Doors the cards are:

| Card | Value | Consequence line |
| --- | --- | --- |
| Doors | 20 | "The last door loses." |
| What it can be | an animal, something in a kitchen, a landmark, ... | "One is drawn each game." |
| Warn them | at 5 and 1 doors left | "I say how many are left." |
| Sort of | opens a door | "Or costs nothing." |
| Wrong guess | opens a door | "Or costs two." |
| Giving up | from the pause menu | "Or by saying so." |
| The host | dry, warm, a little smug | "How I talk in this game." |
| Name | Twenty Doors | "Yours will need its own." |

The phone shows the touch surface. Swipe moves focus along the row with the tick and lean of the
shelf. Tap on a card flips it: the value becomes a short column of choices, the current one on lamp,
and swipe moves among them, tap chooses, back corner flips it back. A number is a column of sensible
values, not a keypad: 10, 12, 15, 20, 25, 30. The host says nothing while the creator browses, and
one short line when a value changes: "Twelve. Harder."

Nothing is saved yet. A card changed since the last version is shown slightly lifted and offset,
with its old value small beneath the new one, so the change is visible without colour. The name
card, when flipped, offers three names the model wrote from the changed decisions and a fourth row,
"Say it", which opens the mic for one hold; what is heard becomes the name, shown on the TV for a
tap to confirm.

When it goes wrong: a value the structure cannot run (zero doors) is not offered; the column never
contains it. A spoken name that transcribes badly shows what was heard and the creator holds again.
If the model is unavailable the three suggested names are replaced by the old name with the changed
value appended ("Twelve Doors"), which is an acceptable game name on its own.

Reasons: pointing and choosing for local edits [E24, principle 3]; the design on the TV and the
phone as a thumb [E49, E51, principle 8]; every value offered is runnable, so the game never breaks
[principle 11].

### Scene 3: the rehearsal

A row "Rehearse" sits at the end of the cards. Choosing it clears the table. Five paper players
stand up at the table, Teacup to Matchbox, and the game runs as the TV would show it to real
players, with the real scene blocks, at about double speed. The paper players' lines appear as
captions with their names. The host speaks as it would in a game, but shorter, and adds the second
person: "Spoon asks if it's alive. Yes. A door opens, because every yes opens one."

Hold on the phone pauses the rehearsal at once and lets the creator speak. Tap pauses too. When
paused, the frozen scene slides up a third of the screen and the cards in play at that moment appear
below: here "Doors", "Sort of", "Warn them". The creator can swipe to one and change it; the
rehearsal replays from the start of this round with the same seed and the new value, so the same
questions get asked and the difference is visible.

At the end the TV shows a small tally, not a verdict: "Found it in 11 doors. 3 of 5 rehearsals
found it." The host says one line about what it noticed and may propose one card: "They had doors
to spare every time. Fewer?" with a card showing 12 beside 20. One tap takes it, one tap on back
leaves it, and nothing else moves [principle 4].

Where the paper players' words come from: in the first phases, from scripted personas that play
each structure well, badly and strangely (the giver-up, the guesser, the one who talks to the host
about something else), with no model call. Where a structure needs free speech judged by the host,
as Twenty Doors does, the rehearsal uses the text-only room path and the real host, which costs
model calls and takes real time; the TV says "Rehearsing with the host" and the paper players'
questions come from a bank written once per structure and varied by the model when the budget
allows [E42, E43, principle 7].

When it goes wrong: the host's model times out, the rehearsal pauses with "The host is slow
tonight" and resumes or offers to rehearse without the host, which runs the structural checks only
and says so. A rehearsal that does not end within its budget of steps is stopped and the card that
would end it is shown with the line "This never ended." The creator is never shown a passing
rehearsal as proof the game is good; the tally says what was counted.

### Scene 4: why

During a paused rehearsal, holding and asking "why did that happen", or tapping the frozen caption,
asks the trace. The TV shows a short column under the scene: the two or three facts that led here,
each with the card that produced it, newest at the bottom. "Candle said 'is it a platypus'. I ruled:
wrong guess. A door opened (Wrong guess: opens a door)." The host reads it in one breath. Swiping
to the named card and changing it replays the round.

Reasons: why-explanations from a recorded run are the strongest evidence this review found for
understanding a system [E34, E35, principle 5]. The explanation is built from the trace, not written
by the model from the rules; the model only voices it.

When it goes wrong: a moment with no decision behind it (a paper player's choice of words) says so:
"Candle just said that. Nothing you decided."

### Scene 5: saying a game to the host

From the Studio box, "Say it to me". The TV shows an empty table and the lantern turned toward the
room. The creator holds and talks: "A game where everyone gets a secret word, and one person is a
liar who has to work theirs into the conversation, and we vote on who it was." The host does not
repeat it back. It lays three cards on the table as it understands them, one at a time with a beat
between: "A secret" (each player, a word), "Roles" (one liar), "A vote" (on who the liar is). Then
it asks one question, the one whose answer changes the game most: "Does the liar know who the others
are?" The phone shows two paper cards, "Yes" and "No", for a tap, and the mic stays open for a word.
Then a second question if needed: "What ends it, the vote or a clock?" Three questions at most. Then
"Let's see it," and the rehearsal starts with the decisions it guessed, every guessed value marked
with a small question mark on its card until the creator has looked at it.

The creator's unusual constraint, "work theirs into the conversation", is kept as a card even
though no structure can check it: "The liar must use their word", with the consequence line "I can't
check this yet. The vote can." It is on the box and in the host's brief for the game, so the host
reminds players of it. Evidence: capture the odd idea before the default; do not map every idea onto
the nearest shipped game [E19, E20, principle 10].

When it goes wrong: the transcript is garbled, the host asks for the one part it needs rather than
"say that again". The description asks for something outside the five structures, drawing, trading,
a board, and the host says so in one line: "I can't do drawing yet. I can do the lie and the vote,"
and lays the cards it can. The creator can leave with those or leave with nothing; nothing has been
saved.

### Scene 6: the structure shelf

"Start from a structure" shows a row of five small plain boxes on the table: a secret, a judge, a
vote, a clock, a reveal, with roles and teams drawn as a sixth. Focusing one plays its ten-second
example on the TV in the upper half (a secret: one phone turns over a card, the others wait, the
host says it knows). Choosing one lays its cards. Choosing a second adds its cards to the row; the
structures compose, and the host says how: "A vote after the clock, then. Who's voted on?" with a
card for the answer.

Reasons: a shelf of mechanisms, each shown running, not a list of genres [E21, E22, principle 9].

### Scene 7: the box, the name and the painting

When the creator chooses "Keep this" (a row after the cards, offered only when the game has had one
complete rehearsal), the TV shows the box being made: the name card, the back-of-box lines generated
from the decisions, and a plain card where the painting will go. The host asks for nothing. A
painting is requested from Muse Image with a prompt composed from the structures and the creator's
words, in the one style DESIGN.md allows; it arrives when it arrives, and the box is plain until
then. The version is named by its biggest change: "Doors: twenty to twelve". The box slides onto
the shelf behind the Studio box, and the room returns to the shelf with the new box focused. The
host: "It's on the shelf. Shall we?"

When it goes wrong: the painting fails or is refused; the box stays plain card forever, which is
allowed. The name collides with a shipped game; the shelf shows both, and the creator's box says
"yours" under it.

### Scene 8: friends play it

The creator's box is played like any other. The pause menu for a Studio game has an extra row for
the creator only: "Change this game", which opens Scene 2 with the current moment's cards first. A
change made mid-game does not change the game being played; it is a new version, and the room keeps
playing the old one. At the end of a game, the TV's result screen adds one line for a Studio game:
"Version 3, played to the end 4 times." The host's recap may name the change: "Twelve doors was
right."

### Scene 9: sharing

The box's page has a row "Give it a code". The TV shows a six-letter code and the same QR frame the
room uses, and the host reads the code once. In another room, the shelf's last box is "Add a game",
which asks for a code: spoken, or typed on a phone card. The game appears on that shelf with its
lineage line: "By [creator's chosen name], made from Twenty Doors". The remixer may add one line of
thanks by holding and saying it. There is no public gallery in the first versions. When one exists,
it is several short rows on the shelf, each ranked by plays finished or replays within a week, never
a single leaderboard and never a like count [E60, E61, E62, principle 13].

## How the model helps at each layer, and where it must not

| Layer | The model may | The model must not | Mechanism |
| --- | --- | --- | --- |
| Intent | Ask up to three concrete questions; lay structure cards as it understands a description; keep the odd constraint as a card | Decide any value silently; drop a constraint it cannot check | Spark, structured output constrained to structure ids and decision values; the host's existing turn loop |
| Rules | Propose one value for one card with a reason from the tally | Write rules; change a value; change two cards at once | A proposal is a card with old and new values; applied only by `apply` of a tap |
| Host brief | Write the per-game `hostBrief` and per-phase `hostBrief` lines from the decisions; write the browsing remarks | Write anything that names a secret or a role as known; change the persona's table rules | Generated text is shown as a card the creator can hear read; the host's standing persona is fixed in `room/host.ts` |
| Art | Draw the box painting; draw per-phase backdrops where the structure declares them | Draw faces, text, logos; be presented as human-made | `draws` and a studio-level call to `providers/meta/image.ts` |
| Content | Write secrets, questions, word lists at play time, as the shipped games do | Be the only source: every content request has a fallback list in the blueprint | `contentRequest` with the blueprint's fallback |
| Playtest | Voice the paper players' free speech within a bank; rule as the host rules in real play | Judge whether the game is good; estimate difficulty for humans | Text-only room path, as `tools/scenarios/` do |
| Repair | Read a trace aloud; propose one card | Infer a cause the trace does not show; re-read the rules and "fix" them | Explanation built from `system`-scoped "because" facts |

## How simulated playtests are run, shown and explained

Two layers, run in this order.

**Structural rehearsals, no model.** An in-process harness holds a configured `Cartridge<State>`
and calls `init`, `apply` and `onEvent` directly, the way `cartridges/werewolf/rules.test.ts` does,
with a fixed random source and scripted personas per structure. Twenty rehearsals run in well under
a second. They check invariants that do not come from the model: every rehearsal reaches `outcome`
non-null within a step budget; every phase id in the manifest is entered at least once across the
set; no fact whose text contains a host-scoped or player-scoped secret is ever emitted with a
public scope, and `publicScene` never contains it; every player who is asked to act by
`privateControls` has at least one `legalActions` entry; a tie, a departure (`playerLeft`) and an
all-abstain vote each have a defined result; timers fired after a phase change do not advance a
later phase. The tally shows counts: who won how often, average length, which phases were reached.
Balance for role games is shown against the known theory where it exists [E41].

**Host rehearsals, with the model.** Where a structure routes speech through `hostRulings`, the
rehearsal runs the game through the text-only room path (`GAME_ROOM_TEXT_ONLY=1`), the paper
players speaking from a bank, and the real host ruling. This is what `tools/scenarios/*.ts` already
do by hand. It costs Spark calls and minutes, so it runs once per "Keep this" and on request, not
on every change. It checks what only the host can break: that a ruling the phase does not allow is
dropped (the room already does this), that the host does not say a secret before the end (the
scenario scripts' leak check, generalised to every host-scoped fact), and that the phase advances
when players say the things that should advance it.

**Shown.** Structural rehearsals play on the TV as Scene 3 at speed, one at a time, with the tally
for the set at the end. Host rehearsals play at the host's real pace with "Rehearsing with the host"
in the corner.

**Explained.** The interpreter emits, alongside every fact, a `system`-scoped fact of kind
"because" whose text is the decision id. The room shows `system` facts to nobody and briefs the host
on none of them (`canSee` and `hostMaySee` both return false for `system`), so this costs nothing in
play and gives the trace its links. Scene 4 reads them back.

## How a creator repairs a broken game

A broken game is one that fails a structural check or does something the creator did not want. The
repair loop is: pause at the moment (Scene 3), ask why (Scene 4), change the card named by the
answer, watch the same round replay from the same seed. If the failure is "never ends", the harness
names the phase it was stuck in and the card that could end it. If the failure is a leak, the harness
names the fact and the card whose scope was wrong, which for a blueprint can only be a "who knows"
decision. The model may propose the card and the value, from the trace; the creator taps. A change
that would make the game unrunnable is never offered as a value, so repair cannot make things worse
[principles 5, 11].

## Versions and undo

Every "Keep this" commits a version: the blueprint, its name, the tally of its last rehearsal, and
the time. Versions are append-only. The box's page lists them as rows named by what changed, newest
first, with the one friends have played most marked by its play count. Choosing an older row makes
it current without deleting the newer ones; that is undo, and redo is choosing the newer row again.
A room that starts a game pins the version it started, so a change elsewhere never alters a game in
play [principle 12]. Uncommitted changes live only on the TV; leaving Studio asks one question,
"Keep it?", with the last running version always safe.

## How a game reaches the shelf, a room and other people

- **The shelf.** Today the shelf is `GAMES` in `cartridges/index.ts`, a static list read by the
  room's brief, the shell and `startGame`. A Studio game needs a per-room shelf that holds installed
  games plus the creator's own, and a store the room reads at start. The host's lobby brief lists
  what is on the shelf, so Studio games are startable by voice like any other.
- **A room.** A Studio game runs through `GameSession` exactly as a shipped one: the interpreter
  cartridge is a `Cartridge<State>`, and `InstalledGame.create` builds it from a blueprint.
- **Other people.** A code, as in Scene 9, resolves to a blueprint in the store. Rooms live in one
  process today (`room/directory.ts`), so a store is new in any case.

## Mapping onto what exists

| Studio part | What exists | How it is used |
| --- | --- | --- |
| Blueprint → manifest | `CartridgeManifest`, `PhaseSpec`, `VariantOption` | Phases, per-phase `hostBrief`, `listening`, `hostRulings` and `keywords` are generated from structures and decisions; the manifest is already declarative and needs no change |
| Blueprint → rules | `Cartridge<State>`, `Step<State>` | One interpreter cartridge, written once, configured by the blueprint; `init` draws roles and requests content, `onEvent` routes `hostRuled`, `timerFired`, `speechEnded`, `contentReady`, `drawingReady`, `playerLeft`; `apply` handles votes and give-ups |
| A secret | `contentRequest`, `hostFacts` with `{ kind: "host" }`, `ScopedFact` with `player` scope | As Twenty Doors does; fallback list in the blueprint |
| Roles and teams | `roleOf`, `groupsOf`, `roleCard` with `secret: true`, `group` scope | As Werewolf does |
| A judge | `hostRulings` per phase, `hostRuled` events, `allowsRuling` | Rulings and their effects are a decision table in the blueprint; the room already drops rulings the phase does not allow |
| A vote | `choice` control, `apply`, `legalActions` | Options generated from living players; tie rule is a decision |
| A clock | `Step.timers`, `timerFired`, the `timer` scene block | Phase timers are decisions |
| A reveal | `nextPhaseId`, public facts, `draws` | The reveal phase's facts and picture are generated |
| Turn-based talking | `listening` keyed by role | `roleOf` returns "speaker" or "listener" by turn; no contract change |
| The TV in play | `SceneBlock`: title, text, image, roster, timer, tally, progress, caption | Studio composes only these; no new blocks |
| The phone in play | `Control`: roleCard, buttons, choice, textInput, waiting, notice | Studio composes only these |
| Host rehearsal | `GAME_ROOM_TEXT_ONLY=1`, `tools/simulate.ts`, `textOnlySay` | The paper players are `FakePhone`s |
| Structural rehearsal | The in-process pattern of `rules.test.ts` | A harness over the interpreter with fixed random |
| Explanation | `system` scope, never shown or briefed | "because" facts carry decision ids |
| Browsing remarks, pitch, how to play, pause actions | `InstalledGame` in `cartridges/index.ts` | Generated per version |
| Safety of the host | The room passes `hostFacts(state, { kind: "host" })` to the brief unfiltered | The interpreter returns host facts only for decisions marked "the host knows"; this is an author obligation the interpreter discharges once for every Studio game |

## What the contract must grow, exactly and why

1. **A per-room, mutable shelf.** `GAMES` is a module constant. Add an installed-games source the
   room is given at construction and can add to while running, and read it in `Room.brief`,
   `Room.startGame` and the shell's `games()`. Without it no Studio game can be started.
2. **A blueprint store.** Rooms are in memory and there is no persistence anywhere. Add a small
   store (a file per blueprint is enough to start) under a new `studio/` folder, with the version
   list and the code lookup. Without it no game survives the room.
3. **Studio shell screens.** `ShellScreen` is a closed union of six screens and the screen and phone
   render them. Add screens for the card row, the rehearsal and the box, with their `menu` rows and
   focus handling in `room/shell.ts`. This is the largest piece and needs a programmer; it is a
   TV renderer, not a scene.
4. **Studio-level drawing.** `Room.draw` is private and tied to the running game, and drawing is off
   in text-only mode. Box art needs a call to `providers/meta/image.ts` outside a game session, with
   its own budget line in `room/limits.ts`.
5. **`controlIndex` to the rules.** `Room.onControl` records the index and drops it; `apply` gets
   only the value. A game with two controls on one phone cannot tell which answered. Either pass the
   index through `RunningGame.input` to `apply`, or have the interpreter prefix option ids, which
   works today with no change. The second is the plan; the first is the honest fix.
6. **Declared but not enforced.** `hostMayInterject` and `silenceSeconds` have no consumer, and the
   `silence` event in `shared/timeline.ts` is never emitted. Studio must not offer "the host speaks
   up after a lull" as a decision until the room implements it or the fields are removed. Likewise
   `choice.multiple`: the phone renders it the same either way, so no multi-select decision until it
   does. `variants` are read with their defaults and never collected; for Studio games decisions
   replace variants, so the blueprint emits an empty `variants` list.
7. **A budget line for rehearsals.** `BUDGET.spend("spark")` is per room; host rehearsals spend it.
   Add a "studio" line so a creator rehearsing cannot starve a game in another room.
8. **A persona per game is already possible; a voice is not.** `hostBrief` is per game and per
   phase, so the host's manner can be a decision. The voice is one `SpeechVoice` for the room; a
   per-game voice would be a change in `room/host.ts` and the speech provider, not proposed here.

## What cannot be done without a programmer today

- Anything outside the five structures and roles: drawing, trading or inventories, a board or map,
  simultaneous planning with commit and reveal, continuous or timing-based play. Each is a new
  structure in TypeScript with its own controls or scene blocks, and the bundle's earlier review
  already listed what each would need.
- A new scene block or control. Studio composes the eight blocks and six controls that exist.
- A new ruling kind that is not "the host judged speech into one of these named outcomes".
- The Studio screens themselves (item 3 above), the store (item 2), the shelf (item 1).
- Changing how the phone listens beyond the four modes.

## Where this disagrees with DESIGN.md

- **Body size on the TV.** DESIGN.md sets body at 32 px at 1080p. On a 55-inch set at three metres
  that is an x-height of about 0.19 degrees, at the consensus critical print size below which
  reading slows [E47]. For a game night this is fine: body text is glanced, and captions at 46 px
  are fluent. For Studio, where a creator must read a decision's name and value, the design above
  uses caption size for names and values and body size only for the consequence line, which the
  host also speaks. The disagreement is narrow: the rule holds for play and is too small for text
  that must be read. Proposed change to DESIGN.md: "Anything a person must read, not glance, is set
  at caption size."
- **"Instructions always stay on the TV."** Agreed, and the evidence is behind it [E49, E50, E51].
  Studio's one exception is already allowed by the rule for slow choices: a word list typed on a
  phone card, mirrored to the TV when done.
- **One driver.** The driver rule is a mitigation of a real cost to the non-controller [E53]. For
  Studio, where two people may be making a game together, the design lets any phone flip and change
  the focused card after the driver's five seconds idle, as the shelf already allows for navigation.
  No change to the rule; a note that Studio relies on the takeover.
- **"Lamp means live or chosen and nothing else."** Studio needs to show "changed since the last
  version". The design uses lift and offset with the old value small beneath, not colour, so the
  rule holds. The planning notes' docs brief also reserves wine for warnings; Studio uses wine only
  for "this never ended" and "I can't check this".
- **The host's browsing remarks.** The rule allows one remark per game box, half the time, eight
  words or fewer. On Studio's card row the design keeps the host silent during browsing and lets it
  speak one line on a change. That is stricter than the rule, not looser.
- **No disagreement found** with the material rules, the banned list, the gestures, the motion
  budget or the sound. The evidence on glanceable displays [E52] and on mixed initiative [E25, E26]
  supports them.
