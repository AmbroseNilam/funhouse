# Same Page: experience script

Match-the-crowd on the match kit. Three to eight players; eight prompts, 30 seconds to type, 10 seconds
to look; about six minutes. Written for `DESIGN.md`: the host is a plain, dry, warm lantern; the TV is a
table with paper cards on it; the phone is what is in your hand. The host's lines below are the register
the brief asks for, not a transcript: the live host writes its own words, and the rules, the stacks, the
scores and the hat are code.

## One round, for four players (Teacup, Spoon, Candle, Saucer)

| Moment | The host says | The TV shows | A phone |
| --- | --- | --- | --- |
| Prompt opens | "Something you always lose. Thirty seconds. Match the room." | The prompt large, "Prompt 1 of 8", "Type what you think the room will say", cards-in marks, a countdown | The prompt above a box and "what will the room say" |
| A player sends | Nothing. The host is not told and cannot hint. | One more mark filled | "Your card is in." The card is never shown back, even to its author. |
| All in, or the clock ends | Nothing; "Stacking the cards." holds for a moment (a few seconds at most). | The prompt and "Stacking the cards." | "The cards are being stacked." |
| Cards turn | "Keys, three of you. And one lone potato. I respect it." | One paper card per stack, biggest first: "keys, stack of 3", "potato, alone, wears the hat" (wine card). Points table. Ten seconds. | "You scored 2." or "No match this round." The hat's holder also reads "You have the hat." |
| Next prompt | The next prompt, one short sentence. | Back to the prompt screen. | A fresh box. |
| After the eighth | "Teacup takes it. The hat ended with Candle, which cost two. Another game?" | Final scores, leaders marked; the hat line if it applied | "That's the game." |

## What code decides and what the host does

- **Prompts.** The kit holds eight fixed stems: six general ("a thing you would never share") and two
  about the room ("a thing someone here would bring to a desert island"). The host's model writes one
  prompt per stem as a content request. Each line has to pass the same local check the host's own
  output gets, be short and not repeat another; anything else is replaced from a bank of 24 in code
  (18 general, 6 room) by kind. If the model never answers, a 20 second timer starts with the bank.
- **Cards.** The room's content filter runs before a card reaches the game, and the kit applies the
  host-safe check again. A refused card keeps the box open with a note and costs nothing.
- **Stacks.** Three steps, each able only to add merges, and silence meaning separate:
  1. A local check: case, accents, punctuation, plurals, common endings, British and American
     spellings, one slipped letter in a long word. "Pizza", "pizzas" and "PIZZA!" stack.
  2. The room's answer-merging seam (Jev, 800 ms), asked about the stack stand-ins plus a sign-of-life
     pair of made-up words. If the seam merges the made-up pair it is alive and its "no" is final.
  3. Only if the seam showed no sign of life: one closed question to the host's model, for at most four
     pairs that look alike (they share a word, or one sits whole inside the other), "are these the same
     thing", with the reply read strictly and anything but a clear "yes" meaning separate. Five
     seconds, then cards are stacked as they are.
- **Scoring.** One point for every other card in your stack; a stack of exactly two scores two each;
  a lone card scores nothing.
- **The hat.** The lone card takes the hat, but only when it is the only one that round. Two lone
  cards tie, and a tie goes to nobody: the hat stays where it was. Whoever holds it after the last
  prompt loses two. A round with fewer than two cards moves nothing. No hat at three players.
- **The host.** Told the stacks and the lone cards by their words, never by who wrote them. It says
  one line about the odd answer and never about the person, never a score, never a name beside a card.
  It names the hat's holder once, at the end, in a kind word.

## Ambiguous words, decided

- The same word typed twice is one answer, whichever sense each player meant. "bat" and "bat" stack
  even if one meant the animal. The TV shows the word, and the table can laugh.
- A word beside a longer phrase ("bat" and "baseball bat") is a doubt, not a match: it goes to the
  seam, then the closed question, and stays apart if neither says yes. With no model at all they are
  separate.
- Near-misses never merge locally: bat/bait, bat/bag, bat/bar, tea/team, sun/son, ice/rice,
  ham/hamster, pen/pencil, mist/mint. Synonyms ("couch", "sofa") only merge if the seam says so.
- Nothing chains: "moon", "moonlight" and "light" stay three cards.

## Voice design

- **The joke is on the answer.** The brief says so and never gives the host a name beside a card.
- **Short.** Two sentences, three at most, and no exclamation marks.
- **Interruptions.** Phones are muted from the prompt to the reveal, so nobody talks over the host.
  Only at the end can the table hold to talk ("again", "another game").
- **Silence.** During writing the countdown on the TV does the nudging. The host cannot speak up
  unprompted today; a nudge at ten seconds would need a core change and is not needed to play.

## Awkward cases

- **Three players.** No hat. Matches still score; a pair scores two each. It works, but four is better.
- **Eight players.** Up to eight stacks on the board, four to a row; the reveal stays ten seconds, so
  the host reads only the biggest stack and one odd answer.
- **Someone silent.** The others get a full reveal at the clock; the silent player has no card, scores
  nothing and cannot take the hat.
- **Everyone silent.** "No cards this round", nothing moves.
- **Someone leaves.** Their card goes with them, their hat is let go, the round carries on with the rest.
  Below three players the game ends with the scores so far.
- **Everyone matches.** One stack; no lone card; the hat does not move. The host says the table is
  of one mind.
- **A wrong merge.** The only failure that matters. The stacks are on the TV for ten seconds and the
  room can laugh at one; there is no appeal, and the model can only add merges, never score.
- **A hostile line.** Refused by the room's filter with the box left open; refused again by the kit if
  it carries brackets. It reaches no phone, the TV or the host.
