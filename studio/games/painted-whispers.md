# Painted Whispers: the experience script

Three to eight people, about eight minutes. One chain of lines and paintings goes round the table.
The first person writes a line, the host paints it, the next person sees only the painting and
describes it, the host paints that, and so on until everyone has written once. Then the whole chain
is shown on the TV and the host comments. It is built on the chain kit (`studio/kits/chain.ts`).

## What decides, and what doesn't

Code decides the order, the clocks, who sees what, the stock lines and the drift count. The host
paints through the room and comments at the end; it is never shown a line before the reveal, so it
cannot give one away. The painting is the only thing the next writer gets: not the words, not the
author. If a painting does not come, the next writer gets the words on the TV instead, and the host
says so in one short line.

## One chain, line by line

1. **Lobby.** The TV shelf shows the box. A player selects it and starts it. Host: "One of you
   writes something for me to paint. Everyone after only sees the painting." (Two short sentences,
   then it stays quiet.)
2. **Link 1.** TV: the game's name, "{Name} writes something for the host to paint", a progress
   mark and a countdown of 60 seconds. The writer's phone shows a text box; every other phone says
   "{Name} is writing. Watch the screen." The line goes through the room's content filter before the
   game sees it. A refused line leaves the box open with "That one won't work. Try another."
3. **Painting.** The TV says "Painting" with the writer's name and "The host is mixing the colours".
   The phones say "The host is painting. Watch the screen." The wait is capped at 45 seconds.
4. **Link 2.** TV: the painting, large, captioned "{Name} describes this", with a countdown. Only
   that person's phone has a text box. They write what they see.
5. **Round the table.** Links 3, 4 and on repeat step 3 and 4 until everyone has written once.
6. **Reveal.** The TV shows one thing at a time, six seconds each: "{Name} wrote" and the line, then
   the painting made from it, then "{Name} described" and the line, then the next painting. The host
   is told each beat quietly and says nothing.
7. **End.** TV: "It started as" and the first line, "It ended as" and the last. The host is told the
   whole chain and how many words survived, and gives three or four sentences: where it started, the
   turn that changed it most, where it ended, naming that writer kindly. Then it asks about another.

Host voice: plain, dry, warm, short. It never says "wrong", never mocks a line, and speaks to the
person, not about them.

## The awkward cases

- **Nobody writes.** After 60 seconds a stock line stands in for the writer and the chain goes on.
  A stock line reads like any other line in the reveal.
- **A painting is slow or never comes.** After 45 seconds the TV shows "The painting didn't come.
  This is what it was meant to show", and the line, and the next writer puts it in their own words.
  A painting that arrives late is kept and used in the reveal.
- **Someone leaves.** A writer who leaves is covered with a stock line. With fewer than two people
  left the chain stops and the reveal shows what exists. If nothing was written the host says so.
- **Three players.** Works: three links. Fewer than three can't start.
- **Eight players.** Eight links and eight paintings, about eight cents at the published price. Above
  eight the room's per-room picture limit would start to bite, so the kit refuses it.
- **A hostile line.** The room's filter refuses it before the game sees it, so it never reaches the
  TV, the host or the painter. The game also strips brackets, quotes and colons from any line before
  it goes into a prompt, and every prompt ends with the same no-faces, no-text rule.
- **A line that asks for faces or lettering.** The painter is told not to draw them whatever the
  line says. Whether it obeys is the image model's behaviour, which a cloud session can't check.

## What the host never knows

Before the reveal, the host is told only that a painting is being made. It is never told the text of
a link, the words of a stock line, or which line a painting came from.

## What the app would need that doesn't exist yet

- A `gallery` block for the TV, so the reveal could show the whole chain at once. Today the TV shows
  about one picture at a time, so the reveal is a sequence.
- An `image` control on the phone, so a writer could see the painting in their hand as well as on the
  TV, and so people at the back of a room could follow.
- A per-room or per-game picture allowance. The room draws at most 40 pictures a room and the day's
  budget is 200, so a full table of eight uses a fifth of the room's allowance and a twenty-fifth of
  the day's.
