# Tin Can Telephone: the experience script

Two teams, Plum and Teal, three to ten people, about fifteen minutes. A shared board of twenty-five
words on the TV. One giver per team holds the key on their phone: nine words for whoever moves first,
eight for the other side, seven bystanders and one trapdoor. The giver says one word and a number; the
team taps words on their phones. Find all of yours first. Turn over the trapdoor and you lose at once.

Mechanic it does not share with the other games: two teams racing over one board, an asymmetric hidden
key held by two roles, a clue checked by code before the host rules, and a host that can stand in for
a side's giver.

## One round, as it plays

- The host writes the board (a content request; if it fails or gives fewer than 25 usable words, the
  game uses its own ordinary words). The TV shows the board, plain paper cards. The two givers' phones
  show "The key" on a peek card (press and hold to read it). Everyone else's phone says which team they
  are on.
- Host: "One word and a number per turn. Tap the wrong one and your turn ends. Tap the trapdoor and
  the game does. Plum goes first." Two short sentences, then it stops.
- Giver, holding to talk: "Harbour, two." Or types "harbour 2". Code refuses a clue that is a board
  word, part of one or shares its start; the host rules fair or foul on the rest (spelling, rhyming,
  sounding like, pointing at a position). A foul gives the giver a fresh box; the second foul passes the
  turn. If the host never rules, the clue counts as fair after eight seconds.
- Host, in one line, as the giver's mouthpiece: "Harbour, two." The TV shows the clue, the counts and a
  clock. The team's guessers get the unturned words as buttons; the first tap from any of them turns a
  card, so they agree out loud first.
- Own word: the card turns the team's colour and its name, and the turn goes on, up to number plus one
  guesses. Bystander or the other side's word: the card turns, the turn ends, and the host says so in
  one line. Trapdoor: "Anchor was the trapdoor. Teal wins." The host gets a little drama and two
  sentences at most.
- The game ends when a team has turned over all its words (the other side's last word counts for them
  too), on the trapdoor, or after twenty-four turns, when the team with fewer words left wins.
  The TV shows the whole key with each word's owner printed on the card, so it never relies on colour.

## What the host is told, and never told

Told: the words still on the board, the clue being judged, who gives it. Never told: the key. When the
host voices a side's giver (three players, or the lobby choice "Host gives the second team's clues", or a
giver walking out), the key for that turn goes in a content request to the model, never into the host's
brief, a caption or any phone; the model's reply is checked by code like any clue, asked again once if it
breaks a rule, and the turn passes if it breaks it twice.

The host's lines stay short and dry. Examples the brief steers toward: "Harbour, two." "Bystander. That's
your turn." "Teal got there first." After a foul, a few words on why and never on what is whose.

## Awkward cases

- Three players: one side has one person, so the host gives that side's clues and that person guesses.
- Ten players: five a side, one giver and four guessers; guessers settle it out loud, first tap wins.
- A giver mumbles: "That wasn't one word and a number," no foul. A typed box that is not understood
  gets a fresh box with a note, since the room accepts each box once.
- A giver leaves: the host takes over their side's clues. A team with nobody left to guess forfeits.
- A guesser taps a card while another is about to: first tap wins; there is no undo, by design.
- The model is slow or fails: the board falls back to the game's own words; a voiced clue passes the
  turn rather than inventing one.

## What the app would need that does not exist yet

- A real board control on phones: guessers see a list of buttons, not the grid. Core change, written up
  in the wave report.
- The host cannot hear the table argue, so it cannot say "Teal is split"; guessers tap when they agree.
