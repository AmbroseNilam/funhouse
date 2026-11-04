# Cold Read

_Reverse twenty questions for two to eight people. Blueprint: `cold-read.ts`. Kit:
`studio/kits/host-guess.ts`._

**The round.** The table votes on a category on their phones (a person, a place, an animal, an
everyday object, a food or drink, a story character). Then everyone agrees on one thing in it, out of
the host's hearing, and taps ready. The host, who knows nothing, asks yes-or-no questions. Each phone
shows the question with Yes, No and Sometimes; the most taps wins, a tie is Sometimes. The host has
fifteen questions and three guesses. A guess before the last goes to the phones as Yes, that's it or
No, not it; a wrong one costs a question. The last guess, or the first one after the questions run
out, is final: the TV asks everyone to hold their phone and say what it was, then to tap whether the
host was right. The host reacts to the result either way.

**How it differs.** In Twenty Doors and Leading Questions the host holds the secret and the players
ask. Here the players hold it and the host asks, so the demo is the host's questions. The mechanic is
a majority tap on a question the host chose, not a ruling on something a player said.

**What code decides.** The category vote and its ties (a tie is broken by the random source), the
question budget, the guess allowance, which guess is final, the answer count, duplicates, a second
question while one is open, a question after the budget is spent, every clock, and the board: each
question and its answer, which the host is shown on every turn so it never has to remember. The
thing itself is never typed, spoken to the game or stored, so nothing the host says or is told can
leak it.

**What the host does.** It chooses what to ask and when to guess, by writing an ask or guess ruling
first in its reply, with the question or the guess inside it, then says the same words aloud. Its
brief teaches it to cut what is left in half each time, to use every earlier answer, never to repeat
or double up, to treat Sometimes as a fuzzy question to sharpen, to keep a shortlist, and to guess
when it is fairly sure. Rulings that break the rules are turned back with a note to the host: a
repeat, a question after the budget, a guess it already got wrong, text that can't be used. A host
that goes quiet is nudged three times, 25 seconds apart, and then the round is called off.

**Host lines.** Fixed by the brief: dry, warm, quick, one reaction then the next question, a hint of
reasoning and never a lecture, teasing the thing or itself and never a player. At the end it takes a
small bow if right and is gracious and impressed if wrong, and asks if they want another round.

**Awkward cases.** Two players: a tie is common and counts as Sometimes. One person leaves: their
taps go and the phase settles if everyone left has acted. Nobody answers: the question still costs
one and is recorded as no answer. A table that says the answer aloud during questions: phones are
muted until the final guess, so nobody can reach the host. A table that lies when it judges: nothing
in code can tell.

**Checked.** Unit tests cover the flow. The default check rehearses six paper-player styles at two,
four and five players: a quick win, a table that stumps the host, one that never taps, a host that
never acts, a player who leaves with a question open, and a careless host. The scenario in
`tools/scenarios/cold-read.ts` plays a whole round in a real room with four fake phones, against a
stand-in model (`tools/stub-host-model.ts`) that needs no key.

**Not yet.** The real host's questions and wording, its pace against the 12 second reply limit, a
table of real voices at the final guess, and how the tie rule feels have not been tried. The box
uses the hero painting until it has its own.
