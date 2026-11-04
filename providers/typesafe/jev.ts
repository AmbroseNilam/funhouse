// Client for TypeSafe AI's Jev, a model that answers typed questions with probabilities instead of
// writing text. Used for quick judgments where a wrong answer costs little; see room/decide.ts.
// Nothing here logs or quotes what it is asked, since that can be what a player said.

/** Where Jev is. */
const JEV_URL: string = process.env.JEV_URL ?? "https://api.typesafe.ai/v1/systemone";

/** The version the benchmark in the planning notes measured. */
const JEV_MODEL: string = process.env.JEV_MODEL ?? "jev-1.14.0";

/** One question to Jev. */
export type JevQuestion =
    | { type: "noul"; instructions: string }
    | { type: "choice"; instructions: string; criteria: Record<string, string> };

/** Jev's answer: a probability of yes, or the label it picked. */
export type JevAnswer = { type: "noul"; noul: number } | { type: "choice"; choice: string };

/** Asks one question about a piece of text. Anything but an answer throws. */
export type JevAsk = (state: string, question: JevQuestion, timeoutMilliseconds: number) => Promise<JevAnswer>;

/**
 * Whether Jev can be asked at all on this server.
 * @returns true when there is a key.
 */
export function jevConfigured(): boolean {
    return (process.env.JEV_API_KEY ?? "").trim() !== "";
}

/**
 * Asks Jev one question.
 * @param state the text to judge.
 * @param question the question.
 * @param timeoutMilliseconds how long to wait.
 * @returns the answer.
 * @throws Error on a missing key, a timeout, a refused call or a badly shaped answer. The message
 * never quotes the request or the response.
 */
export const askJev: JevAsk = async (state: string, question: JevQuestion, timeoutMilliseconds: number): Promise<JevAnswer> => {
    const response: Response = await fetch(JEV_URL, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMilliseconds),
        headers: { authorization: `Bearer ${(process.env.JEV_API_KEY ?? "").trim()}`, "content-type": "application/json" },
        body: JSON.stringify({ state, model: JEV_MODEL, questions: { answer: question } }),
    });
    if (response.ok === false) {
        await response.body?.cancel();
        throw new Error(`Jev responded ${response.status}.`);
    }
    const parsed = await response.json() as { answers?: { answer?: { noul?: unknown; choice?: unknown } } };
    const answer: { noul?: unknown; choice?: unknown } | undefined = parsed.answers?.answer;
    if (question.type === "noul" && typeof answer?.noul === "number") {
        return { type: "noul", noul: answer.noul };
    }
    if (question.type === "choice" && typeof answer?.choice === "string" && question.criteria[answer.choice] !== undefined) {
        return { type: "choice", choice: answer.choice };
    }
    throw new Error("Jev returned an answer of an unexpected shape.");
};
