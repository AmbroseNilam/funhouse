# Off by a Mile: experience script

Three to eight people, about eight minutes for five questions. The host's voice is plain, dry, warm and
short. The host never knows an answer before the reveal, so it cannot hint, lean or be lobbied.

## One question, four players

1. **Guess (muted, 45 s).** The TV shows the question large ("How tall is the Burj Khalifa in Dubai, in
   metres?"), "Answer in metres." and a row of cards that fill as guesses come in. The host: "Question three.
   The Burj Khalifa, in Dubai. How tall is it, in metres? Type your number." Each phone shows a paper card with a
   number box and "Answer in metres. Nobody sees your number until everyone is in." After sending, the phone says
   "Your guess is in. Waiting for the others." The host is never told the numbers yet.
2. **Bet (muted, 30 s).** When all four are in, or the clock ends, the guesses go up low to high without the
   answer. Host: "Priya says four hundred. Sam says six hundred and fifty. Marlowe says eight hundred. Jo says two
   thousand. Back the one you think is closest." Phones show a choice of the four names with their numbers. Backing
   yourself is allowed. A phone that has bet says who it backed and waits.
3. **Reveal (14 s).** Code finds the closest and scores it. TV: "828 metres" with the guesses, closest first, with
   how far off each was, the closest highlighted, who backed them, the second true thing, and the scores. Host:
   "Eight hundred and twenty-eight. Marlowe was closest, by twenty-eight. Priya and Jo read the room. Sam didn't.
   It opened in 2010." A phone shows "You won 2 points. That's 6 now."
4. **The end.** After five questions the TV shows the scores with the winner highlighted. Host: "Priya wins on
   eleven. Sam's two-thousand guess on the second question decided nothing, and was brave. Another game?"

## Scoring, all in code

- The closest guess wins 3. A tie shares it, and everyone tied gets 3.
- Backing a closest guess wins 2. Backing it when fewer than a third of the bets went to that guess wins 1 more.
- A player who guessed nothing can still bet but cannot be backed. Fewer than two guesses voids the round: the answer is shown,
  nobody scores, and the game goes on.
- A player leaving takes their guess and every bet on them with them, and those bettors may bet again.

## Facts

Every answer is one the author is sure of, with where it comes from written on the question in
`questions.ts`. Figures that can be beaten or re-measured say which measurement: Everest is the 2020 China and
Nepal figure. The host writes nothing that needs to be true: it phrases, reads and narrates, and the true second
fact comes from the question's `aside`. The host is told the answer only when the round is revealed.

## Voice design

- Guessing and betting are muted on purpose: the point is typing a number, and a hold-to-talk host in the middle
  would be asked for hints. The reveal is muted too, so the host finishes its three sentences.
- If the host is slow, the TV shows everything the host would say, so the game never waits on speech.
- Silence is handled by the clocks, not the host.

## Awkward cases

- **Three players.** The minimum. With three, a bold bonus needs a bet nobody else made, which happens often.
- **Eight players.** The bet choice is a list of eight names with numbers; it scrolls on a phone.
- **A guess equal to the answer.** Wins outright, and is not a leak because the number is on screen on purpose.
- **Someone types a decimal.** The phone's number box takes whole numbers only, which is fine for these questions.
  A question that needs decimals needs a core change to the phone's number box.
- **Everyone guesses the same number.** All are closest; every backer is right; nobody is bold.

## What the app would need

- The phone's number box uses a numeric keyboard with no decimal point. A game asking for decimals cannot yet.
- A control that lets a player see everyone's guess while betting, other than reading the TV, would make the
  choice list shorter. The choice labels carry the numbers for now.
