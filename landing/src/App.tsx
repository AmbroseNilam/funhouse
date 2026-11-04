// The front door, drawn as the TV's own table: the painted room, the lantern, two paper cards to
// start on a TV or join from a phone, and the real TV and phone beside them. Then the shelf of
// games, bringing your own agent, and what a night needs. The QR code skips this page and goes
// straight to the phone. Copy is plain description that says only what the code does. Follows DESIGN.md.

import { versionLine } from "../../shared/build-info.ts";
import { useState, type FormEvent, type ReactElement } from "react";
import { HOST_NAME, PRODUCT_NAME } from "../../shared/brand.ts";
import { GAMES, type GameBox } from "./games.ts";
import { InstallCard, mayOfferInstall, useInstallWay, type InstallWay } from "./InstallCard.tsx";
import { HostAtTable, LatePicture, type Moment } from "./table.tsx";

/** Letters in a room code. */
const ROOM_CODE_LENGTH: number = 4;

/** The room code a phone was just turned away from for not existing, if any. */
const MISSING_ROOM: string | null = new URLSearchParams(location.search).get("missing");

/** The room code a phone was just turned away from for being full, if any. */
const FULL_ROOM: string | null = new URLSearchParams(location.search).get("full");

/** What the mic does; the same line wherever it comes up. */
const MIC_LINE: string = "Your phone only sends sound while you talk: tap to talk, and it stops when you tap Stop or go quiet.";

/** Where to watch a game and read the code. Fill one in and its footer link appears; empty shows nothing. */
const PROOF: { video: string; code: string } = { video: "", code: "" };

/** Who holds the copyright; the same name as the repo's LICENSE. */
const COPYRIGHT: string = "© 2026 Ambrose Nilam";

/** The words the phone gives you to paste, with the link's secret part left out. */
const AGENT_WORDS: string = "Join my party game as my AI agent and play with me. Open this link and follow what it says:";

/** True on a phone-sized screen, where the big painting isn't worth its weight. */
const SMALL_SCREEN: boolean = matchMedia("(max-width: 600px)").matches;

/** The landing page. */
export function App(): ReactElement {
    const [code, setCode] = useState<string>("");
    const [moment, setMoment] = useState<Moment>(MISSING_ROOM !== null || FULL_ROOM !== null ? "turnedAway" : "arrived");
    const [look, setLook] = useState<number>(0);
    const ready: boolean = code.length === ROOM_CODE_LENGTH;
    const installWay: InstallWay | null = useInstallWay();
    const [installOpen, setInstallOpen] = useState<boolean>(mayOfferInstall);

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
                                alt={`The TV: a shelf of painted game boxes, a card with the room code and QR, and ${HOST_NAME} the lantern`}
                                width="1600"
                                height="900"
                            />
                        </figure>
                        <figure className="shot-phone">
                            <img src="/landing/shots/phone.webp" alt="A phone in the room: a plain orange surface that says Slide your thumb, Watch the TV" width="585" height="1190" />
                        </figure>
                    </div>
                    <HostAtTable moment={moment} code={code} look={look} />
                </div>
            </section>

            {installWay !== null && installOpen === true ? (
                <section className="install-section" aria-label="Add to your home screen">
                    <InstallCard way={installWay} onDone={() => { setInstallOpen(false); }} />
                </section>
            ) : null}

            <section className="shelf-section" aria-labelledby="games">
                <h2 id="games">Games</h2>
                <ul className="shelf">
                    {GAMES.map((game: GameBox) => (
                        <li key={game.name} className="box">
                            <div className="box-stand">
                                <LatePicture src={game.art} alt={game.alt} width={600} height={600} />
                            </div>
                            <div className="box-label">
                                <strong>{game.name}</strong>
                                <p>{game.line}</p>
                                <small>{game.players}</small>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="agent-section" aria-labelledby="agents">
                <div className="agent-copy">
                    <h2 id="agents">Bring your own agent</h2>
                    <p>Anyone at the table can give a seat to their own AI agent. It joins the room and plays alongside everyone else.</p>
                    <ol className="agent-steps">
                        <li>On your phone, open the ··· menu.</li>
                        <li>Choose AI guests and agents, then Add an agent.</li>
                        <li>Paste the link you get to your agent.</li>
                    </ol>
                    <p className="agent-limits">Agents can play Same Page and Twenty Doors. The agent has to be able to open a web link or connect over MCP, so not every agent app can use it.</p>
                </div>
                <div className="agent-note" aria-hidden="true">
                    <p>{AGENT_WORDS}</p>
                    <p className="agent-link">funhouse.live/a/···</p>
                </div>
            </section>

            <section className="needs" aria-labelledby="needs">
                <h2 id="needs">What a night needs</h2>
                <dl className="needs-list">
                    <div><dt>A TV and some phones</dt><dd>The game plays out on the TV. Each phone is a controller and a mic, so the host knows who said what.</dd></div>
                    <div><dt>Nothing to install</dt><dd>Guests scan the code or type four letters, and they're in, with no account.</dd></div>
                    <div><dt>A voice, or thumbs</dt><dd>Talk to the host, or choose Type instead if nobody wants to use a mic.</dd></div>
                    <div><dt>Enough players, or AI guests</dt><dd>A short table can add AI guests from the phone menu, in the games that support them.</dd></div>
                </dl>
                <p className="meta-line">Built with Meta's models: Muse Spark runs the host, Muse Voice Transcribe hears the room, and Muse Image paints the art.</p>
            </section>

            <footer className="foot">
                <nav className="foot-links" aria-label="Site">
                    <a href="/screen/">Start a room</a>
                    {PROOF.video !== "" ? <a href={PROOF.video}>Watch a game</a> : null}
                    {PROOF.code !== "" ? <a href={PROOF.code}>Code</a> : null}
                    <a href="/landing/privacy/">Privacy</a>
                    <a href="/landing/terms/">Terms</a>
                </nav>
                <p className="fine">{COPYRIGHT}</p>
                <p className="fine build-line">{versionLine(__BUILD_INFO__)}</p>
            </footer>
        </main>
    );
}
