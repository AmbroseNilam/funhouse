# The Blank Truth: experience script

Bluff trivia on the bluff kit. Three to eight players; about six minutes for three rounds. Written
for `DESIGN.md`. The host's lines are the register the brief asks for, not a transcript: the live
host writes its own words, and the rules never depend on them.

## One round, for four players (Teacup, Spoon, Candle, Saucer)

| Moment | The host says | The TV shows | A phone |
| --- | --- | --- | --- |
| Round opens | "Round one. The tallest animal on land is the blank. Write me a fake." (It does not know the answer yet.) | The statement with its blank, "Round 1 of 3", "Fakes in" marks, a countdown | The statement above a box: "A believable fake" |
| A fake that is the truth | Nothing. | unchanged | The box reopens with "That one is too close to the real answer, or didn't take. Try another." After three tries the writer sits the round out |
| All in, or the clock ends | Nothing. | "Shuffling the answers." | "Shuffling the answers." |
| Options open | "One: long-necked sheep. Two: giraffe. Three: a tall pony. Pick." Every option read in one steady voice, nothing said about any of them | The numbered options large, no names, a countdown | Buttons "1. long-necked sheep" and so on. Your own fake is missing from your list |
| All picked, or the clock ends | "Giraffe, of course. Spoon got it. Teacup's camelopard fooled nobody, but it was a fine word." | The statement filled in, a table of who picked what with the truth marked | "Look at the screen." |
| After the last round | "Candle wins. Best fake of the night: Saucer's long-necked sheep, which fooled three of you. Another round?" | Final scores | "Look at the screen." |

## Where the facts come from, and how far to trust them

- The host's model writes the facts at the start, one per line as "statement with a blank | answer".
  The kit refuses a line without exactly one blank, with an answer of more than four words, with
  brackets, with a rude word, or with the answer sitting in the statement.
- A second request then asks the model to confirm each fact is well established and has one
  answer. Only facts confirmed "ok" are used; a fact that is wrong, not mentioned, or any reply
  that can't be read sends the game to its own bank of eleven checked facts. If the model is down,
  the whole game plays from the bank.
- That second look is the model grading its own work. It lowers the chance of a wrong "truth" and
  does not remove it. See the wave report.

## Merging answers that mean the same

1. By spelling, in code: case, punctuation, "the" and "a", plurals and past endings, number words
   ("forty" and "40") and a single typing slip all merge. "round 1" and "round 2" never do.
2. By meaning, by the model: the true answer and the distinct fakes go to the model as a JSON list
   of data, and it names groups that mean the same. Two fakes it groups become one option with both
   writers credited. A fake it groups with the truth is dropped from the options, and its writer
   scores as if they had picked the truth, because they wrote it.
3. The model has a few seconds. If it fails, says nonsense, or is late, the game goes on with the
   spelling merge alone.

## Voice design

- **Read everything the same.** The host is told the numbered options in curly quotes and to read
  them in one voice at one pace with no reaction, so tone gives nothing away. It does not know which
  is true until the reveal, and it is never told the answer before then: the true answer is not in
  any fact, brief or scene until the options open, and then only as one option among the rest.
- **Tease the fake, never the person.** Being fooled is the game. Credit goes to the fake that
  fooled the most, by its writer's name.
- **Interruptions and silence.** Phones are muted through the round, so nobody talks over the
  reading. At the end the table can hold to talk. The clock, not the host, nudges the slow.

## Awkward cases

- **Three players.** The truth and up to three fakes: four options, and each player sees three.
- **Everyone writes the same fake.** It is one option with every writer on it, nobody has a real
  choice, and the round goes straight to the reveal with no points.
- **One fake only.** Two options, truth and the fake; its writer has nothing to pick and sits out.
- **Nobody writes.** "Nobody wrote a fake", the answer told kindly, on to the next round.
- **The truth typed as a fake.** Turned away privately. That tells the writer they had it, as the
  boxed version of this game does. Three turned-away tries and the writer sits the round out
  without holding anyone up.
- **A hostile line.** The room refuses brackets, instructions to the host, personal details, hate,
  sexual content and anything the classifier refuses, before the game sees it; the box stays open
  with "That one won't work. Try another." Brackets that slip past are refused by the kit too.
- **Someone leaves.** The round waits only for those still here. Under three people the game ends
  with the scores so far.

## What the app would need that does not exist

- A way to let a source be checked against the web, so a fact has a citation. Today the only
  safeguard against a wrong "truth" is the model's second look and the bank.
- The room tells the model its content is "suitable for all ages", so facts come out mild.
- A caption or voice that keeps the blank: underscores are stripped from what the host says, so it
  is told to say "blank" aloud.
