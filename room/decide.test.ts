// The decision seam with a stub in place of Jev, so no key or network is involved.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { JevAnswer, JevAsk, JevQuestion } from "../providers/typesafe/jev.ts";
import { askJev } from "../providers/typesafe/jev.ts";
import { kindByRule, mergeAnswers, mergeIdenticalAnswers, utteranceKind } from "./decide.ts";

/**
 * A Jev that says two answers match when the pair is in the list.
 * @param same the pairs that match.
 * @returns the stub.
 */
function matching(same: [string, string][]): JevAsk {
    return (state: string): Promise<JevAnswer> => {
        const yes: boolean = same.some(([one, two]: [string, string]) => state.includes(`one: ${one}\n`) === true && state.endsWith(`two: ${two}`) === true);
        return Promise.resolve({ type: "noul", noul: yes === true ? 0.96 : 0.04 });
    };
}

const down: JevAsk = (): Promise<JevAnswer> => Promise.reject(new Error("down"));

test("takes the kind Jev gives", async () => {
    const asker: JevAsk = (_state: string, question: JevQuestion): Promise<JevAnswer> => {
        assert.equal(question.type, "choice");
        return Promise.resolve({ type: "choice", choice: "noise" });
    };
    assert.deepEqual(await utteranceKind("is it alive", asker), { value: "noise", source: "jev" });
});

test("falls back to the old rule when Jev is down, or names a kind that doesn't exist", async () => {
    assert.deepEqual(await utteranceKind("is it alive", down), { value: "question", source: "fallback" });
    assert.deepEqual(await utteranceKind("a banana", down), { value: "guess", source: "fallback" });
    const odd: JevAsk = () => Promise.resolve({ type: "choice", choice: "toString" });
    assert.deepEqual(await utteranceKind("a banana", odd), { value: "guess", source: "fallback" });
});

test("the rule reads questions the way the room always has", () => {
    assert.equal(kindByRule("how many doors"), "question");
    assert.equal(kindByRule("a penguin?"), "question");
    assert.equal(kindByRule("a penguin"), "guess");
});

test("merges what Jev says matches and keeps near-misses apart", async () => {
    const groups = await mergeAnswers("What's in the sky?", ["moon", "luna", "mars", "desert", "dessert"], matching([["moon", "luna"]]));
    assert.deepEqual(groups.map((group) => group.indexes), [[0, 1], [2], [3], [4]]);
    assert.equal(groups[0]?.answer, "moon");
});

test("identical answers merge without asking", async () => {
    let asked: number = 0;
    const counting: JevAsk = () => { asked += 1; return Promise.resolve({ type: "noul", noul: 0.9 }); };
    const groups = await mergeAnswers("", ["The Moon", "moon!", "a moon"], counting);
    assert.deepEqual(groups, [{ answer: "The Moon", indexes: [0, 1, 2] }]);
    assert.equal(asked, 0);
});

test("symbols and decimals that change the meaning aren't treated as identical", async () => {
    const groups = await mergeAnswers("", ["C++", "C#", "1.5", "15"], down);
    assert.equal(groups.length, 4);
});

test("an answer joins a group only if it matches everyone there", async () => {
    const groups = await mergeAnswers("", ["moon", "moonlight", "light"], matching([["moon", "moonlight"], ["moonlight", "light"]]));
    assert.deepEqual(groups.map((group) => group.indexes), [[0, 1], [2]]);
});

test("copies of a merged answer stay in its group", async () => {
    const groups = await mergeAnswers("", ["moon", "luna", "the moon", "mars"], matching([["moon", "luna"]]));
    assert.deepEqual(groups.map((group) => group.indexes), [[0, 1, 2], [3]]);
});

test("an outage only means fewer merges", async () => {
    const groups = await mergeAnswers("", ["moon", "the moon", "luna"], down);
    assert.deepEqual(groups.map((group) => group.indexes), [[0, 1], [2]]);
    assert.deepEqual(mergeIdenticalAnswers(["moon", "the moon", "luna"]).map((group) => group.indexes), [[0, 1], [2]]);
});

test("the question goes in the state when there is one", async () => {
    const states: string[] = [];
    const recording: JevAsk = (state: string) => { states.push(state); return Promise.resolve({ type: "noul", noul: 0 }); };
    await mergeAnswers("Red planet?", ["mars", "ares"], recording);
    assert.equal(states[0], "Question: Red planet?\nAnswer one: mars\nAnswer two: ares");
});

test("the client reads both answer shapes and refuses anything else, without quoting it", async () => {
    const realFetch: typeof fetch = globalThis.fetch;
    const replies: unknown[] = [
        { answers: { answer: { noul: 0.7 } } },
        { answers: { answer: { choice: "yes" } } },
        { answers: { answer: { choice: "secret words" } } },
    ];
    globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify(replies.shift())));
    try {
        assert.deepEqual(await askJev("text", { type: "noul", instructions: "q" }, 100), { type: "noul", noul: 0.7 });
        const choice: JevQuestion = { type: "choice", instructions: "q", criteria: { yes: "y", no: "n" } };
        assert.deepEqual(await askJev("text", choice, 100), { type: "choice", choice: "yes" });
        await assert.rejects(askJev("private words", choice, 100), (error: Error) => error.message.includes("private") === false && error.message.includes("secret") === false);
        globalThis.fetch = () => Promise.resolve(new Response("not json: private words"));
        await assert.rejects(askJev("private words", choice, 100), (error: Error) => error.message.includes("private") === false);
        globalThis.fetch = () => Promise.resolve(new Response("", { status: 500 }));
        await assert.rejects(askJev("private words", choice, 100), /500/);
    } finally {
        globalThis.fetch = realFetch;
    }
});
