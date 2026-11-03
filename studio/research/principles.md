# Principles for Funhouse Studio

_Thirteen rules, each one sentence, each traced to `evidence.md` by its source numbers, each with
one example of what it lets in and one of what it keeps out. They are written to settle arguments.
If a proposed screen breaks one, the screen changes or the principle changes here first._

## 1. The first thing a creator does is change a game that already runs

**Principle.** A creator's first action is a change to a working game, and the result runs on the
TV within the same sitting [E2, E3, E4, E57, E58].

**Rules in.** Opening any box on the shelf shows a "make it yours" card; choosing it puts the
creator inside that game's decisions with every one already made, and the first changed decision
can be played at once.

**Rules out.** A Studio home screen with a blank canvas, a "new game" button, or a tutorial that
must be completed before a game can be run.

## 2. Description starts, decisions finish

**Principle.** A spoken or typed description is accepted as a starting point and never as the
specification; the system turns it into finite, visible decisions and only those decisions are the
game [E8, E9, E11, E12, E13].

**Rules in.** The creator says "a game where one person lies and everyone votes" and the TV lays
out cards: how many liars, who knows who, what the vote decides, what ends the game, each with a
value already chosen and marked as a guess.

**Rules out.** A text box whose contents are the rules; a "generate" button that produces a game
from a paragraph without showing what it decided; a game whose behaviour depends on how the model
read a sentence.

## 3. Point to change, talk to begin

**Principle.** Any change to an existing decision is made by selecting it and choosing, and the
conversation with the host is reserved for starting, for what cannot yet be pointed at, and for
asking why [E6, E23, E24, E25].

**Rules in.** Swiping to the "ties" card and tapping through "nobody is out", "both are out",
"vote again"; saying "Marlowe, can there be two of them?" when no card for the number exists yet.

**Rules out.** Changing the number of rounds by asking the host to do it when the rounds card is on
the screen; a chat transcript as the main surface of Studio.

## 4. The model proposes one thing at a time and never changes anything on its own

**Principle.** Every model suggestion is a single proposed value or card, shown as a proposal with
its consequence, applied only by the creator's tap, and refused by one tap that changes nothing
[E25, E26, E27, E28, E30, E31].

**Rules in.** After a rehearsal, the host says "the wolves won four of five; want fewer wolves?" and
a card appears with the new number and the old number beside it.

**Rules out.** "I've improved your game" followed by three changed cards; rewriting the host brief
because the creator changed a round count; any change the creator did not see happen.

## 5. Repair comes from a trace, never from the model re-reading itself

**Principle.** A fix to a broken game is proposed only from a recorded run that shows the failure,
and the same run is replayed after the fix to show it gone [E32, E33, E34, E35, E45, E46].

**Rules in.** "Why did Teacup get two points?" answers with the two facts and the rule that produced
them, and the fix replays that round from the same seed.

**Rules out.** "Let me check the rules again" producing a different game; a "fix it" button with no
trace behind it; accepting a model's statement that the game is now correct.

## 6. A rehearsal is the rulebook

**Principle.** The game is shown back as itself, running with paper players on the TV, with the host
narrating which decision caused each moment; written rules exist only as the few lines on the back
of the box [E1, E34, E35, E36, E47, E52].

**Rules in.** A rehearsal of one round at double speed with pause on any moment; the back-of-box
lines generated from the decisions and shown at caption size.

**Rules out.** A rules document longer than a box back; a node graph as the first view; body text on
the TV below caption size for anything the creator must read.

## 7. Simulation proves structure, people prove fun

**Principle.** Simulated players and rule checks are presented as what they are, evidence that the
game ends, that every phase is reachable, that no secret leaks and how often each side wins, and
never as evidence that the game is good [E37, E38, E39, E41, E42, E43, E44].

**Rules in.** "Twenty rehearsals: the village won 14, no secret was said aloud, every round ended."

**Rules out.** A star rating from a model; "players enjoyed it"; tuning a guessing game's difficulty
against model players.

## 8. The TV holds the design, the phone holds a thumb

**Principle.** In Studio the design is on the TV and the phone shows only the touch surface and, for
slow choices, one card, so a creator and their friends never have to look down to follow [E49, E50,
E51, E53].

**Rules in.** Decision cards in a row on the TV with one in focus; a word list spoken to the host or,
as a fallback, typed on a phone card that mirrors onto the TV when done.

**Rules out.** An editor on the phone; a form; a second creator left watching a blank TV while the
first edits on their own screen.

## 9. Mechanisms on the shelf, not genres

**Principle.** What the creator chooses from is a short shelf of game structures, each shown as a
running example and each carrying its own decisions, rather than a list of game types to reskin
[E15, E16, E20, E21, E22, E66, E67].

**Rules in.** A shelf with a secret, a judge, a vote, a timer, roles and teams, a reveal; choosing
"a secret" shows it working in a tiny round before anything else.

**Rules out.** "Trivia", "Deduction", "Party" as the top-level choice; a gallery of look-alikes
differing only in theme and name.

## 10. Capture the odd idea before offering a default

**Principle.** When a creator describes a game, the system records what is unusual in it and shows
that back first, before any template or default is offered, and the design keeps that constraint
visible [E17, E18, E19, E20].

**Rules in.** "The liar has to use the word 'marmalade'" becomes a card the system keeps even when
it does not yet know how to check it, and the host says so.

**Rules out.** Mapping every description to the nearest shipped game and dropping what did not fit;
offering examples before the creator has said anything.

## 11. Every session ends with a game that runs

**Principle.** The creator can always play what they have, and leaving Studio saves a version that
runs, so no session ends with a broken or half-made game on the shelf [E4, E57, E59].

**Rules in.** A change that would break the game is shown as a card the creator cannot yet commit,
with the last running version still playable.

**Rules out.** A draft state that cannot be played; losing changes on leaving; a shelf box that opens
to an error.

## 12. Versions are kept, named by what changed, and a change never alters a game someone is playing

**Principle.** Every committed change is a new version whose name is the decision that changed; any
version can be stepped back to; a room that started a game keeps the version it started [E25, E27,
E31].

**Rules in.** "Doors: twenty to twelve" as the name of a version; a shelf box that shows which version
friends played most.

**Rules out.** A single mutable game; an undo that loses the redo; an edit that changes a game
mid-round in another room.

## 13. Credit is given by people, lists are ranked by play, and nothing nags

**Principle.** A game shows its lineage automatically and lets a remixer add a line of thanks; any
list of games is ranked by plays finished and replays, split into several small lists, and Studio
never uses streaks, timers or social pressure to bring a creator back [E60, E61, E62, E63, E16].

**Rules in.** "Made from Twenty Doors" on the box with a line the creator wrote; a shelf of "played
to the end this week" beside "new from people you played with".

**Rules out.** A like count; one global leaderboard; "your friends are waiting"; a daily reward for
opening Studio.
