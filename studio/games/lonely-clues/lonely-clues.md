# Lonely Clues: the experience script

Three to eight players, about two minutes a round, five rounds. One player guesses a word they
can't see. Everyone else sees it on their phone and types one word. Clues that match cancel out
and the guesser never sees them. The table scores together. The joke is the reveal afterwards,
when the host says who wrote what.

What makes it different from the other games on the shelf: nobody asks questions and nobody
holds a secret role. The tension is writing a clue that is clever but not so clever that someone
else has the same idea, and the comedy is everyone discovering they were the same kind of clever.

## The ten seconds a bystander sees

The TV says "One word each" and one name is guessing. Three phones light up with a word and a
box. A bar fills as clues come in. Then the screen goes quiet and words arrive one at a time,
slowly: "moonlight", "crumbs". Under them a small line: "2 clues did not make it." The guesser
says an answer. The word fills the screen, and below it, two names and a word they both wrote.
Everyone groans.

## One round, line by line

Spoon is guessing. The word is "ferry".

**Writing.** The host: "Round two. Spoon, look away from everyone's phones. The rest of you,
one word each. If two of you match, you both vanish." The TV shows "One word each", Spoon's
name, a progress bar of clues in, and a 45 second clock. Spoon's phone shows a card that says
they are guessing and "Look away from their phones." Teacup, Candle and Saucer see a card with
the word and a box. Nobody talks: every microphone is muted, which also stops whispering hints.
Each phone's box becomes "Your clue is in" once sent. The round moves on the moment the last
clue arrives, or when the clock runs out.

**Reveal.** The host: "Two clues did not make it. I won't say which. Here is what's left." Then,
a beat apart: "Tuesday." Each survivor comes up on the TV as the host reads it, three seconds
apart. If nothing survived the host says so with relish and the TV says "Nothing survived."

**Guess.** The host: "Spoon. One guess." The TV shows the survivors and a 40 second clock.
Spoon's phone has a box, and Spoon can also hold and say it. Only Spoon's microphone is open.
Spoon: "Is it a ferry?" The room judges that in code, not the host.

**Result.** The host: "Ferry. Right. And I'll tell you what Spoon didn't see. Teacup wrote
sleep. Candle wrote sleeping. You cancelled each other out. Two points, and the team is on two."
The TV shows the word, what Spoon said, and a line per cancelled group ("Teacup and Candle both
wrote sleep."). After 18 seconds the next round starts by itself.

**End.** The host gives the rating, picks out one word that went well or badly, and offers
another game. Ratings are "Mind readers", "On the same page", "Getting warm" and "Polite
strangers", by the share of the best possible score. The TV lists every word and what it won.

## How each ending lands

- **Right.** Two points, plus one if no clue was cancelled, refused or missing. The host is
  pleased for the team and teases whoever cancelled.
- **Wrong.** No points. The host says what the word was and goes straight to the cancelled
  clues; a wrong guess with a good reveal is still a good round.
- **Out of time.** The same, said gently. The guesser had 40 seconds.
- **Passed.** Anyone can pass from the pause menu. No points, no blame; the reveal still runs.
- **Void.** The guesser left. The round doesn't count and nobody loses a point.

## The voice design

- Everyone is muted while writing and during the reveal, so the host can read without being talked
  over and nobody can whisper a hint.
- During the guess only the guesser can talk. If they ask the host for help, the host says it
  can't. The host rules one thing in this phase, `locked`: the guesser has committed to one
  answer. Thinking aloud is not a guess, and does not use it up. The guesser can always type.
- The host is never told the word while a guess is open, and never told a cancelled clue until
  after it. It cannot leak what it doesn't hold. It reads survivors it was told, as written.
- On silence: the writing clock and the guess clock end the phase. Nobody waits on a person.
- If the host is interrupted in the reveal, the TV still shows each clue on time; the host loses
  a line, not the round.

## What the host judges, and what code decides

Code decides everything that matters: the word, who guesses, which clues are one word, which
contain the word or a form of it, which clues are duplicates, whether the guess is right, the
score and the rating. The host rules one thing: that a spoken line was the guesser's final
answer, and a wrong ruling there only means the guesser types it instead.

Duplicates merge case, accents, hyphens, plurals, common endings, British and American
spellings and one slipped letter in a longer word, so "colour" and "color" cancel, and "bread"
and "break" do not. A smarter matcher can replace it behind one small type without touching the
game.

## The awkward cases

- **Three players.** One guesser and two writers. If the writers match, nothing survives and
  the guesser guesses blind, which is its own joke. This is the smallest table that works.
- **Eight players.** Seven clues is a lot to read. The reveal is three seconds a clue and a short
  pause; it is the longest it gets.
- **Someone leaves.** A writer leaving takes their clue away. The guesser leaving voids the
  round. Fewer than three people left ends the game with the score so far.
- **A clue with two words, digits or symbols.** Refused with "One word, please", and they try
  again. A clue that contains the word or an obvious form is refused too, with "too close to the
  word". Two retries, then that player sits the round out. The reveal names the refused ones.
- **A hostile line.** The room's content check refuses it before the game sees it. The writer
  is told "That one won't work. Try another." and nothing reaches the TV or the host.
- **A near-twin.** "Pizza" and "piza" cancel. "Heart" and "hear" don't. It leans toward
  keeping clues apart.
- **The guesser talks while thinking.** Not a guess until the host rules it, or they type it.
- **A word that is a name at the table.** The word list avoids common names; a player called
  Candle with the word "candle" would show the word on the TV in their name, and that's theirs
  to deal with.

## What the app would need that doesn't exist yet

- A way to show a refused clue back on the same box without changing its id; today the game gives
  the box a fresh id and a note.
- A way to start the guesser's microphone alone without muting the others by role; the game uses
  its role id, which works, but a "guesser only" listening mode would read better.
- Real box art. The game points at the shared placeholder.
