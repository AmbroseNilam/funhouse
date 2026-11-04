# Who Fits

_A tap game for three to eight people. Blueprint: `who-fits.ts`. Kit: `studio/kits/tap-fits.ts`
on the shared tap parts in `studio/kits/tap.ts`._

**The round.** The TV shows a prompt, such as *Would stay calmest in a power cut*, with a clock.
Every phone shows buttons with everyone else's names. Each person taps the one it fits best, once.
When everyone has tapped, or the clock runs out, the TV shows only the counts: *Spoon 3, Candle 1*.
The host reads each prompt and says one or two kind words at the reveal. After the last prompt the
TV shows the totals over the game.

**How it differs.** Nobody is hidden and nothing is guessed. Every player acts at once, in secret,
and the only output is a count. Twenty Doors and Leading Questions are about one secret word and
spoken questions. Here there is no speech the game listens to and no ruling at all.

**What code decides.** Code decides the prompts used (the model's, topped up from an original
fallback bank), who may tap whom (never yourself, once a round), when a round ends, the counts, the
totals, and what happens when someone leaves. When someone leaves, their taps and the taps for them
are dropped, and anyone whose tap was dropped taps again.

**What the host does.** The host reads, comments and encourages. It is never told who tapped whom.
Its brief says to make the people with the most taps look good, tease the prompt and not the
person, and never make one person the joke. The brief also bars remarks about looks, money, age or
love life.

**Checked.** Unit tests cover the flow. The default check runs four paper-player styles with the
model failing and succeeding, at three and five players. A secrecy check plays the same taps with
one player's tap changed and requires every other view, the host's included, to stay the same. A
planted TV that shows the taps is caught. The scenario plays a whole game with four phones.

**Not yet.** The host's own lines at a real table, the reveal timing with real speech, and the
prompts the model writes have not been tried. The box uses the hero painting until it has its own.
