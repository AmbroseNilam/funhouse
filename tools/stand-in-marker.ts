// The one word a scenario puts in a line to make the stand-in model's classifier refuse it. Kept
// apart from the stand-in server so a scenario can import it without starting a server.

/** Marker a scenario puts in a line to make the classifier say no. */
export const CLASSIFIER_BLOCK_MARKER: string = "classifier-block";
