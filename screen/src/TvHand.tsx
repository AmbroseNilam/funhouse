// What a phone would show in someone's hand, drawn on the TV for a seated visitor with no phone:
// answer buttons, a small box to type in, and a line to the host. Only for games with nothing
// secret in the hand, since everyone in the room can see this screen.

import { useState, type FormEvent, type ReactElement } from "react";
import { HOST_NAME } from "../../shared/brand.ts";
import type { Control } from "../../shared/controls.ts";
import type { PhoneMessage } from "../../shared/protocol.ts";

/** Games whose hand holds nothing the rest of the table mustn't see. */
const OPEN_HAND_GAMES: string[] = ["quizmaster", "twentyDoors", "samePage"];

/** Games where everyone answers blind, so the room mustn't read this seat's answer as it's typed. */
const HIDDEN_ANSWER_GAMES: string[] = ["samePage"];

/** How many buttons make a question multiple choice. */
const MULTIPLE_CHOICE_OPTIONS: number = 4;

/** Longest line to the host, the same as the phone's box. */
const LINE_CHARACTER_LIMIT: number = 200;

/**
 * A box to type one answer or line in.
 * @param props the prompt, field limits, and what to do with the words.
 * @returns the element.
 */
function TypeBox(props: { prompt: string; note?: string; placeholder: string; maxLength: number; numeric: boolean; hidden?: boolean; send: (value: string) => void }): ReactElement {
    const [typed, setTyped] = useState<string>("");
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (typed.trim() === "") {
            return;
        }
        props.send(typed);
        setTyped("");
    };
    return (
        <form className="hand-type" onSubmit={submit}>
            {props.note !== undefined ? <p role="alert">{props.note}</p> : null}
            <label>
                <span>{props.prompt}</span>
                <input value={typed} type={props.numeric === true ? "number" : props.hidden === true ? "password" : "text"} maxLength={props.maxLength} placeholder={props.placeholder} autoComplete="off" onChange={(event) => { setTyped(event.target.value); }} />
            </label>
            <button className="tv-button" type="submit">Send it</button>
        </form>
    );
}

/**
 * A slider, answered once.
 * @param props the control and how to send it.
 * @returns the element.
 */
function SlideBox(props: { control: Extract<Control, { type: "slider" }>; send: (message: PhoneMessage) => void }): ReactElement {
    const { control } = props;
    const step: number = control.step ?? 1;
    const [value, setValue] = useState<number>(control.min + Math.round((control.max - control.min) / 2 / step) * step);
    return (
        <div className="hand-type">
            <label><span>{control.prompt}: {value}</span><input type="range" min={control.min} max={control.max} step={step} value={value} onChange={(event) => { setValue(Number(event.target.value)); }} /></label>
            <button className="tv-button" onClick={() => { props.send({ type: "answer", controlId: control.id, value }); }}>Send it</button>
        </div>
    );
}

/**
 * Draws one control.
 * @param control the control.
 * @param index its place, sent back with a button press.
 * @param send sends a message to the room.
 * @param hideTyping true when an answer must not show on the screen as it is typed.
 * @returns the element, or null for what has no place here.
 */
function renderControl(control: Control, index: number, send: (message: PhoneMessage) => void, hideTyping: boolean): ReactElement | null {
    if (control.type === "buttons" || control.type === "choice") {
        return (
            <div key={index} className="hand-buttons">
                {control.prompt !== undefined ? <p>{control.prompt}</p> : null}
                {control.options.map((option) => <button key={option.id} className="tv-button" disabled={option.disabled === true} onClick={() => { send({ type: "input", input: { value: option.id, controlIndex: index } }); }}>{option.label}</button>)}
            </div>
        );
    }
    if (control.type === "textInput") {
        return <TypeBox key={control.id} prompt={control.prompt} {...(control.note !== undefined ? { note: control.note } : {})} placeholder={control.placeholder ?? ""} maxLength={control.maxLength} numeric={false} hidden={hideTyping} send={(value: string) => { send({ type: "answer", controlId: control.id, value }); }} />;
    }
    if (control.type === "numberInput") {
        return <TypeBox key={control.id} prompt={control.prompt} {...(control.note !== undefined ? { note: control.note } : {})} placeholder="" maxLength={20} numeric={true} send={(value: string) => { send({ type: "answer", controlId: control.id, value: Number(value) }); }} />;
    }
    if (control.type === "slider") {
        return <SlideBox key={control.id} control={control} send={send} />;
    }
    if (control.type === "waiting" || (control.type === "notice" && control.tone !== "secret")) {
        return <p key={index} className="hand-note">{control.text}</p>;
    }
    return null;
}

/**
 * The hand on the TV.
 * @param props the running game, the seat's controls, and how to send.
 * @returns the element.
 */
export function TvHand(props: { gameId: string | null; controls: Control[]; send: (message: PhoneMessage) => void }): ReactElement {
    if (OPEN_HAND_GAMES.includes(props.gameId ?? "") === false) {
        return <section className="tv-hand"><p className="hand-note">This one has secrets, so it needs a phone. Scan the code to play.</p></section>;
    }
    const asking: boolean = props.controls.some((control: Control) => control.type === "textInput" || control.type === "numberInput");
    // Four answers on show leave no room for a second way to answer, and these are the ones to click.
    const multipleChoice: boolean = props.controls.some((control: Control) => control.type === "buttons" && control.options.length >= MULTIPLE_CHOICE_OPTIONS);
    return (
        <section className="tv-hand">
            {props.controls.map((control: Control, index: number) => renderControl(control, index, props.send, HIDDEN_ANSWER_GAMES.includes(props.gameId ?? "")))}
            {asking === true || multipleChoice === true ? null : <TypeBox prompt={`Tell ${HOST_NAME}`} placeholder="Type here" maxLength={LINE_CHARACTER_LIMIT} numeric={false} send={(text: string) => { props.send({ type: "typed", text }); }} />}
        </section>
    );
}
