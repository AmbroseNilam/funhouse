# Design direction

_Binding for everyone working on the product. If something here is wrong, change it here first,
then build._

## The one idea

**Game night at a long table, lit by one lantern, and the lantern is your host.**

The TV is the table. The phone is what's in your hand. Everything on the TV is painted paper and
card under warm lamplight. Games are boxes on a shelf. The host is a small brass lantern with a face
behind the glass: it wakes when the sound comes on, leans toward what you look at, and its mouth
moves with its voice. When a decision is unclear, ask what would be true at that table.

Product and host names live only in `shared/brand.ts`.

## Rules of the world

- **One typeface:** Fraunces, everywhere, TV and phone. Character comes from its soft, wonky shapes.
- **One material:** matte painted paper and card. No glass, glow, neon, gradients on UI, or blur.
- **Colour:** ink `#17110c` (the room), card `#2a1f16`, paper `#efe3c8`, lamp `#e8a33d`,
  wine `#8c2f2f`. Lamp means "this is live or chosen" and nothing else. Seats get their own colours.
- **Depth comes from stacking and offset hard shadows, as with real card on a table.**
- **Art:** Muse Image paintings only, one style: warm painted storybook, no faces, no text, no
  logos, no named artists or brands. Never re-encode in a way that strips provenance data, so icons
  and share images are drawn in code instead. Credit in one place only: Credits in the phone menu,
  the README and the submission. Never present it as human-made.
- **Copy:** on the TV and phone, the host's voice: plain, dry, warm, short. The landing page is plain
  description in the third person, and the host speaks only in its game demos. No jokes there, and no
  slogans except the main heading, and no "not X, but Y" or "No X. Just Y" anywhere. No "Welcome to", no exclamation
  marks on UI, no "Click here", no emoji. Sentence case. A person writing a note for a friend.

## Banned, because they read as AI defaults

Inter or system fonts; purple or blue gradients; glowing orbs; pills; even grids of identical
rounded cards; left-stripe callouts; blurred panels; drop shadows with large soft radii; emoji as
icons; generic SaaS copy; fades as the only motion; centred hero plus three feature cards.

## The controller

The phone is one full-screen touch surface, designed so nobody has to look down.

- **Gestures (starting values, tune on a real iPhone):** direction locks at 10pt. First step at
  30pt, then one per 70pt, and reversing steps back. No wrap. Tap: release under 300ms and under
  10pt. Hold: 300ms still, then movement is ignored while talking.
- **Tap on the pad never locks the mic.** Tap on the pad always means select. A separate Talk button is
  the default way to talk, a small chip labelled "Tap to talk": it starts recording and Stop ends it, and holding still works. It shows a live
  scrolling waveform, live words and a small Stop, and stops itself on silence, at a time limit, or when
  the page is hidden. It waits while the host speaks. A phone can choose Tap or Hold in its settings, kept
  in that browser, and `?tap=0` or `?hold=1` opens a room with holding only.
- **Pre-roll:** the mic opens on the first talk of a session, so nobody who taps or types is ever asked, then stays open and keeps the last 320ms. Nothing is sent until someone talks. On hold, send that first, so
  first words survive. Send 300ms more after release.
- **Corners:** back top-left and phone menu top-right, 60pt. Touches starting there never swipe.
  Back goes to the parent; in a game it pauses.
- **Browser leaks are bugs:** `touch-action: none`, fixed root, no callout or selection, non-passive
  touchmove block, swipe-back blocked in 20px edges. Installing to the home screen is optional:
  a quiet offer sits on the landing page, in the phone menu, and once after a game, and a "not now" is remembered. Never during a game or on the way into one. The QR link must always work in the browser, and the app opens to a code screen.
- **Vibration is a bonus only.** iPhones can't be relied on. Feedback comes from the TV.
- **Slow choices may look down.** Secret roles and votes appear on the phone as paper cards, with
  the touch surface below them. Instructions always stay on the TV.
- **Teach during join, one gesture per moment, answered by the TV:** slide, then tap, then talk.
  Hints never look tappable, and each disappears once it's been done.

## The TV

- **Discrete focus, same direction as the thumb.** Focus memory per shelf.
- **A mouse steers the view and never plays.** On the TV that opened the room, a mouse moves through the shelf
  and menus as the controller's holder could. It takes no seat and no game counts it; players are always on phones.
  The cursor and mouse buttons show only while a mouse is moving, never on touch or a console.
- **Thumb lean:** before a step, the focused item leans toward the thumb (up to 1.5 degrees and 8px).
  At an edge it rubberbands 12px. This is what makes it feel connected.
- **Focus:** scale 1.07 plus a lifted hard shadow and a lamp edge. Never colour alone.
- **Reading at distance (at 1080p, scaled to viewport):** body 32, floor 28, captions 46. Safe area
  80 sides and 60 top and bottom; place cards stand on the table edge, which sits inside the bottom margin. Captions: two lines at most, name on speaker change.
- **Driver:** one person drives, first joiner by default. Their name hangs off the focus. On the shelf,
  after 5s idle, anyone's swipe takes over. During a game the controller stays with its holder unless
  their phone drops or goes down or they are out, and only the holder pauses, resumes or ends it for
  everyone, ending only after "End the game for everyone?" on their phone, which goes away after about 8s.
  Anyone may talk at any time, and anyone may leave for themselves. If the driver leaves, the next person
  playing takes over and the host says so.

## Motion

Press 60-100ms. Focus 120-160ms. Page 250-350ms. Whole-TV changes 400ms at most. Exits are shorter
than entrances. Everything is interruptible. Damped, no bounce on navigation. Anticipation and
follow-through belong to the lantern and big moments only, up to 3 a minute.

## Sound

All sound comes from the TV. Synthesized on a separate 48 kHz context, never the 24 kHz voice path.

- Tick 20-40ms with pitch by position; select 80-150ms rising; back mirrors it; a low soft thud at
  an edge. No buzzers and no menu music. At most one tick per 70ms, ±1 semitone variation.
- The voice anchors the mix. Ticks sit 15dB under it. Duck everything else 9dB under speech: 120ms
  down, 800ms up.

## The host

- **Four distinct states:** idle, listening, thinking, speaking. Holding to talk interrupts. Thinking
  shows at 300ms, and a spoken filler can come at 2s.
- **Browsing comments:** after 1.5s on a game, at most once per game, 30s apart, about half the time,
  8 words or fewer, recorded ahead so they play at once, and dropped if focus has moved. It points
  with its body and never moves focus itself.

## Latency

Touch to TV 100ms or less at p95, measured through the tunnel. The phone paints its own touch in the
same frame. Predict navigation only, never game results.

## Definition of done for any screen

1. Every state exists: empty, loading, one player, full, error, disconnected, long names.
2. It reads from across a room at 1080p and at 1366x768 laptop size.
3. It works with only the phone, and a mouse is never required when a phone is there.
4. Nothing on it could appear unchanged in any other product.
5. A screenshot has been reviewed against this file by someone who didn't build it.
6. Interaction has been felt on a real iPhone. Say plainly if it hasn't.

## Brief for any agent working on this

> Read `docs/DESIGN.md` first and follow it exactly; don't introduce your own fonts, colours, or
> motion values. Your job is a complete experience, so handle every state, not just the happy path.
> Before finishing, take screenshots of each state at 1920x1080 and 1366x768, or at 390x844 for
> phones. Look at them and fix what looks cheap. Report what you actually verified and what still
> needs a real phone.

## Brief for a design reviewer

> You didn't build this. Read `docs/DESIGN.md`, then judge each screenshot as a player and as a
> demanding art director. List specifically what looks generic, cheap, inconsistent, unreadable from
> across a room, or unfinished, with the file and the exact fix, worst first. Don't praise. Flag any
> banned item, any missing state, and any place the copy doesn't sound like the host.
