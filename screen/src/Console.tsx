// The console's screens, drawn from what the room says: the shelf of game boxes, a game's page,
// who's at the table, and the pause menu. Nothing here decides anything. Text is written for
// reading across a room. Every screen works from the phone alone; a mouse only says what a phone could.

import type { ReactElement } from "react";
import { HOST_NAME } from "../../shared/brand.ts";
import { Poster } from "./Poster.tsx";
import type { NavAction, Seat, ShelfGame, ShellView } from "../../shared/shell.ts";

/** What a mouse may do on this screen right now, or null when it can only watch. */
export type Pointing = ((action: NavAction) => void) | null;

/**
 * The class and click for something a mouse can choose.
 * @param pointing what the mouse may do.
 * @param index the item's place.
 * @returns the props; nothing at all when the mouse can only watch.
 */
function chooseProps(pointing: Pointing, index: number): { onClick?: () => void; "data-clickable"?: true } {
    if (pointing === null) {
        return {};
    }
    return { onClick: (): void => { pointing({ kind: "choose", index }); }, "data-clickable": true };
}

/** Slightly different box shapes, so the shelf reads as objects and not a grid. */
const BOX_SHAPES: { height: number; tilt: number; width: number }[] = [
    { height: 92, tilt: -1.2, width: 1.1 },
    { height: 100, tilt: 0.8, width: 1 },
    { height: 88, tilt: -0.6, width: 0.95 },
    { height: 76, tilt: 1.4, width: 0.75 },
];

/** Width of a box with a shape of width 1, in the TV's units. Four boxes just fill the shelf. */
const BOX_WIDTH_UNITS: number = 318;

/** Gap between boxes, in the TV's units; the same as .shelf-rail in the styles. */
const BOX_GAP_UNITS: number = 44;

/** How much shelf is on show, in the TV's units; the same as .shelf in the styles. */
const SHELF_WIDTH_UNITS: number = 1340;

/**
 * The shape of the box at a place on the shelf; shapes repeat, so any number of games can have one.
 * @param index the place.
 * @returns the shape.
 */
function boxShape(index: number): { height: number; tilt: number; width: number } {
    return BOX_SHAPES[index % BOX_SHAPES.length] ?? { height: 100, tilt: 0, width: 1 };
}

/**
 * How far to slide the shelf so the focused box stays in view, centred when there's room to be.
 * @param boxes how many boxes.
 * @param focus the focused box.
 * @returns the distance in the TV's units; 0 when everything fits.
 */
function shelfShift(boxes: number, focus: number): number {
    const widths: number[] = Array.from({ length: boxes }, (_unused: unknown, index: number) => boxShape(index).width * BOX_WIDTH_UNITS);
    const total: number = widths.reduce((sum: number, width: number) => sum + width, 0) + (boxes - 1) * BOX_GAP_UNITS;
    const before: number = widths.slice(0, focus).reduce((sum: number, width: number) => sum + width + BOX_GAP_UNITS, 0);
    const centre: number = before + (widths[focus] ?? 0) / 2;
    return Math.max(0, Math.min(total - SHELF_WIDTH_UNITS, centre - SHELF_WIDTH_UNITS / 2));
}

/** How many boxes fit on the shelf before it has to slide. */
const SHELF_BOXES_IN_VIEW: number = 4;

/** Names that fit in the table box above its label. */
const TABLE_BOX_NAMES: number = 4;

/**
 * A name flag hanging off whatever the driver has highlighted.
 * @param props the driver.
 * @returns the element, or null.
 */
function DriverFlag(props: { seat: Seat | undefined }): ReactElement | null {
    if (props.seat === undefined) {
        return null;
    }
    return <span className="driver-flag" style={{ background: props.seat.colour }}>{props.seat.name}</span>;
}

/**
 * Rows the phone moves through, with the highlight on one.
 * @param props the rows, the highlighted one, and who's driving.
 * @returns the element.
 */
function Rows(props: { rows: string[]; focus: number; driver: Seat | undefined; pointing: Pointing; muted?: number[] }): ReactElement {
    return (
        <ol className="rows">
            {props.rows.map((row: string, index: number) => (
                <li key={row} {...chooseProps(props.pointing, index)} className={`row ${index === props.focus ? "focused leaning" : ""} ${props.muted?.includes(index) === true ? "muted" : ""}`}>
                    {row}
                    {index === props.focus ? <DriverFlag seat={props.driver} /> : null}
                </li>
            ))}
        </ol>
    );
}

/**
 * The join tag: paper with the QR code and room code.
 * @param props the QR image, room code, and whether it's the main thing on screen.
 * @returns the element.
 */
export function JoinTag(props: { qr: string; code: string; big: boolean; joinHost: string }): ReactElement {
    return (
        <aside className={`join-tag ${props.big === true ? "big" : ""}`}>
            {props.qr !== "" ? <img src={props.qr} alt={`QR code to join room ${props.code}`} /> : <div className="qr-gap" />}
            <div>
                <strong>{props.code}</strong>
                <small>{props.joinHost}</small>
            </div>
        </aside>
    );
}

/**
 * The shelf: one box per game, then the box of who's at the table.
 * @param props the console, the join image, and the room code.
 * @returns the element.
 */
function Shelf(props: { shell: ShellView; driver: Seat | undefined; qr: string; code: string; joinHost: string; pointing: Pointing }): ReactElement {
    const { shell, driver, pointing } = props;
    const focused: ShelfGame | undefined = shell.games[shell.focus];
    const empty: boolean = shell.seats.length === 0;
    const boxCount: number = shell.games.length + (empty === true ? 0 : 1);
    return (
        <section className="screen shelf-screen">
            <img className="room-art" src="art/hero.webp" alt="" />
            <header className="shelf-heading" key={focused?.id ?? "players"}>
                {empty === true
                    ? <><h1>Pull up a chair.</h1><p>Scan the code with your phone. It becomes your controller.{pointing !== null ? <><br />No phone? Pick a box with your mouse.</> : null}</p></>
                    : <><h1>{focused?.name ?? "At the table"}</h1><p>{focused?.pitch ?? "See who's here, or add a player."}</p></>}
            </header>
            <div className={`shelf ${empty === true ? "dimmed" : ""}`}>
                <div className="shelf-rail" style={{ transform: `translateX(calc(${-shelfShift(boxCount, shell.focus)} * var(--u)))` }}>
                {shell.games.map((game: ShelfGame, index: number) => (
                    <div key={game.id} {...chooseProps(pointing, index)} className={`box ${index === shell.focus && empty === false ? "focused leaning" : ""}`} style={{ height: `${boxShape(index).height}%`, rotate: `${boxShape(index).tilt}deg`, width: `calc(${boxShape(index).width * BOX_WIDTH_UNITS} * var(--u))`, viewTransitionName: `box-${game.id}` }}>
                        <Poster id={game.id} art={game.art} />
                        <span className="box-name">{game.name}</span>
                        {index === shell.focus && empty === false ? <DriverFlag seat={driver} /> : null}
                    </div>
                ))}
                {empty === true ? null : <div {...chooseProps(pointing, shell.games.length)} className={`box table-box ${shell.focus === shell.games.length ? "focused leaning" : ""}`} style={{ height: `${boxShape(shell.games.length).height}%`, rotate: `${boxShape(shell.games.length).tilt}deg`, width: `calc(${boxShape(shell.games.length).width * BOX_WIDTH_UNITS} * var(--u))` }}>
                    <ul className="table-names">
                        {shell.seats.slice(0, TABLE_BOX_NAMES).map((seat: Seat) => <li key={seat.playerId} style={{ background: seat.colour }}>{seat.name}</li>)}
                        {shell.seats.length > TABLE_BOX_NAMES ? <li className="more">and {shell.seats.length - TABLE_BOX_NAMES} more</li> : null}
                    </ul>
                    <span className="box-name">At the table<small>Add a player</small></span>
                    {shell.focus === shell.games.length ? <DriverFlag seat={driver} /> : null}
                </div>}
                </div>
            </div>
            {pointing !== null && boxCount > SHELF_BOXES_IN_VIEW ? <>
                <button className="shelf-arrow previous" disabled={shell.focus === 0} aria-label="Earlier games" onClick={() => { pointing({ kind: "step", delta: -1 }); }}>‹</button>
                <button className="shelf-arrow next" disabled={shell.focus >= boxCount - 1} aria-label="Later games" onClick={() => { pointing({ kind: "step", delta: 1 }); }}>›</button>
            </> : null}
            <div className="plank" />
            <JoinTag qr={props.qr} code={props.code} big={empty} joinHost={props.joinHost} />
        </section>
    );
}

/**
 * A game's page: the box, what it is, how it's played, and how to start.
 * @param props the console and game.
 * @returns the element.
 */
function GamePage(props: { shell: ShellView; driver: Seat | undefined; game: ShelfGame; pointing: Pointing }): ReactElement {
    const { shell, game, driver } = props;
    return (
        <section className="screen game-screen">
            <img className="room-art" src="art/hero.webp" alt="" />
            <div className="cover" style={{ viewTransitionName: `box-${game.id}` }}><Poster id={game.id} art={game.art} /></div>
            <div className="about">
                <h1>{game.name}</h1>
                <p className="pitch">{game.pitch}</p>
                <ol className="steps">{game.howToPlay.map((line: string) => <li key={line}>{line}</li>)}</ol>
                <p className={`players-note ${game.blocked !== null ? "blocked" : ""}`}>{game.blocked ?? game.players}</p>
                <Rows rows={shell.menu} focus={shell.focus} driver={driver} pointing={props.pointing} {...(game.blocked !== null ? { muted: [0] } : {})} />
            </div>
        </section>
    );
}

/**
 * Who's at the table.
 * @param props the console.
 * @returns the element.
 */
function PlayersPage(props: { shell: ShellView; driver: Seat | undefined; qr: string; code: string; joinHost: string; pointing: Pointing }): ReactElement {
    const { shell, driver } = props;
    return (
        <section className={`screen players-screen ${shell.screen === "players" ? "" : "adding"}`}>
            <h1>{shell.screen === "addPlayer" ? "Add a player" : shell.screen === "addGuest" ? "Who's sitting in?" : shell.screen === "guestLine" ? "Who should sit down?" : shell.screen === "agentOnPhone" ? "Bring your agent" : shell.seats.length === 1 ? "Just you so far" : `${shell.seats.length} at the table`}</h1>
            <ul className="seats">
                {shell.seats.map((seat: Seat) => (
                    <li key={seat.playerId} className={seat.connected === false ? "away" : ""} style={{ background: seat.colour }}>
                        <strong>{seat.name}</strong>
                        <small>{seat.agent === true ? "AI agent" : seat.guest === true ? "AI guest" : seat.connected === false ? "Phone's asleep" : seat.driving === true ? "Has the controller" : ""}</small>
                    </li>
                ))}
            </ul>
            {shell.screen === "guestLine" ? <p className="players-hint">Describe them on {driver?.name ?? "your"}'s phone, in a line.</p> : null}
            {shell.screen === "agentOnPhone" ? <p className="players-hint">The link is on {driver?.name ?? "your"}'s phone. Paste it to your agent there.</p> : null}
            <p className="players-hint" hidden={shell.screen !== "players"}>Talk to {HOST_NAME} from your phone. Whoever slides next takes the controller. Anyone else can scan in.</p>
            {shell.screen === "players" ? <JoinTag qr={props.qr} code={props.code} big={false} joinHost={props.joinHost} /> : null}
            <Rows rows={shell.menu} focus={shell.focus} driver={driver} pointing={props.pointing} />
        </section>
    );
}

/**
 * The pause menu or the how-to-play card, over the game.
 * @param props the console, the game, and how to join.
 * @returns the element.
 */
export function PausePanel(props: { shell: ShellView; driver: Seat | undefined; game: ShelfGame | undefined; qr: string; code: string; joinHost: string; pointing: Pointing }): ReactElement {
    const { shell, driver, game } = props;
    return (
        <div className="pause-backing">
            {shell.screen === "pause" ? <JoinTag qr={props.qr} code={props.code} big={false} joinHost={props.joinHost} /> : null}
            <section className="pause-card">
                {shell.screen === "confirmEnd" ? <h2>End the game for everyone?</h2> : null}
                {shell.screen === "howTo"
                    ? <><h2>How to play {game?.name ?? ""}</h2><ol className="steps">{game?.howToPlay.map((line: string) => <li key={line}>{line}</li>)}</ol></>
                    : shell.screen === "pause" ? <h2>{shell.pausedBy === "" ? "Paused" : `Paused by ${shell.pausedBy}`}</h2> : null}
                <Rows rows={shell.menu} focus={shell.focus} driver={driver} pointing={props.pointing} />
            </section>
        </div>
    );
}

/**
 * What the TV shows while a game waits for everyone to come back.
 * @param props the join image, the room code and the address to join at.
 * @returns the element.
 */
export function SteppedOutPanel(props: { qr: string; code: string; joinHost: string }): ReactElement {
    return (
        <div className="pause-backing">
            <JoinTag qr={props.qr} code={props.code} big={false} joinHost={props.joinHost} />
            <section className="pause-card">
                <h2>Everyone's stepped out</h2>
                <p>Seats are held for a few minutes. Open your phone, or scan the code, to come back.</p>
            </section>
        </div>
    );
}

/**
 * The menu over a finished game.
 * @param props the console.
 * @returns the element.
 */
export function GameOverMenu(props: { shell: ShellView; driver: Seat | undefined; pointing: Pointing }): ReactElement {
    return <section className="over-card"><Rows rows={props.shell.menu} focus={props.shell.focus} driver={props.driver} pointing={props.pointing} /></section>;
}

/**
 * Draws whichever console page is showing; the play screen is drawn by the stage.
 * @param props the console, the join image, the room code and the address to join at.
 * @returns the element, or null during play.
 */
export function ConsolePage(props: { shell: ShellView; qr: string; code: string; joinHost: string; pointing: Pointing }): ReactElement | null {
    const { shell, pointing } = props;
    const driver: Seat | undefined = shell.seats.find((seat: Seat) => seat.driving === true);
    if (shell.screen === "home") {
        return <Shelf shell={shell} driver={driver} qr={props.qr} code={props.code} joinHost={props.joinHost} pointing={pointing} />;
    }
    const game: ShelfGame | undefined = shell.games.find((candidate: ShelfGame) => candidate.id === shell.gameId);
    if (shell.screen === "pick" && game?.startPick !== null && game?.startPick !== undefined) {
        return (
            <section className="screen pick-screen">
                <Poster className="room-art" id={game.id} art={game.art} />
                <header className="shelf-heading">
                    <h1>{game.startPick.prompt}</h1>
                    <p>{pointing !== null ? "Pick one." : "Slide and tap on your phone."} {HOST_NAME} takes what's highlighted if nobody chooses.</p>
                </header>
                <ul className="pick-boxes">
                    {shell.menu.map((label: string, index: number) => <li key={label} {...chooseProps(pointing, index)} className={index === shell.focus ? "focused" : ""}>{label}</li>)}
                </ul>
            </section>
        );
    }
    if (shell.screen === "startCard" && game !== undefined) {
        return (
            <section className="screen pick-screen">
                <Poster className="room-art" id={game.id} art={game.art} />
                <header className="shelf-heading"><h1>{game.name}</h1></header>
                <ol className="steps start-card">{game.startCard?.map((line: string) => <li key={line}>{line}</li>)}</ol>
                <p className="start-note">{driver === undefined ? "Starting soon." : `Starting soon. ${driver.name} can tap to start now.`}</p>
                {pointing !== null ? <button className="tv-button start-now" onClick={() => { pointing({ kind: "select" }); }}>{shell.menu[0] ?? "Start now"}</button> : null}
            </section>
        );
    }
    if (shell.screen === "game" && game !== undefined) {
        return <GamePage shell={shell} driver={driver} game={game} pointing={pointing} />;
    }
    if (shell.screen === "players" || shell.screen === "addPlayer" || shell.screen === "addGuest" || shell.screen === "guestLine" || shell.screen === "agentOnPhone") {
        return <PlayersPage shell={shell} driver={driver} qr={props.qr} code={props.code} joinHost={props.joinHost} pointing={pointing} />;
    }
    return null;
}

