# Under the Cup

_A hidden-dice bluffing game for three to eight people. Blueprint: `under-the-cup.ts`. Kit:
`studio/kits/tap-dice.ts` on the shared tap parts in `studio/kits/tap.ts`, with the pure rules in
`studio/kits/tap-dice-rules.ts`. Catalog entry 21, bid and challenge._

**The round.** Every player rolls three dice. They show only on that player's own phone, on a card that
stays face down until it is pressed and held. The TV shows how many dice are on the table and who has
how many, never a die. Going round the table, each player either raises the bid or challenges it. A bid
is a count and a face, such as *five fours*, about every die in every cup. With ones wild, a one counts
as any face except in a bid on ones. A raise means more dice, or the same number of a higher face.

**A challenge.** The cups stay down for five seconds while the host builds the moment, then the TV shows
every hand, the count, and who loses a die. If the bid was true or exact, the challenger loses the die;
if it was false, the bidder does. A challenger who meets a bid that was exactly right loses two. Whoever
lost opens the next round, or the next seat with dice if they are out. The last player with dice wins.
After twelve challenges the game ends and whoever has the most dice wins, ties shared.

**How it differs.** Nobody guesses a word, nobody votes and nobody taps at the same time as the others.
One person is up at a time, the information is private and uneven, and the whole game is reading a bid
against what you hold and what you can see in the faces. Twenty Doors and Leading Questions are about a
word the host holds and spoken questions. Who Fits is simultaneous and secret. Here the only secret
is a cup, and the only public thing is a claim about it.

**What code decides.** Everything. Code rolls every die, orders the bids, offers only legal ones, counts
the cups with ones wild, takes the die, drops players with none, passes the turn, runs the clocks and
ends the game. The host makes no rulings. If a player leaves with dice in play, the round is void and
every die is rolled again, with nobody losing one. If a player's thirty seconds run out, the clock opens a
modest bid for them if nothing stands, and otherwise makes the challenge for them. That keeps one slow
phone from stopping the table.

**What the host knows.** Before the cups are lifted, only what is public: the dice count per player, the
standing bid, and how likely that bid is from the number of dice alone (worked out in code from the
number of dice, which carries no information about any cup). After the lift it is told every die. The host
brief says so, and says what to do about it: never guess, hint or ask.

**What the host does.** Say the round in one line, stay out of the way of the table's own talk while
they bid, speak up on a bold bid (one at or under 15 in 100 on the dice count alone, or the clock acting),
build the moment during the lift, play the reveal out loud with the count, name who loses a die, and
close with the winner. The brief bars remarks on looks, money, age or love life, and teases the bid, not
the person. Lines to aim for, as manner and not script: *Seven fours on twelve dice. Bold. Or lying.* /
*Candle has called it. Hands off the cups.* / *Count with me. A four, another four, a wild one. Three.
The bid holds, and Candle pays for doubting it.*

**Phones.** One face-down card, then up to two groups of buttons. When it is a player's turn, Challenge
comes first, in its own card so a thumb that wants a number doesn't hit it, and below it how many dice,
five at a time with More and Fewer for the rest, then which face. Back undoes a chosen number. The card
that says what stands is folded into the prompt ("Teacup bid one two. Raise to how many?") to keep the
buttons in view. A player who is out sees "You're out. Watch the cups." and no dice.

**TV.** At eight players with a long name, every screen ends above the lantern. At six or more, hands share
a line. During bidding the TV shows the standing bid large, whose turn it is, the earlier bids, the dice
left and a clock.

**Awkward cases.** Three players: it works, but a challenge is a coin flip against two cups. Eight:
twenty-four dice and a table that is mostly out of the conversation for a minute at a time; the twelve
challenge cap and the exact-bid penalty are there to keep it to about twenty minutes. Someone leaving
mid-round: the round is rerolled. Someone idle: the clock bids or calls for them. A player who is out:
they watch, and cannot see any die. Two people holding the same dice: nothing is shown that could tell
them apart. A player peeking while someone looks over their shoulder: that is the game.

**Checked.** Unit tests cover the rules, the flow, each ending and leaving. The default check runs six
paper-player styles with the model failing and succeeding, at three, four and five players. A secrecy
check deals one player different dice in each game and requires the TV, the host's brief and every other
phone to stay identical through the bids and the challenge. It catches a TV, a host fact and a phone that
show a die. The scenario plays real rounds with four phones against the real room.

**Not yet.** The host's own lines at a real table. The game has been played only by scripts. The box uses
the hero painting until it has its own, and the quantity paging and the face-down card have not been
felt on a real phone. See `docs/wave-reports/studio-dice.md`.
