# Mind the Gap: experience script

Two to eight people, about seven minutes for six cards. Events and inventions, none of them music. The host's
voice is plain, dry, warm and short. The host never knows a card's year before the reveal, so it cannot hint.

## One card, three players

1. **Place (muted, 40 s).** The row on the table starts with two cards, earliest first, years showing. The TV
   shows the new card's name large ("The telephone is patented"), the row as a list with years, "Where does it go?
   Pick a gap on your phone." and cards that fill as picks come in. The host, in the first round only, reads the
   row: "On the table: the Great Fire of London, 1666, and the first Moon landing, 1969. The new card is the
   telephone. Pick a gap." Each phone shows a paper card with the choices: "Before the Great Fire of London (1666)",
   "Between the Great Fire of London (1666) and the first Moon landing (1969)", "After the first Moon landing
   (1969)". After a pick the phone says "You put it between the Great Fire of London (1666) and the first Moon
   landing (1969). Waiting for the others." A pick cannot be changed.
2. **Reveal (12 s).** When all have picked, or the clock ends, code places the card in the row by its year, scores
   the picks (right gap 2, a gap next to it 1) and shows the year. TV: "It was 1876", the row with the new card
   highlighted, "Right gap: Priya, Sam." and the scores. The host, who is told the year only now: "Eighteen
   seventy-six. Priya and Sam had it. Marlowe was a gap out." A phone: "Right gap. 2 points, You're on 6."
3. **A surprising card.** If the card is one of the five marked surprising, the host is told why in one plain
   sentence and the TV shows it too. Fax machine, 1843: "The fax machine was patented thirty-three years before the
   telephone." The host says it in its own words in one more sentence.
4. **The row grows.** The revealed card joins the row at its true place, so the next round has one more gap. After
   six cards the TV shows the scores with the winner highlighted and the finished row, and the host names the oddest
   neighbours: "Sliced bread sits next to the Titanic, which is closer than it feels." Then: another game?

## Facts

Each year is one the author is sure of, with where it comes from written on the card in `cards.ts`. Dates that
historians place a little differently say which one they use (Tenochtitlan is the traditional founding date;
Oxford is the year teaching is first known there). A card never carries a digit in its name, so it can't give its
year away, and the claims in the surprising cards are checked against the years in the bank by a test. No two cards
in one game share a year; the deal skips one of any pair that does.

## Why the host can't hint

- It is never told the new card's year until it is placed. If asked, its brief says to say it will find out with
  everyone. It does not know where the card goes.
- Picks are private until the reveal. The host is not told who picked what until the card is placed.

## Voice design

Place and reveal are muted on purpose: the point is a quiet pick on the phone, then a reveal without argument.
The end of the game is open for "another game?". If the host is slow, the TV shows all the information, so the
game never waits on speech.

## Awkward cases

- **Two players.** Works; it is a duel on each card.
- **Eight players.** Eight picks of nine gaps by the end. The phone list scrolls.
- **Nobody picks.** The clock ends the round; the card is placed and nobody scores.
- **Someone leaves.** Their pick goes, and the round reveals early if everyone left has picked.
- **Everyone picks the same gap.** All score or none do.
- **A card with the same year as another.** Skipped when the game is dealt.

## What the app would need

- The TV has no card-and-row scene block. The row is a list with years, which is clear and plain but not a table
  of cards. A row block that lays cards out left to right would show the order better.
- The phone shows the gap choices as a list of long labels. A control that lets a player drag a card into the row
  would be better; it is a core change.
