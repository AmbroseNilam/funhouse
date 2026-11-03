// The front door, drawn as the TV's own table: the painted room, the lantern, two paper cards to
// start on a TV or join from a phone, and the real TV and phone beside them. Then the shelf of
// games, the vote the host really runs, and what a phone holds. The QR code skips this page and
// goes straight to the phone. Copy is in the host's first person and says only what the code
// does. Follows docs/DESIGN.md and docs/LANDING-RESEARCH.md in the planning notes.

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

/** What the mic does, in the host's words; the same line wherever it comes up. */
const MIC_LINE: string = "Hold to talk. Until then, I hear nothing.";

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
                        <h1>Game night. Nobody has to host.</h1>
                        <p className="plain">
                            Party games with an AI host that hears you. The game's on the TV, your phone is the controller and the mic, and there's nothing to install.
                        </p>
                    </header>
                    <div className="cards">
                        <div className="start-side">
                            <a className="paper card start-card" href="/screen/" onMouseEnter={atStart} onFocus={atStart}>
                                <strong>Start on a TV</strong>
                                <span>Open this on the big screen. A code and a QR appear, and I say hello.</span>
                                <em>Start a room</em>
                            </a>
                            <p className="hosting-line">Hosting? <a href="/screen/">Open this site on a TV or laptop.</a></p>
                            <p className="try-alone">One person can try it: a laptop, a phone, five minutes of Twenty Doors.</p>
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
                        <p className="product-note">The real TV and {NAMES.owner}'s phone. No app, just the browser.</p>
                    </div>
                    <HostAtTable moment={moment} code={code} look={look} />
                </div>
            </section>

            <section className="shelf-section" aria-labelledby="games">
                <h2 id="games">On the shelf tonight</h2>
                <p className="plain">Pick one and play. Nobody sits out to run it, because that's my job.</p>
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
                    <h2 id="hears">I know who said what.</h2>
                    <p className="plain">
                        Every phone is its own mic. Accuse your friend, shout an answer, ask me a rule, and I answer you, by name if I have to.
                        When the table's ready to vote, say so, and I call it.
                    </p>
                    <p className="plain mic-big">{MIC_LINE}</p>
                </div>
                <VoteDemo />
            </section>

            <section className="secrets" aria-labelledby="secrets">
                <div className="hears-copy">
                    <h2 id="secrets">Your secrets stay in your hand.</h2>
                    <p className="plain">
                        The TV shows the room. Your phone shows you, and only while you press. A phone left on the table gives nothing away, and I never see
                        who's who either.
                    </p>
                </div>
                <PhoneCard />
            </section>

            <footer className="foot">
                <a className="paper card start-card" href="/screen/"><strong>Start on a TV</strong><span>It takes a second.</span><em>Start a room</em></a>
                {PROOF.video !== "" || PROOF.code !== "" ? (
                    <p className="proof">
                        {PROOF.video !== "" ? <a href={PROOF.video}>Watch a game</a> : null}
                        {PROOF.code !== "" ? <a href={PROOF.code}>Read the code</a> : null}
                    </p>
                ) : null}
                <p className="fine">No accounts. Just a name and the mic. Built with Meta's Muse Spark, Muse Voice Transcribe and Muse Image.</p>
            </footer>
        </main>
    );
}
