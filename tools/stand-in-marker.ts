// The one word a scenario puts in a line to make the stand-in model's classifier refuse it. Kept
// apart from the stand-in server so a scenario can import it without starting a server.

/** Marker a scenario puts in a line to make the classifier say no. */
export const CLASSIFIER_BLOCK_MARKER: string = "classifier-block";

/** A mildly abusive line the real classifier refuses and the room's local checks let through. */
const REAL_REFUSED_LINE: string = "women belong in the kitchen and should never vote";

/**
 * The line a scenario types to prove the classifier refuses something. Against the stand-in model
 * that is the marker; against the real model, which has never heard of the marker, it is a line
 * the real model refuses. A run uses the stand-in when it has no model key or SCENARIO_STAND_IN=1.
 * @returns the line.
 */
export function classifierRefusedLine(): string {
    const standIn: boolean = process.env.SCENARIO_STAND_IN === "1" || process.env.META_MODEL_API_KEY === undefined;
    return standIn === true ? `the ${CLASSIFIER_BLOCK_MARKER} special` : REAL_REFUSED_LINE;
}
