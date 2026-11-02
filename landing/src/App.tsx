// The front door: host on a big screen, or join a room with a code. The QR code skips this
// page and goes straight to the phone stage. On a phone, joining comes first and hosting
// shrinks to a link, which the stylesheet decides.

import { useState, type FormEvent, type ReactElement } from "react";

/** Letters in a room code. */
const ROOM_CODE_LENGTH: number = 4;

/** The room code a phone was just turned away from for not existing, if any. */
const MISSING_ROOM: string | null = new URLSearchParams(location.search).get("missing");

/** The room code a phone was just turned away from for being full, if any. */
const FULL_ROOM: string | null = new URLSearchParams(location.search).get("full");

/** The landing page. */
export function App(): ReactElement {
    const [code, setCode] = useState<string>("");

    const join = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        location.assign(`/phone/?room=${encodeURIComponent(code)}`);
    };

    return (
        <main className="landing">
            <header className="intro">
                <h1>Game Room</h1>
                <p>Party games with an AI host who listens, talks back, and keeps your secrets.</p>
            </header>
            <div className="doors">
                <form className="door join" onSubmit={join}>
                    <h2>Join a room</h2>
                    {MISSING_ROOM !== null ? <p className="warning" role="alert">Room {MISSING_ROOM} isn't open. Check the big screen for the code.</p> : null}
                    {FULL_ROOM !== null ? <p className="warning" role="alert">Room {FULL_ROOM} is full.</p> : null}
                    <label htmlFor="room-code">Room code</label>
                    <input
                        id="room-code"
                        value={code}
                        onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH)); }}
                        placeholder="KPTR"
                        autoCapitalize="characters"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="go"
                    />
                    <button type="submit" disabled={code.length !== ROOM_CODE_LENGTH}>Join</button>
                </form>
                <div className="door host">
                    <h2>Host on a big screen</h2>
                    <p>Open this on a TV or laptop. Everyone joins from their phone.</p>
                    <a className="host-link" href="/screen/">Host on a big screen</a>
                </div>
            </div>
        </main>
    );
}
