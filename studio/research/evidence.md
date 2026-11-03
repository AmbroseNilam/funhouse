# Evidence for Funhouse Studio

_A literature review for the design of a place where a person with no programming ability makes a
party game that runs on their TV. Written 2026-11-03. It builds on the earlier review in the
planning notes (the no-code authoring research of 2026-11-02, cited here as [N]); where it repeats
a source from that review it says so, and where it differs it says so. Every claim names a primary
source and its year. Where a result could not be read in the original, that is stated. Strength
labels in the closing table mean: strong, several independent studies or a randomised design with a
clear effect; moderate, one good study or consistent correlational work; weak, small studies,
qualitative probes, or a single field; none found, the question was looked for and no study turned
up._

## 1. How non-programmers form and change designs

**People operate from a model of how the thing works, and a causal model beats a procedural one.**
Kieras and Bovair (1984) trained people to run a control-panel device either from procedures alone
or with a model of its internal workings; the model group learned faster, retained more and could
work out procedures they had not been taught [E1]. For Studio it means a creator needs a picture of
what a game is made of (people, secrets, turns, a judge, a reveal) before any rule makes sense,
and that picture is what the interface should teach, not a menu.

**People will not read first, and they settle on the first way that works.** Carroll and Rosson
(1987) named the paradox of the active user from IBM studies: people start doing at once, skip
learning that would pay off later, and carry habits from what they already know [E2]. Fu and Gray
(2004) later showed the same stable use of inefficient methods even in experts [E3]. If Studio has a tutorial,
nobody will take it; the first screen has to be the real thing done small.

**The cost of a tool is attention, and it is paid up front against an uncertain return.** Blackwell
(2002) modelled the decision to automate anything as an investment of attention weighed against the
risk the automation fails [E4]. This is a model, not an experiment, but it explains why creators
abandon tools after a first disappointing attempt and why a visible, early, cheap win matters more
than power. Ko, Myers and Aung (2004) watched 40 beginners in Visual Basic and sorted their
blockages into six barriers: design (what to do), selection (which part does it), coordination (how
parts combine), use (how to work a part), understanding (what happened) and information (how to
find out) [E5].
Studio must have an answer to each barrier, and the earlier review [N] covered only design and
understanding.

**The gulfs of execution and evaluation.** Hutchins, Hollan and Norman (1985) described the
distance between what a person intends and what the system accepts, and between what the system
shows and what the person needs to know [E6]. Cognitive Dimensions (Blackwell and Green, 2003, covered in [N]) adds the tradeoffs:
visibility, hidden dependencies, premature commitment and viscosity [E7].

**Why natural-language programming has fallen short, repeatedly.** Miller (1981) had people write
procedures in English for a computer to follow and found systematic gaps: steps left out, conditions
unstated, references that depended on context, little explicit control flow [E8]. Pane,
Ratanamahatana and Myers (2001, covered in [N]) found that non-programmers describe behaviour as
events and rules over sets, and interpret Boolean words inconsistently [E9]. The counterexample is
instructive: Biermann, Ballard and Sigmon (1983) showed students could solve matrix problems in a
constrained English system about as well as in a programming language [E10]. English worked when
the domain was narrow and the system's vocabulary known. With large models the gap moved rather than
closed. Liu and colleagues (2023) studied end users directing a code-generating model in a
spreadsheet and found the central problem to be grounded abstraction matching: people do not know
what the system can do or how to ask for it, and the model's fluency hides that [E11]. Jiang and
colleagues (2022) watched people learn the "syntax" of a natural-language code tool by trial and
error and struggle to debug their own requests [E12]. Zamfirescu-Pereira and colleagues (2023,
covered in [N]) found ten non-experts writing prompts opportunistically, treating the model like a
person and overgeneralising from one success [E13]. These are small qualitative studies, but they
agree, and they agree with Miller forty years earlier. **Where this review differs from [N]:** the
earlier review said domain language matters more than English-looking syntax. The evidence supports
something stronger. A description is a good way to start and a bad way to finish: the system must
turn it into concrete, finite decisions the creator can see and point at, because the description
will have gaps the creator cannot see. That is what "intent-first" has to mean here.

## 2. Creation by example and by demonstration

**Programming by demonstration works where the generalisation is small and shown back.** Cypher's
collection (1993) and Lieberman's (2001) document two decades of systems that watched a user and
inferred a program; their recurring problem was deciding how far one demonstration generalises, and
the systems that lasted showed their inference and let the user correct it [E14]. The lesson for Studio is narrow: a
correction made during a replay ("she should not see that card") is a good source of a rule, but the
system must ask whether it applies always or only here, as [N] also said.

**Remixing is where most creation starts, and it teaches.** Dasgupta, Hale, Monroy-Hernández and
Hill (2016) analysed 2.4 million Scratch projects and found that users who remixed more used a wider
set of programming concepts, and that exposure to a concept through a remix raised the chance of
using it later, controlling for output volume [E15]. The work is correlational, and the authors say
so. **Remixing trades generativity for originality.** Hill and Monroy-Hernández (2013) found that
the project features that attract more remixes also attract shallower ones, that remixes of remixes
grow shallower, and that prominent creators get less transformative remixes [E16]. Only about a
tenth of Scratch projects are ever remixed. The design implication cuts two ways: a shelf of
finished, prominent games will be remixed often and lightly. If Studio wants mechanically different
games, the remix must start from a mechanism, not a finished box, or must push the creator past the
first change.

**Examples help when wanted and hurt when imposed.** Jansson and Smith (1991) showed designers an
example solution and found they reproduced its features, including its flaws; later replication was
mixed and tied to familiarity [E17]. Siangliulue, Chan, Gajos and Dow (2015) ran an online
experiment with 97 people: examples requested by the person produced the most novel ideas, examples
pushed when the person seemed stuck produced the most ideas, and examples on a fixed schedule
produced fewer ideas than no examples at all [E18]. For Studio: offer, never interrupt; and make the shelf of examples a thing the creator reaches
for.

**Generative assistance homogenises groups while helping individuals.** Doshi and Hauser (2024,
covered in [N]) found this for short fiction [E19]. Anderson, Shah and Kreminski (2024) found it
again in a 36-person comparison of a chat model against a non-model creativity tool: ideas across
users were semantically closer with the model [E20]. Two studies in two domains, neither in games.
The risk named in the brief, that every game comes out the same, has a measured mechanism behind
it: the model pulls everyone toward the same defaults. **Widening the walls increases engagement.**
Dasgupta and Hill (2018) used a natural experiment in Scratch, the staged release of a feature, and
found causal evidence that access to a new creative capability raised engagement and learning, with
a caveat that people found it hard to imagine what the new capability was for [E21].

**Remix retention and originality: the honest gap.** No study was found that measures whether
people who begin by remixing keep creating longer than people who begin blank, or whether their
later work is more or less original. The Scratch work measures concept use and remix depth, not
retention. Studio should measure this itself.

**Game-making by non-programmers at scale has happened, with a constrained language.** Repenning
and colleagues reported a decade of middle-school game design in AgentSheets across thousands of
students, built on a small rule language with physical conditions and actions (Repenning et al.,
2015) [E22]. The reports are programme evaluations, not controlled comparisons, and the users were
children with teachers. They do show that a bounded, domain-shaped vocabulary is enough for
non-programmers to produce varied games, and that the variation comes from the vocabulary being
about the domain (seeing, hearing, moving) rather than about computation.

## 3. Direct manipulation versus conversation

**Direct manipulation is faster and preferred for local, specific changes; conversation is for
starting and for things you cannot point at.** Shneiderman (1983) named the pattern and Hutchins,
Hollan and Norman (1985) explained it as shortening both gulfs [E6, E23]. The cleanest modern test
is Masson, Malacria, Casiez and Vogel (2024): a layer that turned pointing and selecting into
prompts under a chat model made participants about 50 percent faster with 50 percent fewer and 72
percent shorter prompts when editing text, code and vector images, and they chose the direct
mechanisms for specific, localised tasks [E24]. One within-subject lab study, but a strong effect on
exactly the question Studio asks. Horvitz (1999) set out the principles of mixed initiative: add
value before taking initiative, infer the user's goal and attention, resolve key uncertainty by
asking, make it cheap to dismiss or undo, and keep learning [E25]. Amershi and colleagues (2019)
turned this into eighteen guidelines validated against practitioners' judgement [E26].

**What people complain about with model-driven creation tools.** Barke, James and Polikarpova
(2023) watched 20 programmers with a code assistant and found two modes: acceleration, where the
person knows what comes next and wants short, fast suggestions, and exploration, where they do not
and want alternatives they can compare and verify [E27]. Mozannar, Bansal, Fourney and Horvitz
(2024) labelled 3,000 moments of 21 programmers' sessions and found verification of suggestions is
a distinct, lengthy cost the tool adds [E28]. Liang, Yang and Myers (2024) surveyed 410 developers:
initial suggestions are often not accepted, and the main motivations are keystrokes and speed, not
ideas [E29]. Louie and colleagues (2020) found novice composers overwhelmed when a model generated
too much at once, and that steering tools that bound what the model may change restored a sense of
ownership [E30]. Interview studies of conversational coding report the same themes: detachment from
authorship when the model changes logic unasked, and friction from unexplained output (Sarkar and
Drosos, 2025, a qualitative study of 8.5 hours of sessions; a 2026 interview study reports "loss of
control" as a named theme) [E31]. **Fix loops do not converge on their own.** Huang and colleagues
(2024) found that models asked to correct their own reasoning without outside feedback often get
worse, because they cannot reliably judge their own answers [E32]. Olausson and colleagues (2024)
found self-repair of code gives modest and uneven gains, bottlenecked by the quality of the
feedback, with human feedback helping far more [E33]. The implication for Studio is mechanical: a
repair must be driven by a trace of what actually happened, not by the model re-reading its own
output, and the creator must approve each change.

## 4. Testing as understanding

**Asking "why did this happen" against a real execution beats reading rules.** Ko and Myers
(2009) gave developers two real bug reports and either a breakpoint debugger or the Whyline, which
answers questions about program output from a recorded execution; Whyline users succeeded about
three times as often and about twice as fast (the speed figure is from the authors' later summary;
the paper's own text gives the success ratio) [E34]. The 2004 Alice study ([N]) found the same with
novices. Lim, Dey and Avrahami (2009) tested 211 people on an intelligent system with different
explanation types: "why" explanations gave the best understanding and the strongest trust; "why not"
gave adequate performance but lower understanding; "how to" and "what if" were weaker [E35]. Both
are controlled studies. For Studio: when a simulated player does something surprising, the creator
asks why, and the answer is the chain of facts and rules that produced it, from the trace.

**Concrete cases first.** Worked examples (Sweller and Cooper, 1985, covered in [N]) and the
construction-kit principle of low floors (Resnick and Silverman, 2005, [N]) point the same way:
start from a specific round, not from the general rule [E36].

**Automated playtesting: what simulated players can tell a designer.** Smith, Nelson and Mateas
(2009) built BIPED, where a designer writes a game sketch in a small logical language and the same
sketch is played by people and searched by machine for reachable states and unintended outcomes
[E37]; Ludocore (2010) generalised the engine. Holmgård, Green, Liapis and Togelius (2018) built
procedural personas, agents with different utility functions driving tree search, to play levels
the way different kinds of players would [E38]. Gudmundsson and colleagues (2018) trained a network
on millions of human moves in a commercial puzzle game and predicted level difficulty well enough
to use in production, noting it was tested only on that family of games [E39]. Stahlke, Nova and
Mirza-Babaei (2020) built a designer-facing tool for agent playtesting of level layouts; its
findings could not be read for this review [E40]. Across this work the pattern is consistent:
simulation finds reachability, termination, balance, dead ends and dominant strategies cheaply, and
says nothing about whether the game is fun, funny, or socially alive. Braverman, Etesami and Mossel
(2008) proved that in the folk game of Mafia without a detective the two sides are balanced when
the informed minority is about the square root of the group, and that one detective changes that
to a linear share [E41]. That is exactly the kind of thing a simulation can tell a creator ("with
six players and two wolves, the wolves win most rounds") and a human playtest cannot in one
evening.

**Model-driven players.** Xu and colleagues (2023) had frozen language models play Werewolf with
retrieval and reflection and saw trust, bluffing and leadership emerge, while reporting
hallucination and shallow use of experience; later benchmarks found such players give shallow
speeches and misread rules [E42]. Aher, Arriaga and Kalai (2023) replicated several human-subject
findings with simulated participants and also found a "hyper-accuracy distortion": newer, more
aligned models simulate people who know obscure facts perfectly [E43]. Agnew and colleagues (2024)
argue that replacing human participants with models undermines representation, inclusion and
understanding [E44]. For Studio this settles the division of labour: model players are good for
exercising free speech paths (does the host leak, do rulings fire, does the phase advance when
someone says "we're ready"), and bad as a measure of whether the game is enjoyable or whether a
guessing game is hard. A trivia or guessing game tuned against model players will be wrongly
calibrated for humans.

**Why plausible-but-incoherent output happens and what catches it.** Zheng and colleagues (2023)
measured biases in models used as judges: strong position bias, a tendency to favour longer answers,
and inconclusive self-preference [E45]; Panickssery, Bowman and Feng (2024) then showed evaluators
recognise and favour their own output, with self-recognition predicting self-preference [E46]. Huang
(2024) and Olausson (2024) above show self-review does not converge. The honest conclusion is that a
model's judgement of a game it generated is not evidence the game works. What catches incoherence
is execution against invariants that do not come from the model: the rules terminate, every phase is
reachable, a secret never appears in a public fact, every player has a legal action when they are
asked to act, ties and departures have a rule. BIPED's logical analysis [E37] and the Funhouse
scenario scripts, which fail a run when the host says the secret, are instances of the same idea.

## 5. Living-room and distance interfaces

**Reading at distance has a measured threshold.** Legge and Bigelow (2011) reviewed vision science
and typography and give a consensus critical print size of 0.2 degrees of x-height for normal
sight, below which reading slows, with fluent reading over a tenfold range from 0.2 to 2 degrees
[E47]. Applied to the product's own numbers: at 1080p on a 55-inch television a pixel is about
0.63 mm; a 32 px body size in a face with an x-height near half the em gives an x-height of about
10 mm, which at three metres is about 0.19 degrees. The body text in DESIGN.md sits at the critical
size at a typical couch distance, fluent at two and a half metres and slow at three and a half. The
46 px caption size is comfortably inside the fluent range. This is arithmetic on a published
threshold, not a test on the product. Platform guidance agrees in direction: Google's television
guidelines state a 16 sp minimum for core text and advise using text sparingly because viewers are
about ten feet away [E48, vendor documentation]. Apple's guidance for television could not be read
in the original for this review.

**Two screens split attention, and audio is the channel that does not compete.** Eye-tracking
studies of television with a tablet companion report attention drawn substantially to the tablet
(Holmes, Josephson and Carney, 2012; the proportions could not be read in the original) [E49].
Neate, Jones and Evans (2016) found that dual-screen use splits attention unpredictably and that
the visual complexity of the companion content governs how much [E50]. Wickens (2008) reviewed
multiple resource theory: two visual tasks interfere more than a visual task paired with an
auditory one [E51]. Together these support the product's existing choices: instructions on the TV,
feedback from the TV, the phone kept nearly empty, and the host's voice as the channel that can
carry explanation while eyes stay on the table. They also warn against the obvious Studio design
of a rich editor on the phone: the creator would stop looking at the TV, and the friends watching
would lose them.

**Glanceable displays abstract and stage.** Matthews, Dey, Mankoff, Carter and Rattenbury (2004)
built a toolkit around three decisions for peripheral displays: abstract the data, choose
notification levels, and design the transitions between them [E52]. The design guidance is
experience-based, from a survey of displays and the attention literature. The two-line caption rule
and the "whisper" emphasis in the product are this.

**One controller for a group has a known cost.** Stewart, Bederson and Druin (1999) studied
children at one display with one or several input devices: children strongly preferred their own
device, and a passive partner wants some control [E53]. The product's driver rule, with takeover
after five seconds idle, is a mitigation of a real effect. Xu and colleagues (2011) observed board
game groups and argued that the "chores" of play, dealing and tallying, are themselves social
interaction, so automating them all is a loss [E54]. The host doing every chore is a design
decision with a cost the evidence names: give players some chores back.

**Shared displays and awareness.** Gutwin and Greenberg (2002) catalogued what people need to know
about each other to work at a shared surface: who is present, where their attention is, what they
are doing [E55]. The roster with speaking and muted states is this applied. Depping and Mandryk
(2017) found in a controlled experiment that cooperation and interdependence each raised
relatedness, enjoyment and interpersonal trust, additively [E56]. Studio games that create
interdependence will build closeness; a shelf full of solo quizzes will not.

## 6. Engagement and ownership

**Finishing something you made raises how much you value it, but only if you finish.** Norton,
Mochon and Ariely (2012) ran experiments with furniture, origami and construction toys: people
valued what they built far above identical items they did not build, the effect disappeared when the
build was left unfinished or taken apart, and it held for people with no interest in making things
[E57]. For Studio the first session must end with a game that runs, however small; a half-built game
on a shelf is worth nothing to its maker.

**Artificial progress increases completion.** Nunes and Drèze (2006) gave car-wash customers a
ten-stamp card with two stamps already on it or an eight-stamp card with none; the pre-stamped card
had higher completion and faster completion, and the authors attribute it to perceived progress
[E58]. A remix is an endowed-progress design: the creator starts most of the way to a working game.
Field experiment, one domain.

**Autonomy and competence predict enjoyment and return.** Ryan, Rigby and Przybylski (2006) found
across four studies that in-game autonomy and competence predicted enjoyment and intention to play
again, and that competence related to how intuitive the controls were [E59]. Self-determination
theory ([N]) is the frame; this is its measured application to games.

**Credit has to be given by a person to count.** Monroy-Hernández, Hill, Gonzalez-Rivero and boyd
(2011) studied the introduction of automatic attribution in Scratch: automatic credit did not
reduce complaints of plagiarism, and credit written by the remixer was valued where the automatic
line was not [E60]. Studio should show lineage automatically and also let the remixer say thanks
in their own words.

**Ranking by popularity creates inequality and unpredictability.** Salganik, Dodds and Watts
(2006) ran a music market with 14,341 participants in parallel worlds: showing download counts
raised both inequality and the unpredictability of which songs won, most when the list was ranked
by popularity [E61]. Muchnik, Aral and Taylor (2013) randomly up-voted comments and saw the
positive herding lift final scores by about 25 percent [E62]. Both are randomised, large and
replicated in spirit. A gallery ranked by what players do, plays finished and replays, is more
honest than likes, but any single ranked list amplifies whatever reaches it first. Hill and
Monroy-Hernández (2013) add that prominence attracts shallow remixes [E16].

**Dark patterns.** Zagal, Björk and Lewis (2013) catalogued temporal, monetary and social-capital
patterns in games, such as playing by appointment and grinding [E63]. Studio has no business model
in scope, and the relevant warnings are temporal (streaks, daily returns) and social (shaming
friends into playing).

**Whether social play of what you made keeps you creating: the gap.** Studies of Scratch report
that participation is highly skewed and most creators make few projects; no study found measures
the effect of seeing one's game played by friends on continued creation. The IKEA effect and
self-determination theory predict it; nothing measures it.

## 7. Party-game design itself

The games here are folk or public-domain designs: Mafia and its Werewolf retheme, Twenty
Questions, Two Truths and a Lie, Fictionary, Consequences, Wink Murder, Botticelli, Charades. Mafia
was created by a psychology student at Moscow State University in the mid-1980s and rethemed as
Werewolf in 1997 [E64]. Chittaranjan and Hung (2010) recorded three hours of
Werewolf and found nonverbal audio alone could detect deceptive roles well above chance and that
turn-taking predicted outcomes early in a round [E65]: the game's tension is audible before it is
spoken, which is why an AI host that listens has something to work with.

**Structural elements the best-regarded games share.** Costikyan (2013) catalogues sources of
uncertainty, among them hidden information, analytic complexity, performative uncertainty and
narrative anticipation, and argues a game needs at least one [E66]. Elias, Garfield and Gutschera
(2012) treat hidden information, indeterminacy, player effort and the game's length and
superstructure as characteristics to be set on purpose [E67]. From them and from the folk
games above, five structures recur:

| Structure | What it does | Folk example |
| --- | --- | --- |
| Information asymmetry | Someone knows what others do not; the game is about finding out or hiding it | Mafia roles; the secret in Twenty Questions; the lie in Two Truths |
| Turn structure | Who may act when: in order, all at once, or by a judge's call | Charades in turns; a simultaneous vote; the host calling the question |
| Time pressure | A clock that forces commitment | A round timer; a count of questions |
| Judgement | Someone rules on free-form input | The questioner in Twenty Questions; the reader in Fictionary |
| The reveal | A moment when hidden information becomes public and the room reacts | Dawn; the vote count; the answer |

Cox, Cairns, Shah and Carroll (2012) found that adding time pressure raised immersion where simply
demanding more actions did not, with the effect depending on the player's expertise [E68]:
pressure should bite the mind, not the thumb. Depping and Mandryk (2017) [E56] show interdependence
builds closeness, which is why cooperative and team structures belong in the vocabulary. Lazzaro's
"people fun" is often cited for the same point but is an industry white paper, not evidence. **Where
this review differs from [N]:** the earlier review's stress test listed game families by the
capability each exercises. The structures above are a smaller set that generates those families,
and they map onto what the contract already has: scopes for asymmetry, phases and `legalActions` for
turn structure, timers for pressure, `hostRulings` for judgement, and a phase change with public
facts for the reveal. A vocabulary of these five, each with a few decisions, covers the folk party
games named here. It does not cover drawing, trading, spatial or continuous games, as [N] also
found.

## Findings

| Finding | Strength | What it implies for Studio |
| --- | --- | --- |
| People learn a device faster from a causal model than from procedures [E1] | moderate | Teach what a game is made of, by showing a game being made of it, before any rule |
| People start doing at once and will not read or train first [E2, E3] | strong | The first screen is a real game edited small; no tutorial, no manual |
| Attention is invested against risk; an early cheap win decides whether people continue [E4] | weak (model) | A playable result inside the first few minutes, from a remix |
| Six learning barriers: design, selection, coordination, use, understanding, information [E5] | moderate | Every barrier needs a visible answer; "why did that happen" covers understanding, a shelf of named mechanisms covers selection |
| Unconstrained natural language leaves gaps the author cannot see; constrained domain language works [E8, E9, E10, E11, E12, E13] | strong | Take a spoken description as a start, turn it into finite decisions shown on the TV, never accept a description as the spec |
| Direct manipulation is faster and preferred for local, specific edits [E6, E23, E24] | moderate (one strong study) | Edits happen by pointing at a decision card on the TV and choosing; the host conversation is for starting and for what cannot be pointed at |
| Mixed-initiative principles: act only with value, ask to resolve key uncertainty, make dismissal cheap [E25, E26] | moderate (framework) | The model proposes, the creator taps; every proposal is one tap to refuse and nothing changes silently |
| Users of model tools resent unexplained changes and overwrites; verification is a real cost [E27, E28, E29, E30, E31] | moderate | A change touches one decision at a time and shows its consequence; the model never rewrites the game |
| Models cannot reliably correct their own output; feedback quality is the bottleneck [E32, E33] | strong | Repair is driven by a trace of a real run and approved by the creator, not by the model re-reading itself |
| Model judges have position, length and self-preference biases [E45, E46] | strong | A model's verdict on a generated game is not evidence; invariants checked by execution are |
| "Why" questions answered from a recorded execution roughly double debugging success [E34, E35] | strong | Every surprising moment in a rehearsal can be asked "why", and the answer is the chain of facts that caused it |
| Simulation finds termination, reachability, balance and dominant strategies; it cannot find fun [E37, E38, E39, E41] | moderate | Run deterministic rules simulations for structural checks; show balance as numbers; never present a passing simulation as "it is good" |
| Model players exercise speech paths but are miscalibrated as people [E42, E43, E44] | moderate | Use model players to test the host and rulings, not difficulty or enjoyment |
| Remixing is how most creation starts and it teaches; prominent, finished works get shallow remixes [E15, E16] | moderate | Remix from mechanisms and decisions, not only from finished boxes; nudge past the first change |
| Examples help when asked for and hurt when imposed [E17, E18] | moderate | Examples are a shelf the creator reaches for; never interrupt with one |
| Model assistance homogenises a group's output [E19, E20] | moderate | Capture the creator's odd idea before offering any default; measure mechanical diversity across games made |
| New creative capabilities raise engagement but people struggle to imagine their use [E21] | moderate | Each mechanism on the shelf is shown in a game, not described |
| Bounded domain vocabularies let non-programmers make varied games [E22] | weak (programme reports) | A small vocabulary of game structures, each with decisions, rather than a general language |
| Body text at 32 px is at the critical print size at three metres; captions at 46 px are fluent [E47, E48] | strong (threshold), arithmetic (application) | Studio text on the TV at or above the caption size; decision cards carry a few words, the host carries the rest in speech |
| A second screen splits attention unpredictably; visual plus auditory interferes less than visual plus visual [E49, E50, E51] | moderate | The phone shows almost nothing in Studio; the TV shows the design; the host's voice explains |
| Glanceable displays abstract, stage and transition [E52] | weak (design guidance) | A design shown as a few cards in a row with one in focus, not a form |
| One shared controller frustrates the non-controller; chores are social [E53, E54] | moderate | Co-creators can each hold a card; players keep some chores in games made |
| Cooperation and interdependence raise closeness and trust [E56] | moderate | Team and cooperative structures in the vocabulary from the start |
| Finishing what you made raises its value to you; unfinished work does not [E57] | strong | A session ends with a game that runs, every time, even if it is one change from the original |
| Endowed progress increases completion [E58] | moderate | A remix starts with most decisions made and visible as made |
| Autonomy and intuitive control predict enjoyment and return [E59] | strong | The creator chooses; the model never decides a rule |
| Credit given by a person counts; automatic credit does not settle disputes [E60] | moderate | Show lineage automatically, let the remixer write a line of thanks |
| Popularity rankings create inequality and unpredictability; herding is about a quarter of a score [E61, E62] | strong | Rank by plays finished and replays, show several small lists, no single leaderboard |
| Temporal and social dark patterns are catalogued [E63] | weak (taxonomy) | No streaks, no daily returns, no shaming prompts |
| Five structures cover the folk party games: asymmetry, turns, pressure, judgement, reveal [E66, E67, E64, E65, E68] | moderate (designers' taxonomies plus two studies) | These five, with decisions on each, are Studio's vocabulary; drawing, trading, spatial and continuous games are out of scope without a programmer |
| Whether remixers persist or stay original; whether social play of one's game sustains creation | none found | Studio measures both itself: sessions to second game, mechanical distance between a remix and its source, return after friends have played |

## Sources

- [N] The no-code authoring review in the planning notes, 2026-11-02, with its sources S1 to S24.
- [E1] Kieras, D. E., Bovair, S. (1984). The role of a mental model in learning to operate a device. Cognitive Science.
- [E2] Carroll, J. M., Rosson, M. B. (1987). Paradox of the active user. In Carroll (ed.), Interfacing Thought. MIT Press.
- [E3] Fu, W.-T., Gray, W. D. (2004). Resolving the paradox of the active user. Cognitive Science.
- [E4] Blackwell, A. F. (2002). First steps in programming: a rationale for attention investment models. IEEE HCC.
- [E5] Ko, A. J., Myers, B. A., Aung, H. (2004). Six learning barriers in end-user programming systems. IEEE VL/HCC.
- [E6] Hutchins, E., Hollan, J., Norman, D. (1985). Direct manipulation interfaces. Human-Computer Interaction.
- [E7] Blackwell, A., Green, T. (2003). Notational systems: the Cognitive Dimensions of Notations framework. In HCI Models, Theories and Frameworks. Morgan Kaufmann.
- [E8] Miller, L. A. (1981). Natural language programming: styles, strategies, and contrasts. IBM Systems Journal. Full text in the archived journal.
- [E9] Pane, J. F., Ratanamahatana, C. A., Myers, B. A. (2001). Studying the language and structure in non-programmers' solutions to programming problems. IJHCS.
- [E10] Biermann, A. W., Ballard, B. W., Sigmon, A. H. (1983). An experimental study of natural language programming. International Journal of Man-Machine Studies. Abstract and secondary accounts only.
- [E11] Liu, M. X., Sarkar, A., Negreanu, C., Zorn, B., Williams, J., Toronto, N., Gordon, A. D. (2023). "What it wants me to say": bridging the abstraction gap between end-user programmers and code-generating LLMs. CHI 2023.
- [E12] Jiang, E., Toh, E., Molina, A., Olson, K., Kayacik, C., Donsbach, A., Cai, C. J., Terry, M. (2022). Discovering the syntax and strategies of natural language programming with generative language models. CHI 2022.
- [E13] Zamfirescu-Pereira, J. D., Wong, R. Y., Hartmann, B., Yang, Q. (2023). Why Johnny can't prompt. CHI 2023.
- [E14] Cypher, A. (ed.) (1993). Watch What I Do: Programming by Demonstration. MIT Press. Lieberman, H. (ed.) (2001). Your Wish Is My Command: Programming by Example. Morgan Kaufmann.
- [E15] Dasgupta, S., Hale, W., Monroy-Hernández, A., Hill, B. M. (2016). Remixing as a pathway to computational thinking. CSCW 2016.
- [E16] Hill, B. M., Monroy-Hernández, A. (2013). The remixing dilemma: the trade-off between generativity and originality. American Behavioral Scientist.
- [E17] Jansson, D. G., Smith, S. M. (1991). Design fixation. Design Studies.
- [E18] Siangliulue, P., Chan, J., Gajos, K. Z., Dow, S. P. (2015). Providing timely examples improves the quantity and quality of generated ideas. Creativity and Cognition 2015.
- [E19] Doshi, A. R., Hauser, O. P. (2024). Generative AI enhances individual creativity but reduces the collective diversity of novel content. Science Advances.
- [E20] Anderson, B. R., Shah, J. H., Kreminski, M. (2024). Homogenization effects of large language models on human creative ideation. Creativity and Cognition 2024.
- [E21] Dasgupta, S., Hill, B. M. (2018). How "wide walls" can increase engagement: evidence from a natural experiment in Scratch. CHI 2018.
- [E22] Repenning, A., Webb, D. C., Koh, K. H., et al. (2015). Scalable game design: a strategy to bring systemic computer science education to schools through game design and simulation creation. ACM Transactions on Computing Education. Programme evaluation.
- [E23] Shneiderman, B. (1983). Direct manipulation: a step beyond programming languages. IEEE Computer.
- [E24] Masson, D., Malacria, S., Casiez, G., Vogel, D. (2024). DirectGPT: a direct manipulation interface to interact with large language models. CHI 2024.
- [E25] Horvitz, E. (1999). Principles of mixed-initiative user interfaces. CHI 1999.
- [E26] Amershi, S., et al. (2019). Guidelines for human-AI interaction. CHI 2019.
- [E27] Barke, S., James, M. B., Polikarpova, N. (2023). Grounded Copilot: how programmers interact with code-generating models. OOPSLA 2023.
- [E28] Mozannar, H., Bansal, G., Fourney, A., Horvitz, E. (2024). Reading between the lines: modeling user behavior and costs in AI-assisted programming. CHI 2024.
- [E29] Liang, J. T., Yang, C., Myers, B. A. (2024). A large-scale survey on the usability of AI programming assistants. ICSE 2024.
- [E30] Louie, R., Coenen, A., Huang, C. Z., Terry, M., Cai, C. J. (2020). Novice-AI music co-creation via AI-steering tools for deep generative models. CHI 2020.
- [E31] Sarkar, A., Drosos, I. (2025). Vibe coding: programming through conversation with artificial intelligence. PPIG 2025 / arXiv 2506.23253. "Loss of control" theme: arXiv 2609.09560 (2026).
- [E32] Huang, J., Chen, X., et al. (2024). Large language models cannot self-correct reasoning yet. ICLR 2024.
- [E33] Olausson, T. X., et al. (2024). Is self-repair a silver bullet for code generation? ICLR 2024.
- [E34] Ko, A. J., Myers, B. A. (2009). Finding causes of program output with the Java Whyline. CHI 2009.
- [E35] Lim, B. Y., Dey, A. K., Avrahami, D. (2009). Why and why not explanations improve the intelligibility of context-aware intelligent systems. CHI 2009.
- [E36] Sweller, J., Cooper, G. (1985). Cognition and Instruction. Resnick, M., Silverman, B. (2005). Some reflections on designing construction kits for kids. IDC 2005.
- [E37] Smith, A. M., Nelson, M. J., Mateas, M. (2009). Computational support for play testing game sketches. AIIDE 2009. And (2010) Ludocore: a logical game engine for modeling videogames. IEEE CIG 2010.
- [E38] Holmgård, C., Green, M. C., Liapis, A., Togelius, J. (2018/2019). Automated playtesting with procedural personas through MCTS with evolved heuristics. IEEE Transactions on Games.
- [E39] Gudmundsson, S. F., et al. (2018). Human-like playtesting with deep learning. IEEE CIG 2018.
- [E40] Stahlke, S. N., Nova, A., Mirza-Babaei, P. (2020). Artificial players in the design process. CHI PLAY 2020. Findings not read.
- [E41] Braverman, M., Etesami, O., Mossel, E. (2008). Mafia: a theoretical study of players and coalitions in a partial information environment. Annals of Applied Probability.
- [E42] Xu, Y., et al. (2023). Exploring large language models for communication games: an empirical study on Werewolf. arXiv 2309.04658 (preprint).
- [E43] Aher, G., Arriaga, R. I., Kalai, A. T. (2023). Using large language models to simulate multiple humans and replicate human subject studies. ICML 2023.
- [E44] Agnew, W., et al. (2024). The illusion of artificial inclusion. CHI 2024.
- [E45] Zheng, L., et al. (2023). Judging LLM-as-a-judge with MT-Bench and Chatbot Arena. NeurIPS 2023.
- [E46] Panickssery, A., Bowman, S. R., Feng, S. (2024). LLM evaluators recognize and favor their own generations. NeurIPS 2024.
- [E47] Legge, G. E., Bigelow, C. A. (2011). Does print size matter for reading? A review of findings from vision science and typography. Journal of Vision 11(5):8.
- [E48] Google, Android TV design and quality guidelines (text sizes and viewing distance). Vendor documentation.
- [E49] Holmes, M. E., Josephson, S., Carney, R. E. (2012). Visual attention to television programs with a second-screen application. ETRA 2012. Results not read.
- [E50] Neate, T., Jones, M., Evans, M. (2016). Designing visual complexity for dual-screen media. CHI 2016. Their 2015 CHI paper was not readable.
- [E51] Wickens, C. D. (2008). Multiple resources and mental workload. Human Factors.
- [E52] Matthews, T., Dey, A. K., Mankoff, J., Carter, S., Rattenbury, T. (2004). A toolkit for managing user attention in peripheral displays. UIST 2004.
- [E53] Stewart, J., Bederson, B. B., Druin, A. (1999). Single display groupware: a model for co-present collaboration. CHI 1999. Preferences from the technical report.
- [E54] Xu, Y., Barba, E., Radu, I., Gandy, M., MacIntyre, B. (2011). Chores are fun: understanding social play in board games for digital tabletop game design. DiGRA 2011.
- [E55] Gutwin, C., Greenberg, S. (2002). A descriptive framework of workspace awareness for real-time groupware. CSCW journal 11.
- [E56] Depping, A. E., Mandryk, R. L. (2017). Cooperation and interdependence: how multiplayer games increase social closeness. CHI PLAY 2017.
- [E57] Norton, M. I., Mochon, D., Ariely, D. (2012). The IKEA effect: when labor leads to love. Journal of Consumer Psychology.
- [E58] Nunes, J. C., Drèze, X. (2006). The endowed progress effect. Journal of Consumer Research.
- [E59] Ryan, R. M., Rigby, C. S., Przybylski, A. (2006). The motivational pull of video games. Motivation and Emotion 30.
- [E60] Monroy-Hernández, A., Hill, B. M., Gonzalez-Rivero, J., boyd, d. (2011). Computers can't give credit. CHI 2011.
- [E61] Salganik, M. J., Dodds, P. S., Watts, D. J. (2006). Experimental study of inequality and unpredictability in an artificial cultural market. Science 311.
- [E62] Muchnik, L., Aral, S., Taylor, S. J. (2013). Social influence bias: a randomized experiment. Science 341.
- [E63] Zagal, J. P., Björk, S., Lewis, C. (2013). Dark patterns in the design of games. FDG 2013.
- [E64] Mafia (party game), Wikipedia, read 2026-11-03, for the game's origin (1986 or 1987, sources differ) and the 1997 retheme.
- [E65] Chittaranjan, G., Hung, H. (2010). Are you a werewolf? Detecting deceptive roles and outcomes in a conversational role-playing game. IEEE ICASSP 2010.
- [E66] Costikyan, G. (2013). Uncertainty in Games. MIT Press.
- [E67] Elias, G. S., Garfield, R., Gutschera, K. R. (2012). Characteristics of Games. MIT Press.
- [E68] Cox, A., Cairns, P., Shah, P., Carroll, M. (2012). Not doing but thinking: the role of challenge in the gaming experience. CHI 2012.
