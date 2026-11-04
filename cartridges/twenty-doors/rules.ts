// Twenty Doors' rules core. The secret comes from a list here, which only the host is told: asked
// to choose one, the model said garlic press 6 times in 8, so a second game would repeat the first.
// Every yes, no, sort-of or wrong guess opens a door. Twenty doors without the answer loses.

import type { StartPick } from "../../shared/shell.ts";
import type { Turn } from "../../shared/turn.ts";
import type { Cartridge, CartridgePlayer, LegalAction, Step } from "../../shared/cartridge.ts";
import type { Control } from "../../shared/controls.ts";
import type { Scene, SceneBlock } from "../../shared/scene.ts";
import type { RoomEvent } from "../../shared/timeline.ts";
import type { Scope, ScopedFact } from "../../shared/visibility.ts";
import { TWENTY_DOORS_MANIFEST } from "./manifest.ts";

/** How long the reveal says the picture is still coming, in seconds. */
const PAINTING_WAIT_SECONDS: number = 20;

/** Doors the group gets. */
export const DOOR_COUNT: number = 20;

/** Questions the screen keeps showing. */
const SHOWN_QUESTIONS: number = 4;

/** Doors left at which the host is told to warn them. */
const WARNING_DOORS: number[] = [5, 1];

/** Longest question the screen shows before trimming it; speech can run on. */
const SHOWN_QUESTION_CHARACTERS: number = 90;

/** Categories, each with secrets most adults know, safe for a family table and easy to paint. */
export const CATEGORIES: { name: string; secrets: string[] }[] = [
    { name: "an animal", secrets: ["Platypus", "Giraffe", "Penguin", "Hedgehog", "Octopus", "Armadillo", "Flamingo", "Sloth", "Chameleon", "Walrus", "Beaver", "Seahorse", "Porcupine", "Toucan", "Otter", "Camel", "Skunk", "Jellyfish", "Moose", "Goat"] },
    { name: "something in a kitchen", secrets: ["Whisk", "Colander", "Rolling pin", "Toaster", "Oven mitt", "Corkscrew", "Ladle", "Cheese grater", "Spatula", "Kettle", "Tin opener", "Egg timer", "Tongs", "Blender", "Cutting board", "Measuring cup", "Pepper grinder", "Teapot", "Frying pan", "Ice cube tray"] },
    { name: "a famous landmark", secrets: ["Eiffel Tower", "Great Wall of China", "Statue of Liberty", "Big Ben", "Taj Mahal", "Colosseum", "Stonehenge", "Golden Gate Bridge", "Leaning Tower of Pisa", "Pyramids of Giza", "Mount Rushmore", "Sydney Opera House", "Machu Picchu", "Niagara Falls", "Christ the Redeemer", "Grand Canyon", "Acropolis", "CN Tower", "Mount Fuji", "Hollywood Sign"] },
    { name: "a food", secrets: ["Pineapple", "Pretzel", "Lasagna", "Pancake", "Watermelon", "Popcorn", "Sushi", "Coconut", "Croissant", "Marshmallow", "Avocado", "Waffle", "Peanut butter", "Taco", "Artichoke", "Doughnut", "Cucumber", "Meatball", "Mushroom", "Honey"] },
    { name: "a job", secrets: ["Lighthouse keeper", "Beekeeper", "Firefighter", "Dentist", "Astronaut", "Librarian", "Baker", "Pilot", "Plumber", "Zookeeper", "Lifeguard", "Tailor", "Chef", "Farmer", "Barber", "Train conductor", "Vet", "Mail carrier", "Carpenter", "Magician"] },
    { name: "something you'd find at the beach", secrets: ["Sandcastle", "Seashell", "Beach umbrella", "Lifeguard tower", "Flip-flops", "Crab", "Surfboard", "Seagull", "Sunscreen", "Starfish", "Bucket and spade", "Towel", "Driftwood", "Seaweed", "Volleyball net", "Sunglasses", "Ice cream cone", "Pier", "Snorkel", "Kite"] },
    { name: "a musical instrument", secrets: ["Accordion", "Trombone", "Harp", "Bagpipes", "Ukulele", "Tambourine", "Saxophone", "Xylophone", "Violin", "Harmonica", "Banjo", "Flute", "Cello", "Triangle", "Tuba", "Bongos", "Trumpet", "Piano", "Clarinet", "Recorder"] },
    { name: "a vehicle", secrets: ["Hot air balloon", "Submarine", "Tractor", "Gondola", "Snowplow", "Unicycle", "Helicopter", "Ambulance", "Tandem bicycle", "Canoe", "Double-decker bus", "Forklift", "Rickshaw", "Steam train", "Skateboard", "Ice cream truck", "Sailboat", "Bulldozer", "Fire engine", "Cable car"] },
    { name: "something in a garden", secrets: ["Wheelbarrow", "Watering can", "Scarecrow", "Sunflower", "Garden gnome", "Bird bath", "Compost heap", "Hose", "Rake", "Snail", "Greenhouse", "Lawn mower", "Tomato plant", "Ladybug", "Shed", "Hedge trimmer", "Tulip", "Trowel", "Hammock", "Worm"] },
    { name: "something at a birthday party", secrets: ["Balloon", "Piñata", "Candle", "Party hat", "Cupcake", "Wrapping paper", "Confetti", "Goody bag", "Streamer", "Ice cream cake", "Sparkler", "Musical chairs", "Bow", "Clown", "Party blower", "Gift card", "Bouncy castle", "Birthday card", "Face paint", "Paper plate"] },
];

/** Answers that open a door, with how the screen shows each. */
const DOOR_RULINGS: Record<string, string> = { yes: "Yes", no: "No", sortof: "Sort of", wrong: "Wrong guess" };

/** One question and its answer. */
export interface AskedQuestion {
    asker: string;
    question: string;
    answer: string;
}

/** The whole game, immutable between steps. */
export interface TwentyDoorsState {
    phase: "asking" | "end";
    /** True once a picture has taken too long; a drawing may never arrive. */
    stoppedWaitingForPicture: boolean;
    players: CartridgePlayer[];
    category: string;
    secret: string;
    doorsOpened: number;
    asked: AskedQuestion[];
    /** The latest thing each player said that's still waiting for a ruling, oldest first. */
    unruled: { playerId: string; text: string }[];
    won: boolean;
    finder: string | null;
    /** The picture of the secret, drawn in secret for the reveal. */
    revealPicture: string | null;
}

/**
 * Picks one item from a list.
 * @param items the list.
 * @param random a function returning [0, 1).
 * @returns the item.
 */
function pick<Item>(items: Item[], random: () => number): Item | undefined {
    return items[Math.floor(random() * items.length)];
}

/**
 * Tidies a spoken question for the screen, so its answer doesn't run on from it.
 * @param question what was said.
 * @returns the question with a capital and a question mark, trimmed to length.
 */
function shownQuestion(question: string): string {
    const text: string = question.trim().replace(/[\s.,!?]+$/, "");
    const capital: string = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    return capital.length > SHOWN_QUESTION_CHARACTERS ? `${capital.slice(0, SHOWN_QUESTION_CHARACTERS).trimEnd()}…` : `${capital}?`;
}

/** The choice before a game: a kind of secret, or whatever the host fancies. */
export const TWENTY_DOORS_PICK: StartPick = {
    prompt: "What kind of secret?",
    hostLine: "They can slide to a kind of secret and tap it. If they don't, you'll surprise them.",
    choices: [{ id: "surprise", label: "Surprise me" }, ...CATEGORIES.map((category) => ({ id: category.name, label: category.name.charAt(0).toUpperCase() + category.name.slice(1) }))],
};

/**
 * Builds the Twenty Doors cartridge with an injectable random source.
 * @param random a function returning [0, 1); defaults to Math.random.
 * @param chosen the kind of secret chosen before the game, if any.
 * @returns the cartridge.
 */
export function createTwentyDoors(random: () => number = Math.random, chosen?: string): Cartridge<TwentyDoorsState> {
    const publicFact = (kind: string, text: string, quiet: boolean = false): ScopedFact => ({ scope: { kind: "public" }, kind, text, quiet });
    const nameOf = (state: TwentyDoorsState, playerId: string): string => state.players.find((player) => player.playerId === playerId)?.name ?? "Someone";

    /**
     * Ends the game.
     * @param state the state.
     * @param won whether they found it.
     * @param finder who found it.
     * @param text what to tell the host.
     * @returns the step.
     */
    const finish = (state: TwentyDoorsState, won: boolean, finder: string | null, text: string): Step<TwentyDoorsState> => {
        return { state: { ...state, phase: "end", won, finder, unruled: [] }, facts: [publicFact("game-over", text)], nextPhaseId: "end", timers: { painting: PAINTING_WAIT_SECONDS } };
    };

    /**
     * Opens a door for a ruling, and ends the game on the last one.
     * @param state the state.
     * @param answer how the screen shows the ruling.
     * @param playerId who the host was answering; their line is used, or else the oldest waiting.
     * @returns the step.
     */
    const openDoor = (state: TwentyDoorsState, answer: string, playerId: string | null): Step<TwentyDoorsState> => {
        const doorsOpened: number = state.doorsOpened + 1;
        const line: { playerId: string; text: string } | undefined = state.unruled.find((candidate) => candidate.playerId === playerId) ?? state.unruled[0];
        const entry: AskedQuestion = { asker: line === undefined ? "Someone" : nameOf(state, line.playerId), question: line?.text ?? "", answer };
        const next: TwentyDoorsState = { ...state, doorsOpened, asked: [...state.asked, entry], unruled: state.unruled.filter((candidate) => candidate !== line) };
        if (doorsOpened >= DOOR_COUNT) {
            return finish(next, false, null, `That was the last door. They're out. The secret was ${state.secret}.`);
        }
        const left: number = DOOR_COUNT - doorsOpened;
        return { state: next, facts: WARNING_DOORS.includes(left) === true ? [publicFact("doors-left", `Tell them only ${left} door${left === 1 ? " is" : "s are"} left.`)] : [] };
    };

    return {
        manifest: TWENTY_DOORS_MANIFEST,

        init(players: CartridgePlayer[]): Step<TwentyDoorsState> {
            const category: { name: string; secrets: string[] } = CATEGORIES.find((candidate) => candidate.name === chosen) ?? pick(CATEGORIES, random) ?? { name: "an animal", secrets: ["Platypus"] };
            const secret: string = pick(category.secrets, random) ?? "Platypus";
            const state: TwentyDoorsState = { phase: "asking", stoppedWaitingForPicture: false, players, category: category.name, secret, doorsOpened: 0, asked: [], unruled: [], won: false, finder: null, revealPicture: null };
            return {
                state,
                facts: [publicFact("ready", `The secret is chosen. Tell them it's ${category.name} and they have ${DOOR_COUNT} doors, and invite the first question.`)],
                nextPhaseId: "asking",
                draws: [{ id: "reveal", prompt: `A warm storybook painting of ${secret}, seen through an open wooden door, glowing light, rich color, no faces, no text or letters.` }],
            };
        },

        phaseOf(state: TwentyDoorsState): string {
            return state.phase;
        },

        roleOf(): string {
            return "player";
        },

        groupsOf(): ReadonlySet<string> {
            return new Set();
        },

        legalActions(state: TwentyDoorsState): LegalAction[] {
            return state.phase === "asking" ? [{ actionId: "giveup", label: "We give up" }] : [];
        },

        apply(state: TwentyDoorsState, _playerId: string, actionId: string): Step<TwentyDoorsState> {
            if (state.phase !== "asking" || actionId !== "giveup") {
                return { state, facts: [] };
            }
            return finish(state, false, null, `They gave up after ${state.doorsOpened} doors. The secret was ${state.secret}.`);
        },

        onEvent(state: TwentyDoorsState, event: RoomEvent): Step<TwentyDoorsState> {
            if (event.type === "timerFired" && event.timerId === "painting") {
                return { state: { ...state, stoppedWaitingForPicture: true }, facts: [] };
            }
            if (event.type === "drawingReady" && event.id === "reveal") {
                return { state: { ...state, revealPicture: event.src }, facts: [] };
            }
            if (event.type === "speechEnded" && state.phase === "asking") {
                const others = state.unruled.filter((candidate) => candidate.playerId !== event.playerId);
                return { state: { ...state, unruled: [...others, { playerId: event.playerId, text: event.text }] }, facts: [] };
            }
            if (event.type !== "hostRuled" || state.phase !== "asking") {
                return { state, facts: [] };
            }
            if (state.unruled.length === 0 && event.ruling !== "giveup") {
                return { state, facts: [] };
            }
            const answer: string | undefined = DOOR_RULINGS[event.ruling];
            if (answer !== undefined) {
                return openDoor(state, answer, event.playerId);
            }
            if (event.ruling === "correct") {
                const finderId: string | undefined = event.playerId ?? state.unruled[0]?.playerId;
                const finder: string = finderId === undefined ? "Someone" : nameOf(state, finderId);
                return finish(state, true, finder, `${finder} found it after ${state.doorsOpened} doors. The secret was ${state.secret}. Announce it.`);
            }
            if (event.ruling === "giveup") {
                return finish(state, false, null, `They gave up after ${state.doorsOpened} doors. The secret was ${state.secret}.`);
            }
            return { state, facts: [] };
        },

        publicScene(state: TwentyDoorsState): Scene {
            if (state.phase === "end") {
                const blocks: SceneBlock[] = [{ type: "title", text: state.secret, kicker: state.won === true ? `${state.finder ?? "Someone"} found it` : "The secret was" }];
                if (state.revealPicture !== null) {
                    blocks.push({ type: "image", src: state.revealPicture });
                }
                if (state.revealPicture === null && state.stoppedWaitingForPicture === false) {
                    blocks.push({ type: "text", text: "Still painting it…", emphasis: "whisper" });
                }
                blocks.push({ type: "progress", label: "Doors opened", current: state.doorsOpened, max: DOOR_COUNT, marks: "door" });
                return { mood: state.won === true ? "victory" : "defeat", transition: "fade", blocks };
            }
            const recent: SceneBlock[] = state.asked.slice(-SHOWN_QUESTIONS).map((entry: AskedQuestion) => ({ type: "text", text: `${shownQuestion(entry.question)} ${entry.answer}.` }));
            return { mood: "neutral", transition: "fade", blocks: [{ type: "title", text: `It's ${state.category}`, kicker: "Twenty Doors" }, { type: "progress", label: "Doors opened", current: state.doorsOpened, max: DOOR_COUNT, marks: "door" }, ...recent] };
        },

        privateControls(state: TwentyDoorsState): Control[] {
            if (state.phase === "end") {
                return [{ type: "waiting", text: state.won === true ? "You found it." : "Better luck next time." }];
            }
            return [{ type: "waiting", text: "Ask a yes-or-no question" }];
        },

        turn(state: TwentyDoorsState): Turn | null {
            return state.phase === "asking" ? { kind: "anyone", label: "Anyone can ask" } : null;
        },

        hostFacts(state: TwentyDoorsState, scope: Scope): ScopedFact[] {
            if (scope.kind !== "host" || state.secret === "") {
                return [];
            }
            return [
                { scope: { kind: "host" }, kind: "secret", text: `The secret is: ${state.secret}.` },
                { scope: { kind: "public" }, kind: "doors", text: `${state.doorsOpened} of ${DOOR_COUNT} doors are open.` },
            ];
        },

        outcome(state: TwentyDoorsState): string | null {
            if (state.phase !== "end") {
                return null;
            }
            return state.won === true ? `${state.finder ?? "Someone"} found ${state.secret}.` : `The secret was ${state.secret}.`;
        },
    };
}
