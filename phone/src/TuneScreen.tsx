// A page for trying how the bands of lamplight respond to a voice, at /phone/?tune=1. Hold the
// surface, talk and move the sliders. It joins no room and sends nothing. The phone keeps what's
// chosen, and the line of numbers can be copied into the defaults in talkGlow.ts.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement } from "react";
import { startMicrophone, type MicrophoneCapture } from "./microphone.ts";
import { DEFAULT_TALK_TUNING, followVoice, loadTalkTuning, saveTalkTuning, talkGlowStyle, type TalkTuning } from "./talkGlow.ts";

/** One slider. */
interface Slider {
    key: keyof TalkTuning;
    label: string;
    min: number;
    max: number;
    step: number;
}

/** The sliders, in the order they appear. */
const SLIDERS: Slider[] = [
    { key: "size", label: "Size", min: 0.1, max: 0.96, step: 0.02 },
    { key: "rise", label: "Rise", min: 20, max: 400, step: 10 },
    { key: "fall", label: "Fall", min: 100, max: 1500, step: 50 },
    { key: "strength", label: "Strength", min: 0.3, max: 1, step: 0.05 },
];

/** The colour behind the bands, one of the seat colours. */
const SEAT_COLOUR: string = "#a85a38";

/** The tuning page. */
export function TuneScreen(): ReactElement {
    const [tuning, setTuning] = useState<TalkTuning>(loadTalkTuning);
    const [holding, setHolding] = useState<boolean>(false);
    const [problem, setProblem] = useState<string>("");
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const captureRef = useRef<MicrophoneCapture | null>(null);

    useEffect(() => (): void => { captureRef.current?.stop(); }, []);

    useEffect(() => {
        const surface: HTMLDivElement | null = surfaceRef.current;
        if (holding === false || surface === null) {
            return;
        }
        return followVoice(surface, () => captureRef.current?.level() ?? 0, tuning);
    }, [holding, tuning]);

    const change = (next: TalkTuning): void => {
        setTuning(next);
        saveTalkTuning(next);
    };

    const press = (event: PointerEvent<HTMLDivElement>): void => {
        const surface: HTMLDivElement = event.currentTarget;
        const box: DOMRect = surface.getBoundingClientRect();
        surface.setPointerCapture(event.pointerId);
        surface.style.setProperty("--thumb-x", `${event.clientX - box.left}px`);
        surface.style.setProperty("--thumb-y", `${event.clientY - box.top}px`);
        setHolding(true);
        if (captureRef.current !== null) {
            void captureRef.current.resume();
            return;
        }
        startMicrophone(() => { /* this page sends nothing */ }).then((capture: MicrophoneCapture) => {
            captureRef.current = capture;
            setProblem("");
        }).catch(() => { setProblem("The mic isn't allowed, so the bands can't move."); });
    };

    const release = (): void => { setHolding(false); };

    return (
        <main className={`pad-screen ${holding === true ? "talking" : ""}`} style={{ "--seat": SEAT_COLOUR } as CSSProperties}>
            <section className="tune-panel">
                {SLIDERS.map((slider: Slider) => (
                    <label key={slider.key} className="tune-row">
                        <span>{slider.label}</span>
                        <input
                            type="range"
                            min={slider.min}
                            max={slider.max}
                            step={slider.step}
                            value={tuning[slider.key]}
                            onChange={(event) => { change({ ...tuning, [slider.key]: Number(event.target.value) }); }}
                        />
                        <b>{tuning[slider.key]}</b>
                    </label>
                ))}
                <div className="tune-foot">
                    <small>This page sends nothing, and this phone keeps your settings.</small>
                    <button onClick={() => { change(DEFAULT_TALK_TUNING); }}>Reset</button>
                </div>
            </section>
            <div className="surface" ref={surfaceRef} style={talkGlowStyle(tuning)} onPointerDown={press} onPointerUp={release} onPointerCancel={release}>
                <div className="bands" aria-hidden="true"><i /><i /><i /></div>
                <div className="line" aria-live="polite">
                    <strong>{holding === true ? "Listening" : "Hold here and talk"}</strong>
                    {problem !== "" ? <small>{problem}</small> : null}
                </div>
            </div>
        </main>
    );
}
