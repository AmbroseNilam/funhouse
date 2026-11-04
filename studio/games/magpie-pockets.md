# Magpie Pockets

_A push-your-luck tap game for three to eight people. Blueprint: `magpie-pockets.ts`. Kit: the `push`
style in `studio/kits/tap-push.ts`, on the shared tap parts in `studio/kits/tap.ts`._

**The round.** Everyone starts with the same free card in their pocket. Then, beat after beat, every
phone secretly offers two buttons: draw a card, or stay and bank the pocket. When all have chosen, or
ten seconds pass, one card is flipped for everyone who drew. If it is a trinket you already hold,
your pocket busts and scores nothing. If not, it joins the pocket. Anyone who stayed banked the
pocket and is out until the next round. The round ends when nobody is still in. After a round, the
first to bank 30 wins (the highest, if two cross in the same round; a tie is shared). After eight
rounds the highest wins whatever the score.

**How it differs.** Nothing is guessed, voted on or nominated, and no speech is judged. It is one
shared deck and a private risk: the same flip is safe for you and a bust for the person beside you,
so the tension is in other people's pockets, which the TV shows. Twenty Doors and Leading Questions
are about a secret word; Who Fits taps for people. Here the tap is a bet.

**What code decides.** Everything. The deck (ten original trinkets, three of each, shuffled fresh
every round from a seed in rehearsal), the free first card, who chose, a missing choice at the clock
counts as stay, busts, banks, rounds, the win and the tie. The host decides nothing and makes no
rulings.

**What the host does.** Each beat it is handed a fact: the card, who banked, who busted, who is
still choosing, and for each group of equal pockets the points and the percent chance the next card
is a repeat, all worked out in code, plus one fallback line to riff on. The brief says: dry, quick,
delighted by greed, build suspense in one or two short sentences, tease the pocket and never the
person. It never knows a choice before the flip. At the start of a game the model is asked for twelve
extra tension lines (checked: usable length, no brackets, no shouting); sixteen original fallbacks
top up.

**What people see.** The TV shows one chip per player with their pocket and its worth, a line
naming the leader and the target, and the clock; after a flip, the flipped card as the title and
each chip updated; at the end of a round, the banked scoreboard. The phone shows a paper card with
the pocket and "2 of the 29 cards left would bust you", and two buttons; after choosing, "Locked in";
after a bust or a bank, a card saying so.

**Three players** is the floor: with two the table is too small to read. **More than eight** is not
offered. **Someone leaves:** their pocket goes, and the beat settles at once if the rest have chosen.
**Nobody answers:** each clock settles the beat as stays, so the game can never stall.

**Checked.** Thirteen unit tests; the default check runs six paper-player styles (all stay, all
draw, mixed nerve, one who never chooses, one who leaves, a table that never chooses) over five seeds
at three and five players, with the model failing and succeeding; a secrecy check plays the same
script with one player's choice reversed and requires the TV, the host and every other phone to be
identical before the flip; planted leaks (a TV that shows the choices, a screen that names the next
card) are caught. The scenario `tools/scenarios/magpie-pockets.ts` plays whole games with four fake
phones against a text-only room.

**Not yet.** The host's own lines at a real table, the pace with real thinking, and the model's
tension lines have not been tried. The box uses the hero painting until it has its own. Names and
card text are original but have not been checked against a trademark register.
