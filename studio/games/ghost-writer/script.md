# Ghost Writer: experience script

Spot the bot on the bot kit. Three to eight players; about five minutes for three rounds. Written
for `DESIGN.md`. The host's lines are the register the brief asks for, not a transcript: the live
host writes its own words, and the rules never depend on them.

## One round, for four players (Teacup, Spoon, Candle, Saucer)

| Moment | The host says | The TV shows | A phone |
| --- | --- | --- | --- |
| Round opens | "Round one. The worst thing to hear from a hot air balloon pilot. Answer on your phones. One of the answers won't be a person's." | The prompt large, "Round 1 of 3", "Answers in" marks, a countdown | The prompt above a box |
| All in, or the clock ends | Nothing. The host is not told what anyone wrote. | "Shuffling the answers." | "Shuffling the answers." |
| Vote opens | "One: a gentle avalanche. Two: probably a goose, honestly. Three: my landlord's cat..." Every answer in one steady voice, no reaction. Then "Vote for the machine." | The numbered answers large, no names, a countdown | Buttons "1. a gentle avalanche" and so on, your own missing from your list |
| All voted, or the clock ends | "Guilty. Number two was me. Three of you saw it. Candle, nobody mistook you for a machine." | A table of every answer with its writer, or "the host", and the votes; the machine's row marked; "The room caught it" or "It got away with it" | "Look at the screen." |
| After the last round | "Spoon wins. You caught me in two of three. I'll be better next time. Another round?" | Final scores, and "The room caught the machine in 2 of 3 rounds." | "Look at the screen." |

## How the machine's answer is made

- **A separate request.** When the answers are in, code asks the host's model for one more, showing
  it up to four of the humans' real answers as a JSON list of data, and the prompt. The request is
  not part of the host's own conversation, so the host never has the machine's answer in its memory
  and cannot give it away by how it reads it.
- **Trimmed to the table.** Code, not the model, trims the result: one line, no quote marks, no
  closing full stop if most humans wrote none, a lower-case start if most humans did. A polished
  "Probably a goose." among lower-case fragments would be a tell.
- **Checked.** It must be clean under the same local check player text gets, no longer than about
  one and a half times the longest human answer, and not a copy (by spelling or by merge) of one.
- **A fallback of its own.** If the model is slow, fails or breaks a check, the game uses its own
  casual answer for that prompt, held to the same style rules. A prompt the model wrote has no answer
  of the game's own, since one written for a different prompt would give the machine away; if the
  model then fails, the round is called off ("The machine froze") with no points.
- **Placed by chance.** The options are shuffled with the machine's among them, and nothing in the
  scene or on a phone marks it.

## Scoring

100 for voting for the machine's answer. 50 for a human answer that nobody took for the machine,
which is "clearly human" and a quiet compliment. The room "caught" the machine in a round when more
votes went to its answer than to any other; the final scores say how many rounds that was.

## Voice design

- **Read everything the same.** The host reads each answer at one pace in one voice, number first,
  and does not react until the reveal. It does not know which answer is the machine's.
- **A good sport.** The brief tells it to own up dryly and never to mock anyone for sounding like a
  machine or for not spotting one. Praise at the reveal always goes to a human answer.
- **Interruptions and silence.** Phones are muted through the round. At the end the table can hold
  to talk. The clock, not the host, nudges slow answerers.

## Awkward cases

- **Three players.** Three human answers and the machine: four options; each voter sees three.
- **Two answers the same.** They merge into one option with both writers; neither may vote for it.
- **Fewer than two answers.** "Only one person answered", no machine this round, on to the next.
- **A hostile line.** The room refuses brackets, instructions to the host, personal details, hate,
  sexual content and anything the classifier refuses before the game sees it; the box stays open
  with "That one won't work. Try another." Brackets that slip past are refused by the kit too.
- **A player's answer tries to instruct the machine.** Answers reach the machine's request only as
  JSON data after the filter, and the machine's result is only ever shown as an option, never run.
- **Someone leaves.** The round waits only for those still here. Under three people the game ends.

## What the app would need that does not exist

- A real way to tell how good the decoy is. Nothing here measures it; a table playing is the test.
- The room tells the model its content is "suitable for all ages", so prompts and the machine's
  answers come out mild.
