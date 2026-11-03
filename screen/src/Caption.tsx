// The paper slip beside the lantern: what was just said. Long replies are shown a phrase at a
// time, at about the pace they're spoken, since two lines is all anyone reads across a room.

import { useEffect, useState, type ReactElement } from "react";

/** Characters that fit on the slip's two lines. */
const SLIP_CHARACTERS: number = 96;

/** Speaking pace, for moving on to the next phrase. */
const CHARACTERS_PER_SECOND: number = 15;

/**
 * Splits words into phrases that fit on the slip, breaking at sentences where possible.
 * @param text the words.
 * @returns the phrases, in order.
 */
function phrases(text: string): string[] {
    const sentences: string[] = text.match(/[^.?!]+[.?!]*\s*/g)?.map((part: string) => part.trim()) ?? [text];
    const out: string[] = [];
    for (const sentence of sentences) {
        const last: string | undefined = out.at(-1);
        if (last !== undefined && last.length + sentence.length + 1 <= SLIP_CHARACTERS) {
            out[out.length - 1] = `${last} ${sentence}`;
            continue;
        }
        let rest: string = sentence;
        while (rest.length > SLIP_CHARACTERS) {
            const cut: number = rest.lastIndexOf(" ", SLIP_CHARACTERS);
            out.push(rest.slice(0, cut));
            rest = rest.slice(cut + 1);
        }
        out.push(rest);
    }
    return out;
}

/**
 * The slip.
 * @param props who said what, and whether they're still saying it.
 * @returns the element, or null when nothing has been said.
 */
export function Caption(props: { speaker: string; text: string; final: boolean; host: boolean }): ReactElement | null {
    const [index, setIndex] = useState<number>(0);
    const parts: string[] = props.final === true && props.host === true ? phrases(props.text) : [props.text.slice(-SLIP_CHARACTERS)];
    const current: string = parts[Math.min(index, parts.length - 1)] ?? "";

    useEffect(() => { setIndex(0); }, [props.text]);

    useEffect(() => {
        if (index >= parts.length - 1) {
            return;
        }
        const timer: number = window.setTimeout(() => { setIndex(index + 1); }, (current.length / CHARACTERS_PER_SECOND) * 1000);
        return (): void => { window.clearTimeout(timer); };
    }, [index, parts.length, current]);

    if (props.text === "") {
        return null;
    }
    return (
        <p className={`slip ${props.host === true ? "from-host" : ""}`} key={`${props.speaker}:${props.text.slice(0, 12)}`}>
            {props.host === true ? null : <strong>{props.speaker}</strong>}
            {current}
        </p>
    );
}
