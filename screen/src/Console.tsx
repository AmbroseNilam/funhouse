// The console's screens, drawn from what the room says: the shelf of game boxes, a game's page,
// who's at the table, and the pause menu. Nothing here decides anything. Text is written for
// reading across a room, and every screen is driven only from the phone.

import type { ReactElement } from "react";
import { HOST_NAME } from "../../shared/brand.ts";
import type { Seat, ShelfGame, ShellView } from "../../shared/shell.ts";

/** Slightly different box shapes, so the shelf reads as objects and not a grid. */
const BOX_SHAPES: { height: number; tilt: number; width: number }[] = [{ height: 92, tilt: -1.2, width: 1.1 }, { height: 100, tilt: 0.8, width: 1 }, { height: 88, tilt: -0.6, width: 0.95 }, { height: 76, tilt: 1.4, width: 0.75 }];

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
function Rows(props: { rows: string[]; focus: number; driver: Seat | undefined; muted?: number[] }): ReactElement {
    return (
        <ol className="rows">
            {props.rows.map((row: string, index: number) => (
                <li key={row} className={`row ${index === props.focus ? "focused leaning" : ""} ${props.muted?.includes(index) === true ? "muted" : ""}`}>
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
function Shelf(props: { shell: ShellView; driver: Seat | undefined; qr: string; code: string; joinHost: string }): ReactElement {
    const { shell, driver } = props;
    const focused: ShelfGame | undefined = shell.games[shell.focus];
    const empty: boolean = shell.seats.length === 0;
    return (
        <section className="screen shelf-screen">
            <img className="room-art" src="art/hero.webp" alt="" />
            <header className="shelf-heading" key={focused?.id ?? "players"}>
                {empty === true
                    ? <><h1>Pull up a chair.</h1><p>Scan the code with your phone. It becomes your controller.</p></>
                    : <><h1>{focused?.name ?? "At the table"}</h1><p>{focused?.pitch ?? "See who's here."}</p></>}
            </header>
            <div className={`shelf ${empty === true ? "dimmed" : ""}`}>
                {shell.games.map((game: ShelfGame, index: number) => (
                    <div key={game.id} className={`box ${index === shell.focus && empty === false ? "focused leaning" : ""}`} style={{ height: `${BOX_SHAPES[index]?.height ?? 90}%`, rotate: `${BOX_SHAPES[index]?.tilt ?? 0}deg`, flexGrow: BOX_SHAPES[index]?.width ?? 1, viewTransitionName: `box-${game.id}` }}>
                        <img src={game.art} alt="" />
                        <span className="box-name">{game.name}</span>
                        {index === shell.focus && empty === false ? <DriverFlag seat={driver} /> : null}
                    </div>
                ))}
                <div className={`box table-box ${shell.focus === shell.games.length && empty === false ? "focused leaning" : ""}`} style={{ height: `${BOX_SHAPES[3]?.height ?? 80}%`, rotate: `${BOX_SHAPES[3]?.tilt ?? 0}deg`, flexGrow: BOX_SHAPES[3]?.width ?? 1 }}>
                    <ul className="table-names">
                        {shell.seats.slice(0, TABLE_BOX_NAMES).map((seat: Seat) => <li key={seat.playerId} style={{ background: seat.colour }}>{seat.name}</li>)}
                        {shell.seats.length > TABLE_BOX_NAMES ? <li className="more">and {shell.seats.length - TABLE_BOX_NAMES} more</li> : null}
                    </ul>
                    <span className="box-name">At the table</span>
                    {shell.focus === shell.games.length && empty === false ? <DriverFlag seat={driver} /> : null}
                </div>
            </div>
            <div className="plank" />
            <JoinTag qr={props.qr} code={props.code} big={empty} joinHost={props.joinHost} />
            <small className="credit">Art made with Muse Image</small>
        </section>
    );
}

/**
 * A game's page: the box, what it is, how it's played, and how to start.
 * @param props the console and game.
 * @returns the element.
 */
function GamePage(props: { shell: ShellView; driver: Seat | undefined; game: ShelfGame }): ReactElement {
    const { shell, game, driver } = props;
    return (
        <section className="screen game-screen">
            <img className="room-art" src="art/hero.webp" alt="" />
            <div className="cover" style={{ viewTransitionName: `box-${game.id}` }}><img src={game.art} alt="" /></div>
            <div className="about">
                <h1>{game.name}</h1>
                <p className="pitch">{game.pitch}</p>
                <ol className="steps">{game.howToPlay.map((line: string) => <li key={line}>{line}</li>)}</ol>
                <p className={`players-note ${game.blocked !== null ? "blocked" : ""}`}>{game.blocked ?? game.players}</p>
                <Rows rows={shell.menu} focus={shell.focus} driver={driver} {...(game.blocked !== null ? { muted: [0] } : {})} />
            </div>
        </section>
    );
}

/**
 * Who's at the table.
 * @param props the console.
 * @returns the element.
 */
function PlayersPage(props: { shell: ShellView; driver: Seat | undefined }): ReactElement {
    const { shell, driver } = props;
    return (
        <section className="screen players-screen">
            <h1>{shell.seats.length === 1 ? "Just you so far" : `${shell.seats.length} at the table`}</h1>
            <ul className="seats">
                {shell.seats.map((seat: Seat) => (
                    <li key={seat.playerId} className={seat.connected === false ? "away" : ""} style={{ background: seat.colour }}>
                        <strong>{seat.name}</strong>
                        <small>{seat.connected === false ? "Phone's asleep" : seat.driving === true ? "Has the controller" : "Sitting down"}</small>
                    </li>
                ))}
            </ul>
            <p className="players-hint">{HOST_NAME} can hear everyone. Whoever slides next takes the controller.</p>
            <Rows rows={shell.menu} focus={shell.focus} driver={driver} />
        </section>
    );
}

/**
 * The pause menu or the how-to-play card, over the game.
 * @param props the console and game.
 * @returns the element.
 */
export function PausePanel(props: { shell: ShellView; driver: Seat | undefined; game: ShelfGame | undefined }): ReactElement {
    const { shell, driver, game } = props;
    return (
        <div className="pause-backing">
            <section className="pause-card">
                {shell.screen === "howTo"
                    ? <><h2>How to play {game?.name ?? ""}</h2><ol className="steps">{game?.howToPlay.map((line: string) => <li key={line}>{line}</li>)}</ol></>
                    : <h2>Paused</h2>}
                <Rows rows={shell.menu} focus={shell.focus} driver={driver} />
            </section>
        </div>
    );
}

/**
 * The menu over a finished game.
 * @param props the console.
 * @returns the element.
 */
export function GameOverMenu(props: { shell: ShellView; driver: Seat | undefined }): ReactElement {
    return <section className="over-card"><Rows rows={props.shell.menu} focus={props.shell.focus} driver={props.driver} /></section>;
}

/**
 * Draws whichever console page is showing; the play screen is drawn by the stage.
 * @param props the console, the join image, the room code and the address to join at.
 * @returns the element, or null during play.
 */
export function ConsolePage(props: { shell: ShellView; qr: string; code: string; joinHost: string }): ReactElement | null {
    const { shell } = props;
    const driver: Seat | undefined = shell.seats.find((seat: Seat) => seat.driving === true);
    if (shell.screen === "home") {
        return <Shelf shell={shell} driver={driver} qr={props.qr} code={props.code} joinHost={props.joinHost} />;
    }
    const game: ShelfGame | undefined = shell.games.find((candidate: ShelfGame) => candidate.id === shell.gameId);
    if (shell.screen === "game" && game !== undefined) {
        return <GamePage shell={shell} driver={driver} game={game} />;
    }
    if (shell.screen === "players") {
        return <PlayersPage shell={shell} driver={driver} />;
    }
    return null;
}

