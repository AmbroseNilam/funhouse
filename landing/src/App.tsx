// The front door, drawn as the TV's own table: the painted room, the lantern, two paper cards to
// start on a TV or join from a phone, and the real TV and phone beside them. Then the shelf of
// games, the vote the host really runs, and what a phone holds. The QR code skips this page and
// goes straight to the phone. Copy is plain description that says only what the code does; the
// host speaks only in the game demos. Follows docs/DESIGN.md and docs/LANDING-RESEARCH.md in the planning notes.

import { versionLine } from "../../shared/build-info.ts";
import { useState, type FormEvent, type ReactElement } from "react";
import { HOST_NAME, PRODUCT_NAME } from "../../shared/brand.ts";
import { GAMES, type GameBox } from "./games.ts";
import { HostAtTable, LatePicture, NAMES, PhoneCard, VoteDemo, type Moment } from "./table.tsx";

/** Letters in a room code. */
const ROOM_CODE_LENGTH: number = 4;

/** The room code a phone was just turned away from for not existing, if any. */
const MISSING_ROOM: string | null = new URLSearchParams(location.search).get("missing");

/** The room code a phone was just turned away from for being full, if any. */
const FULL_ROOM: string | null = new URLSearchParams(location.search).get("full");

/** What the mic does; the same line wherever it comes up. */
const MIC_LINE: string = "Your phone only sends sound while you talk: tap Talk to start, and it stops when you tap Stop or go quiet.";

/** Where to watch a game and read the code. Empty until they exist; nothing shows until then. */
const PROOF: { video: string; code: string } = { video: "", code: "" };

/** True on a phone-sized screen, where the big painting isn't worth its weight. */
const SMALL_SCREEN: boolean = matchMedia("(max-width: 600px)").matches;

/** The landing page. */
export function App(): ReactElement {
    const [code, setCode] = useState<string>("");
    const [moment, setMoment] = useState<Moment>(MISSING_ROOM !== null || FULL_ROOM !== null ? "turnedAway" : "arrived");
    const [look, setLook] = useState<number>(0);
    const ready: boolean = code.length === ROOM_CODE_LENGTH;

    const join = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        location.assign(`/phone/?room=${encodeURIComponent(code)}`);
    };

    const typeCode = (raw: string): void => {
        const next: string = raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
        setCode(next);
        setMoment(next.length === ROOM_CODE_LENGTH ? "codeReady" : next.length > 0 ? "typing" : "atCode");
    };

    const atStart = (): void => {
        setMoment("atStart");
        setLook(-1);
    };

    return (
        <main className="landing">
            <section className="table">
                {SMALL_SCREEN === false ? <img className="room-art" src="/screen/art/hero.webp" alt="" /> : null}
                <div className="table-inner">
                    <header className="heading">
                        <p className="name">{PRODUCT_NAME}</p>
                        <h1>Game night that runs itself</h1>
                        <p className="plain">
                            An AI host runs the game on your TV. Your phone is the controller and mic, and there's nothing to install.
                        </p>
                    </header>
                    <div className="cards">
                        <div className="start-side">
                            <a className="paper card start-card" href="/screen/" onMouseEnter={atStart} onFocus={atStart}>
                                <strong>Start on a TV</strong>
                                <span>Open this page on a TV or laptop to get a room code and QR code.</span>
                                <em>Start a room</em>
                            </a>
                            <p className="hosting-line">Hosting? <a href="/screen/">Open this site on a TV or laptop.</a></p>
                        </div>
                        <form className="paper card join-card" onSubmit={join}>
                            <strong>Join from your phone</strong>
                            {MISSING_ROOM !== null ? <span className="turned-away" role="alert">Room {MISSING_ROOM} isn't open. Check the TV for the code.</span> : null}
                            {FULL_ROOM !== null ? <span className="turned-away" role="alert">Room {FULL_ROOM} is full.</span> : null}
                            <label htmlFor="room-code">The four letters on the TV</label>
                            <div className="code-row">
                                <input
                                    id="room-code"
                                    value={code}
                                    onChange={(event) => { typeCode(event.target.value); }}
                                    onFocus={() => { setLook(1); setMoment(ready === true ? "codeReady" : code.length > 0 ? "typing" : "atCode"); }}
                                    size={ROOM_CODE_LENGTH}
                                    maxLength={ROOM_CODE_LENGTH}
                                    autoCapitalize="characters"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    enterKeyHint="go"
                                />
                                <button type="submit" disabled={ready === false}>Join</button>
                            </div>
                            <a className="scan-link" href="/phone/?scan=1">Scan the code</a>
                            <small className="mic-note">{MIC_LINE}</small>
                        </form>
                    </div>
                    <div className="product">
                        <figure className="shot-tv">
                            <img
                                src="/landing/shots/tv.webp"
                                alt={`The TV: a shelf of game boxes, a card with the room code and QR, and ${HOST_NAME} the lantern saying hello`}
                                width="1600"
                                height="900"
                            />
                        </figure>
                        <figure className="shot-phone">
                            <img src="/landing/shots/phone.webp" alt={`${NAMES.owner}'s phone: a plain orange surface that says Slide your thumb, Watch the TV`} width="585" height="1190" />
                        </figure>
                    </div>
                    <HostAtTable moment={moment} code={code} look={look} />
                </div>
            </section>

            <section className="shelf-section" aria-labelledby="games">
                <h2 id="games">Games</h2>
                <ul className="shelf">
                    {GAMES.map((game: GameBox) => (
                        <li key={game.name} className="box">
                            <LatePicture src={game.art} alt={game.alt} width={1024} height={1024} />
                            <div className="box-label">
                                <strong>{game.name}</strong>
                                <p>{game.line}</p>
                                <small>{game.players} · {game.length}</small>
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="plank" />
            </section>

            <section className="hears" aria-labelledby="hears">
                <div className="hears-copy">
                    <h2 id="hears">Talk to the host</h2>
                    <p className="plain">
                        Each phone is a separate mic, so the host knows who's speaking. Answer out loud, ask about a rule, or say when you're ready to vote.
                    </p>
                    <p className="plain mic-big">{MIC_LINE}</p>
                </div>
                <VoteDemo />
            </section>

            <section className="secrets" aria-labelledby="secrets">
                <div className="hears-copy">
                    <h2 id="secrets">Secret roles stay on your phone</h2>
                    <p className="plain">
                        Your role only shows while you press and hold, so a phone left on the table gives nothing away.
                    </p>
                </div>
                <PhoneCard />
            </section>

            <footer className="foot">
                <a className="paper card start-card" href="/screen/"><strong>Start on a TV</strong><em>Start a room</em></a>
                {PROOF.video !== "" || PROOF.code !== "" ? (
                    <p className="proof">
                        {PROOF.video !== "" ? <a href={PROOF.video}>Watch a game</a> : null}
                        {PROOF.code !== "" ? <a href={PROOF.code}>Read the code</a> : null}
                    </p>
                ) : null}
                <p className="fine">You don't need an account. Players enter a name and allow the mic. Built with Meta's Muse Spark, Muse Voice Transcribe and Muse Image.</p>
                <p className="fine"><strong>Quiz topics and web search.</strong> When you say a topic for Quizmaster, that topic goes to Meta's AI model, which searches the web to help write the questions. Meta runs the search, and we don't know which search services it uses, so your words may reach them. We ask Meta not to save the request as a stored response, but its usual terms still apply. The topic and its questions stay in our server's memory for up to an hour, even after your room closes, and another room choosing the same topic can get the same questions. So please don't say anything private as a topic.</p>
                <p className="fine"><strong>Quick judgments.</strong> Some typed answers, and some of what you say in rooms trying this, go to TypeSafe AI, whose Jev model judges things like whether two answers mean the same. We haven't been able to confirm how long TypeSafe keeps that text or whether it trains on it.</p>
                <p className="fine">{versionLine(__BUILD_INFO__)}</p>
            </footer>
        </main>
    );
}
