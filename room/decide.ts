// Quick named judgments, each with a typed answer, a time limit and code to fall back on during an
// outage. Jev advises here: a win, a score, a vote or a secret is never decided this way, and only
// text that may leave the room comes in. The logs get a decision's name and source, never the text.

import { askJev, jevConfigured, type JevAsk } from "../providers/typesafe/jev.ts";
import type { AnswerGroup } from "../shared/timeline.ts";
import { log } from "./log.ts";
import { commandByKeywords, VOICE_COMMANDS, type VoiceCommand } from "./voice-commands.ts";

/** How long one decision may take before its fallback is used. */
const DECISION_TIME_LIMIT_MILLISECONDS: number = 800;

/** Probability of yes at which two answers count as the same. Near-misses came well under it in the benchmark. */
const SAME_ANSWER_PROBABILITY: number = 0.5;

/** How often to note that Jev isn't answering, so an outage doesn't fill the log. */
const FAILURE_LOG_GAP_MILLISECONDS: number = 60000;

/** Longest press worth asking about; commands are short, and longer talk goes straight to the host. */
const COMMAND_WORD_LIMIT: number = 8;

/** How sure Jev must be before a loose phrasing counts as a command, since a wrong one acts on the game. */
const COMMAND_CONFIDENCE: number = 0.8;

/** Most answers merged at once; a table holds twelve people. */
const MERGE_ANSWER_LIMIT: number = 16;

/** Decisions switched off on this server, comma separated, so a bad one can go without a code change. */
const SWITCHED_OFF: string[] = (process.env.JEV_DECISIONS_OFF ?? "").split(",").map((name: string) => name.trim());

/** What one press on a phone was. */
export type UtteranceKind = "question" | "guess" | "command" | "noise";

export type { AnswerGroup };

/** A decision's answer, and whether it came from Jev or the fallback. */
export interface Decision<Value> {
    value: Value;
    source: "jev" | "fallback";
}

/** How a spoken question usually starts, for when the transcript has no question mark. */
const QUESTION_START: RegExp = /^(who|what|when|where|why|how|which|is|are|am|was|were|do|does|did|can|could|will|would|should|has|have|had)\b/i;

/** The labels for an utterance, in the words the benchmark measured. */
const KIND_CRITERIA: Record<UtteranceKind, string> = {
    question: "A question for the host about the game or the thing being guessed, not naming a specific guess.",
    guess: "Names a specific thing as the answer or a guess at it.",
    command: "Tells the game or host to do something, like skip, start, pause or repeat.",
    noise: "Filler, garbled speech, or talk to another person rather than the host.",
};

/** The question behind merging, in the words the benchmark measured. */
const SAME_ANSWER_QUESTION: string = "Would players at a party game count these two answers as the same answer, allowing for spelling, articles, abbreviations and synonyms? Different things that merely look or sound alike are not the same.";

let lastFailureLoggedAt: number = 0;

/**
 * Runs one Jev question, or says it couldn't.
 * @param name the decision's name.
 * @param asker how Jev is being reached.
 * @param run the question.
 * @returns the answer, or null when the fallback should be used.
 */
async function ask<Value>(name: string, asker: JevAsk, run: () => Promise<Value>): Promise<Value | null> {
    if ((asker === askJev && jevConfigured() === false) || SWITCHED_OFF.includes(name) === true) {
        return null;
    }
    const startedAt: number = Date.now();
    try {
        const answer: Value = await run();
        log("decide", `${name} answered in ${Date.now() - startedAt} ms`);
        return answer;
    } catch {
        if (Date.now() - lastFailureLoggedAt >= FAILURE_LOG_GAP_MILLISECONDS) {
            lastFailureLoggedAt = Date.now();
            log("decide", `${name} fell back: Jev didn't answer`);
        }
        return null;
    }
}

/**
 * The regular expression the room used before Jev, kept for outages.
 * @param said what was said.
 * @returns question when it reads as one, else guess, which plays the same as any other statement.
 */
export function kindByRule(said: string): UtteranceKind {
    return said.trim().endsWith("?") === true || QUESTION_START.test(said.trim()) === true ? "question" : "guess";
}

/**
 * Decides what kind of thing a press on a phone was.
 * @param said the transcript.
 * @param asker how to reach Jev; tests pass a stub.
 * @returns the kind.
 */
export async function utteranceKind(said: string, asker: JevAsk = askJev): Promise<Decision<UtteranceKind>> {
    const answer = await ask("utterance-kind", asker, async () => asker(said, {
        type: "choice",
        instructions: "Players at a game of twenty questions talk to the host by holding their phones. This is a transcript of one press. What kind of utterance is it?",
        criteria: KIND_CRITERIA,
    }, DECISION_TIME_LIMIT_MILLISECONDS));
    if (answer?.type === "choice" && Object.hasOwn(KIND_CRITERIA, answer.choice) === true) {
        return { value: answer.choice as UtteranceKind, source: "jev" };
    }
    return { value: kindByRule(said), source: "fallback" };
}

/**
 * Decides whether a press was one of the room's voice commands. Sure phrasings need no model.
 * @param said the transcript.
 * @param askModel false to use only the sure phrasings.
 * @param asker how to reach Jev; tests pass a stub.
 * @returns the command, or null for ordinary talk, which goes to the host as usual.
 */
export async function voiceCommand(said: string, askModel: boolean, asker: JevAsk = askJev): Promise<Decision<VoiceCommand | null>> {
    const sure: VoiceCommand | null = commandByKeywords(said);
    if (sure !== null || askModel === false || said.trim().split(/\s+/).length > COMMAND_WORD_LIMIT) {
        return { value: sure, source: "fallback" };
    }
    const answer = await ask("voice-command", asker, async () => asker(said, {
        type: "choice",
        instructions: "Players at a party game talk to the host by holding their phones. This is a transcript of one press. Is it telling the game to do one of these things? Answers to a question, guesses and ordinary talk are none.",
        criteria: { ...VOICE_COMMANDS, none: "None of these: an answer, a guess, a question about the game, or ordinary talk." },
    }, DECISION_TIME_LIMIT_MILLISECONDS));
    if (answer?.type === "choice" && Object.hasOwn(VOICE_COMMANDS, answer.choice) === true && (answer.confidence ?? 0) >= COMMAND_CONFIDENCE) {
        return { value: answer.choice as VoiceCommand, source: "jev" };
    }
    return { value: null, source: answer === null ? "fallback" : "jev" };
}

/**
 * Reduces an answer to what can be compared without a model.
 * @param answer the answer.
 * @returns lower case, with no leading article and no punctuation at the ends, so "C++" and "C#", or "1.5" and "15", stay apart.
 */
function plainAnswer(answer: string): string {
    return answer.toLowerCase().replace(/\s+/g, " ").trim().replace(/^["'“‘]+/u, "").replace(/["'”’.,!?;:]+$/u, "").replace(/^(?:the|a|an) /, "");
}

/**
 * Merges answers that say the same thing. Identical answers merge in code; other pairs go to Jev,
 * and a pair with no answer in time stays apart, so an outage can only mean fewer merges. An answer
 * joins a group only if it matches everyone there, so "moon", "moonlight" and "light" can't chain.
 * Pass only text that has been through the content filter, and no player names.
 * @param question what was asked, or empty when there's no question to give.
 * @param answers the answers.
 * @param asker how to reach Jev; tests pass a stub.
 * @returns the groups, in order of first appearance.
 */
export async function mergeAnswers(question: string, answers: string[], asker: JevAsk = askJev): Promise<AnswerGroup[]> {
    const plain: string[] = answers.map(plainAnswer);
    const firsts: number[] = plain.flatMap((text: string, index: number) => (plain.indexOf(text) === index ? [index] : []));
    const checked: number[] = firsts.slice(0, MERGE_ANSWER_LIMIT);
    const pairs: [number, number][] = checked.flatMap((first: number, place: number) => checked.slice(place + 1).map((second: number): [number, number] => [first, second]));
    const heading: string = question.trim() === "" ? "" : `Question: ${question.trim()}\n`;
    const verdicts: boolean[] = await Promise.all(pairs.map(async ([first, second]: [number, number]) => {
        const state: string = `${heading}Answer one: ${answers[first] ?? ""}\nAnswer two: ${answers[second] ?? ""}`;
        const answer = await ask("same-answer", asker, async () => asker(state, { type: "noul", instructions: SAME_ANSWER_QUESTION }, DECISION_TIME_LIMIT_MILLISECONDS));
        return answer?.type === "noul" && answer.noul >= SAME_ANSWER_PROBABILITY;
    }));
    const same = (first: number, second: number): boolean => pairs.some(([one, two]: [number, number], place: number) => verdicts[place] === true && ((one === first && two === second) || (one === second && two === first)));
    const clusters: number[][] = [];
    for (const first of firsts) {
        const home: number[] | undefined = clusters.find((cluster: number[]) => cluster.every((member: number) => same(member, first)));
        if (home !== undefined) {
            home.push(first);
            continue;
        }
        clusters.push([first]);
    }
    return clusters.map((cluster: number[]) => {
        const indexes: number[] = plain.flatMap((text: string, index: number) => (cluster.some((member: number) => plain[member] === text) ? [index] : []));
        return { answer: answers[indexes[0] ?? 0] ?? "", indexes };
    }).sort((one: AnswerGroup, two: AnswerGroup) => (one.indexes[0] ?? 0) - (two.indexes[0] ?? 0));
}

/**
 * Merges answers with no model at all, for rehearsals and scripts.
 * @param answers the answers.
 * @returns the groups of identical answers.
 */
export function mergeIdenticalAnswers(answers: string[]): AnswerGroup[] {
    const plain: string[] = answers.map(plainAnswer);
    return plain.flatMap((text: string, index: number) => (plain.indexOf(text) === index ? [{ answer: answers[index] ?? "", indexes: plain.flatMap((other: string, place: number) => (other === text ? [place] : [])) }] : []));
}
