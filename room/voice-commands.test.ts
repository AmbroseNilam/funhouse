// Spotting voice commands: sure phrasings without a model, loose ones through a stub of Jev.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { JevAnswer, JevAsk } from "../providers/typesafe/jev.ts";
import { voiceCommand } from "./decide.ts";
import { commandByKeywords } from "./voice-commands.ts";

const down: JevAsk = (): Promise<JevAnswer> => Promise.reject(new Error("down"));

test("knows each command in its sure phrasings", () => {
    const cases: Record<string, string> = {
        "Restart the game.": "restart", "okay let's start over": "restart", "new game please": "restart", "I give up": "giveUp", "We give up!": "giveUp",
        "change the topic": "changeTopic", "say that again": "repeat", "skip this question": "skip", "Marlowe, end the game": "end", "pause the game": "pause", "whose turn is it?": "whoseTurn",
    };
    for (const [said, command] of Object.entries(cases)) {
        assert.equal(commandByKeywords(said), command, said);
    }
});

test("leaves talk and short answers alone", () => {
    for (const said of ["stop", "skip", "pause", "repeat", "pause in the middle", "is it a new game console", "I never give up on my dreams", "a restart button", "repeat offender", "next", "the end", "is it something you would pause"]) {
        assert.equal(commandByKeywords(said), null, said);
    }
});

test("asks Jev about loose phrasings only when allowed", async () => {
    const sure: JevAsk = () => Promise.resolve({ type: "choice", choice: "restart", confidence: 0.95 });
    assert.deepEqual(await voiceCommand("can we go again from the top", true, sure), { value: "restart", source: "jev" });
    assert.deepEqual(await voiceCommand("can we go again from the top", false, sure), { value: null, source: "fallback" });
});

test("an unsure or unknown answer is ordinary talk, and so is an outage", async () => {
    const unsure: JevAsk = () => Promise.resolve({ type: "choice", choice: "end", confidence: 0.5 });
    assert.equal((await voiceCommand("that's enough of this", true, unsure)).value, null);
    const none: JevAsk = () => Promise.resolve({ type: "choice", choice: "none", confidence: 0.99 });
    assert.equal((await voiceCommand("a banana", true, none)).value, null);
    const odd: JevAsk = () => Promise.resolve({ type: "choice", choice: "toString", confidence: 0.99 });
    assert.equal((await voiceCommand("a banana", true, odd)).value, null);
    assert.deepEqual(await voiceCommand("a banana", true, down), { value: null, source: "fallback" });
    assert.deepEqual(await voiceCommand("restart the game", true, down), { value: "restart", source: "fallback" });
});

test("long talk isn't sent to Jev", async () => {
    let asked: number = 0;
    const counting: JevAsk = () => { asked += 1; return Promise.resolve({ type: "choice", choice: "none", confidence: 1 }); };
    await voiceCommand("so I was thinking we might try something else after this round is over", true, counting);
    assert.equal(asked, 0);
});
