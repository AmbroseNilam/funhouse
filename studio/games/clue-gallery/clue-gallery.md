# Clue Gallery: the experience script

Three to six people, about ten minutes, three rounds. Everyone holds a private hand of cards the
host has painted. Each round one player is the storyteller: they pick a card and give a clue, the
others put in a card from their own hand that fits it, the cards come up on the TV one at a time,
and everyone votes for the one they think was the storyteller's. It is built on the gallery kit
(`studio/kits/gallery.ts`).

## What decides, and what doesn't

Code deals the hands, keeps them private, runs every clock and does all the scoring. The host never
sees a hand, never knows which card is the storyteller's until the result, and is told each result
in words; it never works out a score. The only free text is the clue, which passes the room's
content filter before the game sees it, is tidied by the game, and never goes into a painting
prompt: every card is made from the game's own lists of subjects, settings and lights.

## What a phone shows, and why it is words

A phone cannot show a picture yet, so a hand is shown as words: "A copper kettle at the end of a long
pier". The painting of a card appears on the TV when it is played. That means a player picks by the
words and sees the painting only once it is on the table, which is a real loss: the game is at its
best when the hand is the pictures. The app change that fixes it is below.

## One round, line by line

1. **Start.** Host: three short sentences on how a round goes, then it stays quiet. The first
   storyteller is chosen at random and each player is storyteller once, up to three rounds.
2. **Clue.** TV: "{Name} is the storyteller. Choosing a card and a clue." with 75 seconds. The
   storyteller's phone lists their cards; they tap one, and a text box appears with "Give a clue for
   your card." and the line "Your card: ..." above it. Other phones say "{Name} is choosing a card and
   a clue."
3. **Play.** TV: the clue in large type, "Cards in 1 of 3", 45 seconds. Each other phone lists its own
   hand under "The clue is ... Which card fits it?". A player who doesn't choose is given their first
   card when the time is up.
4. **Vote.** The TV shows each played card in turn, six seconds each, titled Card A, Card B and so on,
   and keeps cycling until the vote closes, which is when everyone has voted or after 60 seconds. A
   card with no painting yet shows its words and "Still being painted", and the painting replaces them
   when it arrives. Phones list the cards by letter, never their own, and "Votes in 2 of 3" counts up.
5. **Result.** The TV turns over the storyteller's card and says how the clue did: "2 found it. Just
   right", "Everyone found it. Too easy, so the storyteller scores nothing", or "No one found it.
   Too strange, so the storyteller scores nothing". The host says the same in a sentence or two. Then
   the points table, with what each player gained this round.
6. **Again, then the end.** After three rounds the TV shows the final points and the host congratulates
   whoever is in front and asks about another game.

## Scoring

The storyteller scores 3 and each player who found their card scores 3, when some but not all found it.
When everyone finds it or no one does, each player but the storyteller scores 2 and the storyteller
scores nothing. Every player also scores 1 for each vote their own card got. The numbers are decisions
in the blueprint; the storyteller must always be worth more when the clue works than when it doesn't,
and the blueprint check refuses anything else. Nobody is ever removed from the game.

## The awkward cases

- **A storyteller who freezes.** After 75 seconds the round ends with no points and the next
  storyteller is up. The host says so in a few words.
- **Someone doesn't put a card in, or vote.** They are given their first card at the play clock, and
  a missing vote is simply not counted.
- **The storyteller leaves.** The round ends with no points. Anyone else leaving takes their vote
  with them. Below three players the game ends with the points so far.
- **Three players.** Works: two voters, so "just right" means exactly one of them found it.
- **Pictures are slow or never come.** The hands are painted in three waves four seconds apart, and each
  replacement card is asked for as the vote opens, so it has the vote and the result to arrive. If a
  card is still unpainted when it is shown, the TV shows its words. A game with no pictures at all
  still plays to the end.
- **A hostile clue.** The room's filter refuses it, and the phone says "That one won't work. Try
  another." The game also strips brackets, quotes and colons from any clue, and no clue ever reaches a
  prompt.
- **Cards that look like a person or carry lettering.** The painter is told not to draw faces or text.
  Whether it obeys is the image model's behaviour, which a cloud session can't check.

## What the host never knows

Which cards anyone holds, which card is the storyteller's before the result, and who put in which
card. It is told when each phase starts, the clue (quietly), and the result.

## What the app would need that doesn't exist yet

- An `image` control on the phone: a choice whose options are pictures. Then a hand would be the
  paintings, and the game would play the way it was meant to.
- A `gallery` block on the TV, so every played card could be on screen together during the vote
  instead of one at a time. Today the TV shows about one picture at a time.
- A higher per-room picture allowance. The room draws at most 40 pictures a room and 200 a day.
  A full table of six uses 30 of the room's 40 and a seventh of the day's.
