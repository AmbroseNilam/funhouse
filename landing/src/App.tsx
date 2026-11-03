// The front door, drawn as the TV's own table so the first screen could be mistaken for it: the
// painted room, the lantern, and two paper cards, host on a TV or join from a phone. Below it,
// the shelf of games, the host hearing someone, what a phone holds, and what to install (nothing).
// The QR code skips this page and goes straight to the phone. Follows docs/DESIGN.md in the
// planning notes.

import { useState, type FormEvent, type ReactElement } from "react";
import { HOST_NAME, PRODUCT_NAME } from "../../shared/brand.ts";
import { GAMES, type GameBox } from "./games.ts";
import { Exchange, HostAtTable, PhoneCard, type Moment } from "./table.tsx";

/** Letters in a room code. */
const ROOM_CODE_LENGTH: number = 4;

/** The room code a phone was just turned away from for not existing, if any. */
const MISSING_ROOM: string | null = new URLSearchParams(location.search).get("missing");

/** The room code a phone was just turned away from for being full, if any. */
const FULL_ROOM: string | null = new URLSearchParams(location.search).get("full");

/** The slight tilts the boxes sit at, like real boxes on a shelf. */
const BOX_TILTS: number[] = [-1.2, 0.8, -0.6];

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

    return (
        <main className="landing">
            <section className="table">
                <img className="room-art" src="/screen/art/hero.webp" alt="" />
                <header className="heading">
                    <p className="name">{PRODUCT_NAME}</p>
                    <h1>Game night. Nobody has to host.</h1>
                    <p className="plain">
                        {HOST_NAME} is an AI host on your TV. It runs the game, hears each of you on your own phone, and keeps your secrets.
                        Scan a code and play.
                    </p>
                </header>
                <div className="cards">
                    <a className="paper card host-card" href="/screen/" onMouseEnter={() => { setMoment("atHost"); setLook(-1); }} onFocus={() => { setMoment("atHost"); setLook(-1); }}>
                        <strong>Host on a TV</strong>
                        <span>Open this on the big screen. A code and a QR appear, and I say hello.</span>
                        <em>Start a room</em>
                    </a>
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
                                placeholder="KPTR"
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
                    </form>
                </div>
                <HostAtTable moment={moment} code={code} look={look} />
            </section>

            <section className="shelf-section" aria-labelledby="games">
                <h2 id="games">On the shelf tonight</h2>
                <p className="plain">Three games, and nobody sits out to run them. Even Werewolf's narrator is me.</p>
                <ul className="shelf">
                    {GAMES.map((game: GameBox, index: number) => (
                        <li key={game.name} className="box" style={{ rotate: `${BOX_TILTS[index] ?? 0}deg` }}>
                            <img src={game.art} alt={game.alt} loading="lazy" width="1024" height="1024" />
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
                    <h2 id="hears">It hears you.</h2>
                    <p className="plain">
                        Every phone is its own mic, so I always know who said what. Accuse your mate, shout an answer, ask me a rule.
                        I'll answer you, by name if I have to.
                    </p>
                </div>
                <Exchange />
            </section>

            <section className="secrets" aria-labelledby="secrets">
                <div className="hears-copy">
                    <h2 id="secrets">Your secrets stay in your hand.</h2>
                    <p className="plain">The TV shows the room. Your phone shows you. Same moment, two screens. Nothing to look down at until there's a secret to keep.</p>
                </div>
                <PhoneCard />
            </section>

            <section className="nothing" aria-labelledby="nothing">
                <h2 id="nothing">Nothing to install.</h2>
                <ul className="notes">
                    <li className="paper"><strong>Any TV</strong><span>A laptop turned to the room, a smart TV's browser, or a cast tab.</span></li>
                    <li className="paper"><strong>Any phone</strong><span>Scan the code and you're in. Your friends need nothing.</span></li>
                    <li className="paper"><strong>No accounts</strong><span>A name is all I ask for.</span></li>
                </ul>
            </section>

            <footer className="foot">
                <a className="paper card host-card" href="/screen/"><strong>Host on a TV</strong><span>It takes a second.</span><em>Start a room</em></a>
                <p className="fine">Your mic is only on while you hold, and the TV shows who's talking. Built with Meta's Muse models.</p>
            </footer>
        </main>
    );
}
