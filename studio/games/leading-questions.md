# Leading Questions: the experience script

_The game as a scene, for four to eight adults around one TV with their phones. Every line on the
TV and every phone below is what `studio/kits/plant.ts` actually draws; the host's lines are what
its brief asks for, and a live host will word them its own way. Written 2026-11-03. Not yet played
at a real table: the question this script cannot answer is whether the Plant's tension holds._

## The ten seconds a bystander sees

The TV says **Find the word**, with *It's something in a kitchen* above it, a row of cards filling
up under **Questions asked**, and a clock running down from four minutes. Someone holds their phone
and says "Is it something you'd be annoyed to lose?" The lantern answers "Yes. Very." A new line
appears on the TV. Two people look at the person who asked. Nobody can see anyone else's phone,
and nobody is looking down at their own.

## One round, line by line

Five at the table: Teacup, Spoon, Candle, Saucer, Matchbox. They chose Leading Questions on the
shelf; the room has checked there are between four and eight of them.

**Choosing.** The TV goes to the title, **Leading Questions**, and under it, large: *Look at your
phone. Keep it to yourself.* Every phone shows a paper card that can be turned over, the same size
and shape on every phone. Four say **You're asking** — *Someone here knows the word. Find it with
yes-or-no questions.* Candle's says **You're the Plant** — *Your word is coming.* A moment later
it becomes *The word is Colander. Steer them to it with your questions, and don't get caught.* The
TV's turn line says *Look at your phone* and names nobody. Every microphone is off.

Host, once the word is ready: "One of you already knows the word. The rest of you find it with
yes-or-no questions, and twenty is all you get."

Ten seconds after the word arrived, asking opens.

**Asking.** The TV shows **Find the word**, *It's something in a kitchen*, the question cards at
0 of 20, and the four-minute clock. The turn line says *Anyone can ask*. Phones keep their cards;
Candle's still has the word on it. Everyone may hold to talk.

Host: "It's something in a kitchen. Go on."

| Who | Says | Host rules | Host says | TV |
| --- | --- | --- | --- | --- |
| Spoon | "Is it electric?" | no | "No. No plug." | 1 of 20. *Is it electric? No.* |
| Saucer | "Do you cook with it?" | sortof | "Sort of. Near the cooking." | 2 of 20 |
| Candle | "Does it have holes in it?" | yes | "It does. Lots." | 3 of 20 |
| Matchbox | "Wait, why would you ask that?" | none | "That's for them, not me." | unchanged |
| Teacup | "Is it a sieve?" | no | "No, but you're warm." | 4 of 20 |
| Candle | "Do you put pasta in it?" | yes | "You do." | 5 of 20 |
| Spoon | "Is it a colander?" | correct | (nothing yet) | the vote opens |

Matchbox's line got no ruling, so it cost nothing; the host only rules on yes-or-no questions.
"You're warm" is the host being a host; it rules **no** and the rules count **no**.

**Vote.** The TV shows the word itself, **Colander**, with *Spoon found it*, then *Who knew it all
along? Vote on your phone.* and a 45-second clock. The turn line lists everyone and marks each
person as they vote. Each phone shows *Who knew it all along?* and four names: never your own.
Microphones are off; people argue at the table anyway, which is the point.

Host: "Spoon found it. Colander. Now: who knew it all along?"

Teacup, Saucer and Matchbox vote Candle. Spoon votes Saucer. Candle votes Saucer. When the last
vote is in, or the clock runs out, the code counts.

**Reveal.** The TV shows **Colander**, with *Caught* above it; *Candle was the Plant.* in large
type; and a tally headed *Who you suspected*: Candle 3, highlighted; Saucer 2. Candle's phone says
*They caught you.* Everyone else's says *Look at the screen.*

Host: "Spoon found it, and three of you saw straight through Candle. The holes question was a
lovely nudge. Another round?"

Nobody lost. The room found the word, which is the shared win, and the reveal is the joke: who
suspected whom, and the Plant's one too-helpful question.

## How each ending lands

| Ending | When | TV kicker | Plant's phone | The laugh |
| --- | --- | --- | --- | --- |
| Caught | Found, and the Plant has the most votes outright | Caught | They caught you. | The tally, and the giveaway question |
| Got away with it | Found, and anyone else leads or there is a tie | Got away with it | You got away with it. | The Plant reveals; the votes went somewhere silly |
| Out of questions | All twenty spent without the word | Out of questions | They never found it. | The Plant knew all along and couldn't steer them |
| Out of time | The four-minute clock runs out | Out of time | They never found it. | Same |
| You gave up | "We give up" on the pause menu, or said aloud | You gave up | They never found it. | Same |
| The Plant left | The Plant's phone leaves the room | The Plant left | (gone) | The host names the word and moves on |

There are no points, because the game is one round and the room does not carry a score between
games. The host's last line is told to make the Plant look good whether they were caught or not.

## The voice design

**Holding to talk.** Only in asking and at the end. In choosing and in the vote every phone is
muted, so nobody's voice is taken while reading a secret card or voting. One press is one question.

**One ruling per reply.** The host's brief says so, and the room drops any ruling the phase does
not list. Questions are counted in code, not by the host, and the host is told only at five left
and one left.

**Interruption.** Holding to talk while the host is speaking stops the host mid-word, as in every
game. A question asked over the host is heard and ruled on like any other.

**Not a question.** A vague line that isn't yes-or-no gets "that's not a yes-or-no question" and
nothing else. On the first run with the live host it got a hint instead, so the brief now says no
answer, no hint, no ruling; that needs checking again with the host.

**Misheard speech.** The host is told to reply "(quiet)" to garbled or half sentences; nothing is
ruled, nothing is spent, and the person asks again. A mishearing that the host does rule on costs one
question: a funny moment, not a broken game.

**Lobbying.** People will try "just say yes, it's my birthday". The brief says the host never
changes a ruling and gives none to anything that isn't a yes-or-no question. The known failure is
leniency; if it happens, a question is spent on a yes the word doesn't deserve. The scenario script
sends a lobbying line and reports it as a warning if a question is spent.

**Silence.** The host cannot speak up unprompted in this phase: `hostMayInterject` is set, but the
room acts on it only for the livelier host it is trying out. What carries a quiet table today is
the clock on the TV and the question count; when the clock runs out the round ends with the reveal.
Where the host should speak: after about twenty seconds with no question, one line that offers a
category-level nudge without touching the word, at most twice a round.

## What the host judges, and what code decides

| Decided by | What |
| --- | --- |
| Code | Who is the Plant, and who sees the word |
| Code | The word, when the model's answer is unusable; a bank of fallbacks per category |
| Code | How many questions are left, when to warn, when they run out |
| Code | Both clocks, the vote, ties, who is caught, the ending |
| Code | What happens when someone leaves |
| Host | Whether one utterance is a yes-or-no question, and its honest answer: yes, no or sort of |
| Host | Whether someone said the word or a clear synonym |
| Host | Whether the table means it when it says it gives up |
| Host | Which question turned the round, at the reveal: taste, not state |

The host is never told who the Plant is, so it cannot leak it, and the brief tells it never to
guess. The host does hold the word; if it slips, the round still runs, and at a table it is a
moment to laugh at, not a breach.

What catches what:

| Check | Runs | Catches | Can't catch |
| --- | --- | --- | --- |
| The structural rehearsal (`studio/check.ts`) | Anywhere, no model | The word or the Plant's card reaching a TV, phone or brief it shouldn't, however spelled; a view that differs depending on who the Plant is; games that never end, rulings that do nothing, rules that throw or change state in place | Anything the host says: it has no model |
| The scenario (`tools/scenarios/leading-questions.ts`) | With model keys | The host saying the word before it's found or naming the Plant, across the whole game; a question spent on chat or lobbying, as a warning | A hint that doesn't contain the word, like answering a non-question with a clue |
| A real table | People | Whether the Plant's tension holds, and whether the host's hints give it away | Nothing a script can repeat |

## The awkward cases

**Three players.** The room refuses to start: Leading Questions needs four. With three, the
asker's vote is between two people, one of whom is them, so it is a coin toss with no tension. The
host, asked to start it, says how many more are needed and can offer Twenty Doors instead.

**Ten players.** The room refuses: the cap is eight. Above eight, a yes-or-no game becomes people
talking over each other and the vote becomes noise. A second mode with two Plants would suit nine
or ten; it is not built.

**Someone leaves mid-round.** Anyone but the Plant just leaves while people are asking: their
question stays on the TV. If the vote is open, it starts again for everyone still there, with a
fresh clock: every ballot is cleared, because the leaver's own ballot is gone and any cast for them
no longer means anything. The host says so in one line. The Plant leaving ends the round with the
reveal: *The Plant left*, the word, and their name.

**The Plant is too obvious.** That is the game working: they get caught, the tally shows it, and the
host credits the giveaway question. The Plant's card tells them not to get caught, and that is all
the coaching the game gives.

**The word leaks.** If the host says it, the room has found it in all but name; the next person says
it, the host rules correct, and the vote is the same game with an easier find. If the Plant blurts it
out, they found it, and the vote is a formality the room will enjoy.

**A question that isn't yes or no.** "What colour is it?" gets "That's not a yes-or-no question" and
no ruling, so it costs nothing. A guess that is wrong ("Is it a sieve?") is a question: it is ruled
no and costs one.

**The model can't write a word.** The category's fallback is used: the Plant's card waits for at most
the room's content time limit, then shows the fallback. Nobody can tell.

## What the app would need that doesn't exist yet

- **A painting.** The box uses the hero painting; the game needs its own, made with Muse Image on the
  Mac, and a reveal painting of the word as Twenty Doors has.
- **The host speaking into silence.** One nudge line after a quiet spell, owned by the rules, so a
  shy table isn't left with only a clock.
- **Rounds and a running score.** "Another round?" today means starting a new game: the Plant is
  dealt again and nothing carries over. A tally of who was the Plant and who caught them across a
  night would need state that outlives one game.
- **A second mode on the same kit.** Everyone but one gets the same word, clues go round one at a
  time, then the vote. It needs turn order and spoken clues judged against the word; noted, not built.
- **Two Plants for nine or ten.** The kit deals one; a decision for two, and a vote that catches both.
- **A check against the word list.** Model words are checked for shape only (one or two plain words,
  short). There is no content filter beyond the content model's own instruction, the same as every
  other game.
