// The front door. The first screen is the two things a visitor can do, start a room on a TV or
// join one from a phone, with the host speaking beside them. Everything below exists for the
// visitor who wants convincing first: how it works, the games, and proof that the host hears
// the room. The QR code skips this page and goes straight to the phone stage. On a phone,
// joining comes first and starting shrinks to a link, which the stylesheet decides.

import { useState, type FormEvent, type ReactElement } from "react";
import { HostBubble, type HostMoment } from "./HostBubble.tsx";
import { GAMES } from "./games.ts";
import { ListeningDemo, PhoneFrame, TvFrame } from "./frames.tsx";

/** Letters in a room code. */
const ROOM_CODE_LENGTH: number = 4;

/** The room code a phone was just turned away from for not existing, if any. */
const MISSING_ROOM: string | null = new URLSearchParams(location.search).get("missing");

/** The room code a phone was just turned away from for being full, if any. */
const FULL_ROOM: string | null = new URLSearchParams(location.search).get("full");

/** How it works, in three lines. */
const STEPS: { title: string; line: string }[] = [
    { title: "Open it on a TV", line: "Any screen with a browser. A room code and a QR appear, and the host says hello." },
    { title: "Scan with your phones", line: "No app, no account. Your phone is your mic and your private hand." },
    { title: "Play", line: "Hold to talk. The host hears who said what, runs the game, and keeps your secrets." },
];

/** The landing page. */
export function App(): ReactElement {
    const [code, setCode] = useState<string>("");
    const [moment, setMoment] = useState<HostMoment>(MISSING_ROOM !== null || FULL_ROOM !== null ? "turnedAway" : "arrived");
    const ready: boolean = code.length === ROOM_CODE_LENGTH;

    const join = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        location.assign(`/phone/?room=${encodeURIComponent(code)}`);
    };

    const typeCode = (raw: string): void => {
        const next: string = raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
        setCode(next);
        setMoment(next.length === ROOM_CODE_LENGTH ? "codeReady" : next.length > 0 ? "typing" : "arrived");
    };

    return (
        <main className="landing">
            <header className="top">
                <span className="wordmark">Game Room</span>
                <a className="top-start" href="/screen/">Start a room</a>
            </header>

            <section className="hero">
                <div className="hero-copy">
                    <h1>Game night. Nobody has to host.</h1>
                    <p className="subline">
                        An AI host on your TV runs the game, hears every player on their own phone, and keeps your secrets. Scan a code and play.
                    </p>
                    <div className="doors">
                        <a className="start" href="/screen/" onMouseEnter={() => { setMoment("hoverStart"); }} onFocus={() => { setMoment("hoverStart"); }}>
                            <strong>Start a room</strong>
                            <span>Open this on the TV</span>
                        </a>
                        <form className="join" onSubmit={join}>
                            <label htmlFor="room-code">Join a room</label>
                            {MISSING_ROOM !== null ? <p className="warning" role="alert">Room {MISSING_ROOM} isn't open. Check the TV for the code.</p> : null}
                            {FULL_ROOM !== null ? <p className="warning" role="alert">Room {FULL_ROOM} is full.</p> : null}
                            <div className="join-row">
                                <input
                                    id="room-code"
                                    value={code}
                                    onChange={(event) => { typeCode(event.target.value); }}
                                    onFocus={() => { setMoment(ready === true ? "codeReady" : code.length > 0 ? "typing" : "focusCode"); }}
                                    placeholder="CODE"
                                    aria-label="Room code from the TV"
                                    autoCapitalize="characters"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    enterKeyHint="go"
                                    inputMode="text"
                                />
                                <button type="submit" disabled={ready === false}>Join</button>
                            </div>
                            <p className="hint">{ready === true ? "That's a room. In you go." : "The four letters on the TV."}</p>
                        </form>
                    </div>
                </div>
                <div className="hero-visual" aria-label="The TV shows the room; a phone shows one player's secret role" role="img">
                    <TvFrame />
                    <HostBubble moment={moment} code={code} />
                    <PhoneFrame />
                </div>
            </section>

            <section className="steps" aria-labelledby="how">
                <h2 id="how">How it works</h2>
                <ol>
                    {STEPS.map((step, index) => (
                        <li key={step.title}>
                            <span className="step-number">{index + 1}</span>
                            <strong>{step.title}</strong>
                            <p>{step.line}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="games" aria-labelledby="games">
                <h2 id="games">The games</h2>
                <p className="section-line">Three tonight. The host runs each one; you only talk.</p>
                <ul>
                    {GAMES.map((game) => (
                        <li key={game.name} className="game">
                            <img src={game.art} alt={game.alt} loading="lazy" width="960" height="720" />
                            <div className="game-text">
                                <strong>{game.name}</strong>
                                <p>{game.line}</p>
                                <small>{game.players} · {game.length}</small>
                            </div>
                        </li>
                    ))}
                </ul>
                <p className="credit">Art made with Muse Image.</p>
            </section>

            <section className="hears" aria-labelledby="hears">
                <div className="hears-copy">
                    <h2 id="hears">It hears you.</h2>
                    <p>
                        Every phone is its own mic, so the host always knows who said what. Accuse your mate, shout an answer, ask the host a rule.
                        It answers you, by name if it has to.
                    </p>
                </div>
                <ListeningDemo />
            </section>

            <section className="secrets" aria-labelledby="secrets">
                <h2 id="secrets">Your secrets stay on your phone.</h2>
                <p className="section-line">The TV shows the room. Your phone shows you. Same moment, two screens.</p>
                <div className="secrets-pair">
                    <figure>
                        <TvFrame compact />
                        <figcaption>What everyone sees</figcaption>
                    </figure>
                    <figure>
                        <PhoneFrame />
                        <figcaption>What only you see</figcaption>
                    </figure>
                </div>
            </section>

            <section className="nothing" aria-labelledby="nothing">
                <h2 id="nothing">Nothing to install.</h2>
                <ul>
                    <li><strong>Any TV</strong><span>A laptop turned to the room, a smart TV's browser, or a cast tab.</span></li>
                    <li><strong>Any phone</strong><span>Scan the code and you're in. Friends need nothing.</span></li>
                    <li><strong>No accounts</strong><span>A name is all the host asks for.</span></li>
                </ul>
            </section>

            <footer className="foot">
                <a className="start" href="/screen/"><strong>Start a room</strong><span>It takes a second</span></a>
                <p className="fine">Your mic is only on while you hold the button, and the TV shows who's talking. Built with Meta's Muse models; art made with Muse Image.</p>
            </footer>
        </main>
    );
}
