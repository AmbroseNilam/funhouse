// Checks the parts of an agent seat that don't need a room: another player's words can't become markup
// on the agent's page, the question's version moves only when the question does, and only readable text
// from the TV reaches the page.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Control, PhoneView } from "../shared/controls.ts";
import { AgentSeat, escaped, sceneLines } from "./agent.ts";

/**
 * A phone's view holding these controls.
 * @param controls the controls.
 * @returns the view.
 */
function viewOf(controls: Control[]): PhoneView {
    return { controls, pad: { watching: false } } as unknown as PhoneView;
}

test("another player's words can't become markup on the page", () => {
    assert.equal(escaped("<script>alert('x')</script> & \"more\""), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;more&quot;");
});

test("the version moves when the question changes, not on every refresh", () => {
    const seat: AgentSeat = new AgentSeat("p2");
    const box: Control = { type: "textInput", id: "card:1:0", prompt: "A bad name for a cat", maxLength: 30 };
    seat.see(viewOf([box]));
    const asked: number = seat.version;
    seat.see(viewOf([box]));
    assert.equal(seat.version, asked);
    seat.see(viewOf([{ type: "waiting", text: "Your card is in." }]));
    assert.notEqual(seat.version, asked);
    assert.equal(seat.ask(), null);
});

test("what's on the TV reaches the page as text, and a picture only as a note", () => {
    const lines: string[] = sceneLines({
        mood: "neutral",
        transition: "fade",
        blocks: [
            { type: "title", text: "Same Page", kicker: "Round 1" },
            { type: "caption", speaker: "Marlowe", text: "Write it down.", final: true },
            { type: "timer", seconds: 30, label: "to write", running: true },
            { type: "image", src: "/drawings/ABCD/secret-key" },
        ],
    });
    assert.deepEqual(lines, ["Round 1: Same Page", "Marlowe says: Write it down.", "30 seconds to write", "(A picture is on the TV.)"]);
    assert.equal(lines.join(" ").includes("secret-key"), false);
});
