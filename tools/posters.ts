// Draws candidate shelf posters with Muse Image, two per game, into a scratch folder. It spends
// about a cent a picture, so it draws only what it is told to.
// Usage: node --env-file=.env tools/posters.ts <outDir> [gameId ...]   (no ids: every game)
// Posters are drawn once, here, and the chosen ones are committed; nothing draws art at runtime.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drawImage } from "../providers/meta/image.ts";

/** Candidates drawn per game. */
const CANDIDATES: number = 2;

/** Pictures drawn at once. */
const BATCH: number = 6;

/** The look every poster shares. */
const STYLE: string = "A square game-box poster, painted storybook gouache on warm paper, soft visible brush texture. Dark warm night palette: deep ink brown background, aged paper cream, lamp amber, brass gold, a little wine red. One small brass lantern in the scene gives a warm amber glow that lights the main object, and it is the only light. One central subject, simple bold shapes, lots of calm dark space, slightly worn card edges. Original design, no real brands.";

/** What every poster must not contain. */
const RULE: string = "No faces, no people, no text, no letters, no numbers, no logos, no borders with writing.";

/** One scene per game, keyed by game id. */
export const SCENES: Record<string, string> = {
    twentyDoors: "A long dim hallway of many small wooden doors, one door ajar spilling amber light, the lantern on the floor",
    quizmaster: "A round brass bell and an open book on a small table, question-mark shaped brass curls of smoke, the lantern beside them",
    werewolf: "A small village of crooked rooftops under a huge full moon, a single wolf silhouette on a hill, the lantern in one window",
    leadingQuestions: "A winding trail of small paper question-mark cutouts leading toward a glowing lantern at the end of a dark path",
    whoFits: "Four mismatched hats on a row of brass pegs, one hat in the amber light, the lantern hanging above",
    twoTakes: "Two identical teacups side by side, one steaming, one empty, a lantern glowing between them",
    pastTheGate: "A tall iron garden gate with a keyhole-shaped opening, a lantern glowing on the other side of the bars",
    offByAMile: "A brass compass and a tape measure unrolled across a map on a table, the lantern close by, nearly-right distance markers",
    mindTheGap: "A narrow gap between two stone steps with a small bridge of paper, the lantern glowing in the gap",
    tinCanTelephone: "Two tin cans joined by a long string stretching across a dark room, the lantern glowing at the middle of the string",
    wrongRoom: "A cozy parlor where one armchair is upside down on the ceiling, a lantern on a side table, everything else normal",
    strayWord: "A single paper scrap blowing away from a stack of neat papers, tumbling past a lantern",
    underTheCup: "A stack of dice beneath a lifted teacup, the cup tilted, lantern glow spilling onto the dice",
    magpiePockets: "A magpie-black bird perched on a coat pocket stuffed with shiny trinkets, buttons and keys, a lantern beside",
    nameTag: "A row of blank paper name tags pinned on a velvet curtain, one glowing in lantern light",
    coldRead: "A dim table with a tarot-like fan of blank paper cards and a crystal ball-less brass lamp, the lantern glowing over the cards",
    blankVerdict: "A wooden judge's gavel resting on a stack of blank paper verdict slips, lantern light on them",
    lonelyClues: "A single magnifying glass over a lone paper clue on a vast dark table, the lantern next to it",
    pantomimePanic: "A pair of white gloves in a dramatic mid-gesture pose on a small theater stage, tiny red curtains, lantern as the footlight",
    blankTruth: "A single sheet of paper with a blank gap cut in the middle, a ribbon marker and a lantern shining through the gap",
    ghostWriter: "A feather quill writing by itself on parchment, a sheet draped as a ghost in the shadows, a lantern glowing near the page",
    paintedWhispers: "A long paint-splashed canvas on an easel dripping colors, a cupped paper whisper trumpet, the lantern beside it",
    samePage: "Many neat stacks of blank paper answer cards on a dark table, all cards the same, with one lone card set apart wearing a tiny pointed party hat, lantern glowing nearby",
    threeClaims: "Three blank paper slips laid in a row on a dark table, the middle one turned over with a slightly singed curled edge, the lantern glowing behind them",
    clueGallery: "A dim art gallery wall with empty golden frames hung in a row, a lantern on a stand lighting one frame",
};

/** A second colour some games add so the ones side by side on the shelf stay apart. */
const ACCENTS: Record<string, string> = {
    quizmaster: "Cool teal-green night background and teal shadows, lantern amber still warm",
    werewolf: "Cold silver-blue moonlight and deep indigo shadows, only the lantern window amber",
    pastTheGate: "Deep forest-green night background, mossy greens, brass keyhole glowing",
    samePage: "Dusty plum and rose background tones with cream paper",
    threeClaims: "Wine-red velvet table and deep crimson shadows with cream paper slips",
};

/**
 * Draws the candidates for the chosen games.
 * @param out folder to write to.
 * @param ids which games.
 */
async function main(out: string, ids: string[]): Promise<void> {
    mkdirSync(out, { recursive: true });
    const jobs: { id: string; n: number }[] = ids.flatMap((id: string) => Array.from({ length: CANDIDATES }, (_unused: unknown, n: number) => ({ id, n: n + 1 })));
    for (let start = 0; start < jobs.length; start += BATCH) {
        await Promise.all(jobs.slice(start, start + BATCH).map(async (job: { id: string; n: number }) => {
            const scene: string | undefined = SCENES[job.id];
            if (scene === undefined) {
                console.log(`${job.id}: no scene`);
                return;
            }
            try {
                const drawing = await drawImage(`${STYLE} ${ACCENTS[job.id] === undefined ? "" : `Colour: ${ACCENTS[job.id]}. `}Scene: ${scene}. ${RULE}`);
                writeFileSync(join(out, `${job.id}-${job.n}.${drawing.mediaType.split("/")[1] ?? "webp"}`), drawing.bytes);
                console.log(`${job.id}-${job.n}: ok`);
            } catch (error: unknown) {
                console.log(`${job.id}-${job.n}: failed ${(error as Error).message}`);
            }
        }));
    }
}

const [out, ...rest] = process.argv.slice(2);
if (out !== undefined) {
    await main(out, rest.length > 0 ? rest : Object.keys(SCENES));
}
