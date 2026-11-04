# Name Tag

_A who-am-I game for three to eight people. Blueprint: `name-tag.ts`. Kit: `studio/kits/identity.ts`._

**The round.** At the start the host's model writes a fresh list of well-known names, a person, a
creature or a thing each (a fallback bank of 26 stands in if it fails). Code deals one to every
player. Everyone sees everyone's name tag on their phone except their own. After a short intro, the
players take turns, in seat order, being on the spot: the TV shows *Spoon, who are you?* with a
clock and a question counter. The player on the spot holds to talk and asks the room yes-or-no
questions. The room answers out loud, across the table. They have 75 seconds and 12 questions.
Halfway through the clock their phone gives a hint: *you are a creature*. When they say their own
name, in any sentence, the turn is solved; otherwise the turn ends when the clock or the questions
run out, or they press *Pass this turn*. Then the TV shows the name tag for a few seconds, with the
points, and the next turn starts. After the last turn the TV shows the totals and who everyone was.

**Scoring.** Finding out who you are scores 5, minus one for every three questions it took, never
under 1. Anyone who doesn't find out still gets 1, a point for the story, so nobody ends the game on
nothing. The host says who was quickest and is kind about whoever took longest.

**How it differs.** Twenty Doors and Leading Questions have one secret that one person asks about.
Here every player is a secret to themselves and an open book to everyone else, so the information
asymmetry runs the other way round from every other game on the shelf: the room knows, the asker
doesn't, and the host knows nothing.

**What code decides.** Code deals the tags, takes the order, spends the questions, runs both clocks
and decides whether a guess is right. The guess is judged from the real name, not by the host: whole
words and runs of words in the transcript, ignoring case and punctuation, with the surname of a
person counting and one wrong letter forgiven on names of seven letters or more (two on twelve or
more), because a transcript is never perfect. A short name like *Moon* has to match exactly. Only the
player on the spot is heard; everyone else's phone is muted for the turn, so a blurt at the table
never reaches the TV's captions or the host.

**What the host does.** It is never told a name tag until the turn ends and the tag is revealed, so
it cannot give one away, even by accident, and it makes no rulings at all. It says who is up, says
when three questions are left, and says what happened when a turn ends. Its brief tells it to tease
the name tag and never the person, and to be kind to anyone who is stuck.

**Edge cases.** *Three players:* playable, with two people to answer; fewer than three after
someone leaves ends the game. *More than eight:* the box caps at eight, since a crowd turns the
answering into noise. *The player on the spot leaves:* their turn ends and the next starts. *A
waiting player leaves:* they lose their turn and the count on the TV drops. *Someone says a name
tag out of turn:* it counts for nothing, and only goes to the room, since the TV captions only the
player on the spot. *Mumbling:* one word is free; a real question needs two. *A model name that
matches a player's name* (a player called Penguin and a Penguin tag) is skipped.

**Checked.** Unit tests cover the flow. The default check runs six paper-player styles, five seeds
each, with the model failing and succeeding, at three and five players. Its leak check requires that
no one's unrevealed tag reaches the TV, the host's brief and facts, or that player's own phone, on
every step; it plants a leak to each and the check catches all three. A role check plays the same
script with the tags dealt differently and requires the TV and host views to stay identical. The
scenario `tools/scenarios/name-tag.ts` plays a whole game with four phones.

**Not yet.** The host's own lines and timing at a real table; whether real speech recognition
spells the names well enough (the misspelling forgiveness is a guess); whether the model's list is
as gentle as its request, since the deny-list is a backstop and not a judgement; the box art, which
uses the hero painting; and a playtest.
