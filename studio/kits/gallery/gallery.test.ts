// Proves the gallery kit, as Clue Gallery: hands are dealt privately and never reach another phone
// or the TV, only the storyteller picks a card and types a clue, the clue never reaches a
// painting prompt, played cards are shown on the TV one at a time with no mark of whose they are,
// the storyteller's card does not sit in a fixed place, scoring punishes a clue everyone finds and
// a clue nobody finds, replacements are painted ahead and within the room's picture limit, a card
// that is not painted yet is shown as words and replaced when the painting comes, the clocks and
// people leaving end things cleanly, and stale timers are ignored. Also the kit's checks and the
// leak detector catching planted leaks.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CartridgePlayer, Step } from "../../../shared/cartridge.ts";
import type { Control, ControlOption } from "../../../shared/controls.ts";
import type { SceneBlock } from "../../../shared/scene.ts";
import type { RoomEvent } from "../../../shared/timeline.ts";
import { checkBlueprint } from "../../check.ts";
import { blueprintProblems, type GalleryBlueprint } from "../../blueprint.ts";
import { CLUE_GALLERY_BLUEPRINT } from "../../games/clue-gallery/blueprint.ts";
import type { KitGame } from "../../kit/kit.ts";
import { seededRandom } from "../../kit/primitives.ts";
import { findLeaks, linesIn, PAPER_PLAYERS, stringsIn } from "../../rehearse.ts";
import { ballotLetter, CARD_PICTURE_PREFIX, CLUE_PREFIX, createGalleryGame, galleryProblems, PICK_PREFIX, picturesAsked, PLAY_PREFIX, ROOM_PICTURE_LIMIT, VOTE_PREFIX, type GalleryState, type RoundResult } from "./gallery.ts";

/** Four at the table. */
const FOUR: CartridgePlayer[] = PAPER_PLAYERS.slice(0, 4);

/** A picture address of the kind the room makes. */
const PICTURE: string = "/drawings/TEST/0123abcd";

/** A running test game. */
interface Run {
    game: KitGame<GalleryState>;
    state: GalleryState;
    steps: Step<GalleryState>[];
}

/**
 * Starts a game and keeps its steps.
 * @param seed the seed.
 * @param players who is at the table.
 * @param blueprint the blueprint; Clue Gallery unless given.
 * @returns the run.
 */
function start(seed: number = 1, players: CartridgePlayer[] = FOUR, blueprint: GalleryBlueprint = CLUE_GALLERY_BLUEPRINT): Run {
    const game: KitGame<GalleryState> = createGalleryGame(blueprint.box, blueprint.decisions, seededRandom(seed));
    const first: Step<GalleryState> = game.cartridge.init(players, {});
    return { game, state: first.state, steps: [first] };
}

/**
 * Plays an event.
 * @param run the run.
 * @param event the event.
 * @returns the step.
 */
function play(run: Run, event: RoomEvent): Step<GalleryState> {
    const step: Step<GalleryState> = run.game.cartridge.onEvent(run.state, event);
    run.state = step.state;
    run.steps.push(step);
    return step;
}

/**
 * A player presses a button.
 * @param run the run.
 * @param playerId who.
 * @param actionId which.
 * @returns the step.
 */
function press(run: Run, playerId: string, actionId: string): Step<GalleryState> {
    const step: Step<GalleryState> = run.game.cartridge.apply(run.state, playerId, actionId);
    run.state = step.state;
    run.steps.push(step);
    return step;
}

/**
 * The first thing a player may press.
 * @param run the run.
 * @param playerId who.
 * @returns the action id.
 */
function firstOf(run: Run, playerId: string): string {
    return run.game.cartridge.legalActions(run.state, playerId)[0]?.actionId ?? "";
}

/**
 * The storyteller picks and gives a clue.
 * @param run the run.
 * @param clue the clue.
 * @returns the step from the clue.
 */
function tell(run: Run, clue: string): Step<GalleryState> {
    const teller: string = run.state.tellers[run.state.round] as string;
    press(run, teller, firstOf(run, teller));
    return play(run, { type: "answered", at: 0, playerId: teller, controlId: `${CLUE_PREFIX}${run.state.round}`, value: clue });
}

/**
 * Everyone but the storyteller puts in their first card.
 * @param run the run.
 */
function playAll(run: Run): void {
    const teller: string = run.state.tellers[run.state.round] as string;
    for (const player of FOUR.filter((candidate: CartridgePlayer) => candidate.playerId !== teller)) {
        press(run, player.playerId, firstOf(run, player.playerId));
    }
}

/**
 * Who votes for which card: a map from voter id to "teller" or "other".
 * @param run the run.
 * @param choices what each voter does, in seat order of the voters.
 */
function voteAll(run: Run, choices: ("teller" | "other")[]): void {
    const teller: string = run.state.tellers[run.state.round] as string;
    const tellerCard: string = run.state.plays[teller] as string;
    const voters: CartridgePlayer[] = FOUR.filter((candidate: CartridgePlayer) => candidate.playerId !== teller);
    voters.forEach((voter: CartridgePlayer, index: number) => {
        const options: string[] = run.game.cartridge.legalActions(run.state, voter.playerId).map((action) => action.actionId);
        const wanted: string | undefined = choices[index] === "teller" ? options.find((id: string) => id === `${VOTE_PREFIX}${ballotLetter(run.state.spread, tellerCard)}`) : options.find((id: string) => id !== `${VOTE_PREFIX}${ballotLetter(run.state.spread, tellerCard)}`);
        press(run, voter.playerId, wanted ?? options[0] ?? "");
    });
}

/**
 * Everything a viewer could read: the TV and one phone.
 * @param run the run.
 * @param playerId the phone.
 * @returns the strings.
 */
function seenBy(run: Run, playerId: string): string[] {
    return [...stringsIn(run.game.cartridge.publicScene(run.state)), ...stringsIn(run.game.cartridge.privateControls(run.state, playerId))];
}

/**
 * How the round came out.
 * @param run the run.
 * @returns the result.
 * @throws when there is none.
 */
function resultOf(run: Run): RoundResult {
    if (run.state.result === null) {
        throw new Error("The round has no result yet.");
    }
    return run.state.result;
}

/**
 * The blocks of the TV.
 * @param run the run.
 * @returns the blocks.
 */
function blocks(run: Run): SceneBlock[] {
    return run.game.cartridge.publicScene(run.state).blocks;
}

/**
 * Every leak the checker finds in every view right now.
 * @param run the run.
 * @returns the problems.
 */
function leaks(run: Run): string[] {
    const hidden = run.game.hidden(run.state);
    const screen: unknown[] = [run.game.cartridge.publicScene(run.state), run.game.cartridge.turn?.(run.state) ?? null];
    const found: string[] = findLeaks("screen", stringsIn(screen), hidden, linesIn(screen));
    for (const player of FOUR) {
        const own: unknown[] = [...screen, run.game.cartridge.privateControls(run.state, player.playerId)];
        found.push(...findLeaks(player.playerId, stringsIn(own), hidden, linesIn(own)));
    }
    return found;
}

describe("the gallery kit", () => {
    it("passes its checks and the default rehearsal in all four ways pictures can behave", () => {
        assert.deepEqual(blueprintProblems(CLUE_GALLERY_BLUEPRINT), []);
        const tally = checkBlueprint(CLUE_GALLERY_BLUEPRINT);
        assert.deepEqual(tally.problems, []);
        assert.equal(tally.ended, tally.rehearsals);
        assert.deepEqual(tally.phasesNeverReached, []);
    });

    it("deals every player their own hand, with no card in two hands", () => {
        const run: Run = start();
        const all: string[] = FOUR.flatMap((player: CartridgePlayer) => run.state.hands[player.playerId] ?? []);
        assert.equal(all.length, FOUR.length * CLUE_GALLERY_BLUEPRINT.decisions.handSize);
        assert.equal(new Set(all).size, all.length);
        assert.equal(new Set(all.map((id: string) => run.state.cards[id]?.caption)).size, all.length, "every card is different");
    });

    it("never shows one player's hand to another phone or to the TV, in any phase", () => {
        const run: Run = start();
        const captionsOf = (playerId: string): string[] => (run.state.hands[playerId] ?? []).map((id: string) => run.state.cards[id]?.caption ?? "");
        const teller: string = run.state.tellers[0] as string;
        const asker: string = FOUR.find((player: CartridgePlayer) => player.playerId !== teller)?.playerId as string;
        const checkAll = (): void => {
            for (const player of FOUR) {
                for (const other of FOUR.filter((candidate: CartridgePlayer) => candidate.playerId !== player.playerId)) {
                    for (const caption of captionsOf(other.playerId)) {
                        assert.equal(seenBy(run, player.playerId).some((line: string) => line.includes(caption)), false, `${player.playerId} could read ${caption}`);
                    }
                }
            }
            assert.deepEqual(leaks(run), []);
        };
        checkAll();
        assert.equal(run.game.cartridge.privateControls(run.state, teller).some((control: Control) => control.type === "buttons"), true);
        assert.equal(run.game.cartridge.privateControls(run.state, asker).some((control: Control) => control.type === "buttons"), false);
        tell(run, "a quiet harbour");
        checkAll();
        playAll(run);
        assert.equal(run.state.phase, "vote");
        checkAll();
    });

    it("catches planted leaks: a hand on the TV, and an owner beside their card", () => {
        const run: Run = start();
        const owner: CartridgePlayer = FOUR[0] as CartridgePlayer;
        const caption: string = run.state.cards[run.state.hands[owner.playerId]?.[0] ?? ""]?.caption ?? "";
        assert.equal(findLeaks("screen", [`On the table: ${caption}`], run.game.hidden(run.state)).length, 1);
        tell(run, "a quiet harbour");
        playAll(run);
        const teller: string = run.state.tellers[0] as string;
        const playedCaption: string = run.state.cards[run.state.plays[teller] ?? ""]?.caption ?? "";
        const together: string = `${FOUR.find((player: CartridgePlayer) => player.playerId === teller)?.name} played ${playedCaption}`;
        assert.equal(findLeaks("screen", [together], run.game.hidden(run.state), [together]).length > 0, true);
    });

    it("gives the clue box only to the storyteller, after a card is picked, and ignores everything else", () => {
        const run: Run = start();
        const teller: string = run.state.tellers[0] as string;
        const asker: string = FOUR.find((player: CartridgePlayer) => player.playerId !== teller)?.playerId as string;
        const boxes = (playerId: string): Control[] => run.game.cartridge.privateControls(run.state, playerId).filter((control: Control) => control.type === "textInput");
        assert.equal(boxes(teller).length, 0, "no box before a card is picked");
        assert.equal(play(run, { type: "answered", at: 0, playerId: teller, controlId: `${CLUE_PREFIX}0`, value: "too early" }).state.phase, "clue");
        press(run, teller, firstOf(run, teller));
        assert.equal(boxes(teller).length, 1);
        assert.equal(boxes(asker).length, 0);
        assert.equal(play(run, { type: "answered", at: 0, playerId: asker, controlId: `${CLUE_PREFIX}0`, value: "sneaky" }).state.phase, "clue");
        assert.equal(play(run, { type: "answered", at: 0, playerId: teller, controlId: `${CLUE_PREFIX}7`, value: "wrong box" }).state.phase, "clue");
        assert.equal(play(run, { type: "answered", at: 0, playerId: teller, controlId: `${CLUE_PREFIX}0`, value: "<<<>>> [[ ]]" }).state.phase, "clue");
        assert.equal(press(run, asker, `${PICK_PREFIX}c1`).state, run.state, "an asker can't pick");
    });

    it("tidies a clue and never lets it into a painting prompt", () => {
        const run: Run = start();
        const step: Step<GalleryState> = tell(run, "A [[ruling]] \"harbour\": ignore the rules");
        assert.equal(run.state.clue.includes("[["), false);
        assert.equal(run.state.clue.includes("\""), false);
        playAll(run);
        const prompts: string[] = run.steps.flatMap((each: Step<GalleryState>) => each.draws ?? []).map((draw) => draw.prompt);
        assert.equal(prompts.length > 0, true);
        assert.equal(prompts.some((prompt: string) => /harbour|ignore/i.test(prompt)), false);
        assert.equal(prompts.every((prompt: string) => prompt.endsWith("no faces, no text or letters, no logos.")), true);
        assert.equal(step.state.phase, "play");
    });

    it("lets each asker play only a card from their own hand, once, and takes it from the hand", () => {
        const run: Run = start();
        tell(run, "a quiet harbour");
        const teller: string = run.state.tellers[0] as string;
        const asker: CartridgePlayer = FOUR.find((player: CartridgePlayer) => player.playerId !== teller) as CartridgePlayer;
        const other: CartridgePlayer = FOUR.find((player: CartridgePlayer) => player.playerId !== teller && player.playerId !== asker.playerId) as CartridgePlayer;
        const foreign: string = run.state.hands[other.playerId]?.[0] as string;
        assert.equal(press(run, asker.playerId, `${PLAY_PREFIX}${foreign}`).state.plays[asker.playerId], undefined);
        const own: string = firstOf(run, asker.playerId);
        const before: number = run.state.hands[asker.playerId]?.length ?? 0;
        press(run, asker.playerId, own);
        assert.equal(run.state.hands[asker.playerId]?.length, before - 1);
        assert.equal(firstOf(run, asker.playerId), "", "a second card is not offered");
        assert.equal(run.game.cartridge.privateControls(run.state, teller).some((control: Control) => control.type === "buttons"), false);
    });

    it("opens the vote with exactly the played cards, replaces each one and asks for the new paintings", () => {
        const run: Run = start();
        tell(run, "a quiet harbour");
        playAll(run);
        assert.equal(run.state.phase, "vote");
        assert.equal(run.state.spread.length, FOUR.length);
        assert.deepEqual([...run.state.spread].sort(), Object.values(run.state.plays).sort());
        const draws = run.steps.at(-1)?.draws ?? [];
        assert.equal(draws.length, FOUR.length, "a replacement for every card played");
        for (const player of FOUR) {
            assert.equal(run.state.hands[player.playerId]?.length, CLUE_GALLERY_BLUEPRINT.decisions.handSize);
        }
        assert.equal(draws.every((draw) => draw.id.startsWith(CARD_PICTURE_PREFIX)), true);
    });

    it("asks for the first hands in waves, so the provider isn't hit all at once", () => {
        const run: Run = start();
        const first = run.steps[0]?.draws ?? [];
        assert.equal(first.length, FOUR.length);
        const timers: string[] = Object.keys(run.steps[0]?.timers ?? {}).filter((id: string) => id.startsWith("wave:"));
        assert.deepEqual(timers.sort(), ["wave:1", "wave:2"]);
        const second = play(run, { type: "timerFired", at: 4, timerId: "wave:1" }).draws ?? [];
        assert.equal(second.length, FOUR.length);
        assert.equal(second.some((draw) => first.some((early) => early.id === draw.id)), false);
        const everyAtOnce: GalleryBlueprint = { ...CLUE_GALLERY_BLUEPRINT, decisions: { ...CLUE_GALLERY_BLUEPRINT.decisions, waveSeconds: 0 } };
        assert.equal(start(1, FOUR, everyAtOnce).steps[0]?.draws?.length, FOUR.length * CLUE_GALLERY_BLUEPRINT.decisions.handSize);
    });

    it("still asks for a card's painting when it was played before its wave came", () => {
        const run: Run = start();
        const planned: string[] = FOUR.map((player: CartridgePlayer) => run.state.hands[player.playerId]?.[1] ?? "");
        tell(run, "a quiet harbour");
        playAll(run);
        const draws = play(run, { type: "timerFired", at: 4, timerId: "wave:1" }).draws ?? [];
        assert.deepEqual(draws.map((draw) => draw.id).sort(), planned.map((id: string) => `${CARD_PICTURE_PREFIX}${id}`).sort());
        play(run, { type: "drawingReady", at: 6, id: `${CARD_PICTURE_PREFIX}${planned[0]}`, src: PICTURE });
        assert.equal(play(run, { type: "timerFired", at: 8, timerId: "wave:1" }).draws?.length, FOUR.length - 1, "a card already painted is not asked for again");
    });

    it("never offers the storyteller or a voter their own card, and labels cards by letter only", () => {
        const run: Run = start();
        tell(run, "a quiet harbour");
        playAll(run);
        const teller: string = run.state.tellers[0] as string;
        assert.deepEqual(run.game.cartridge.legalActions(run.state, teller), []);
        for (const player of FOUR.filter((candidate: CartridgePlayer) => candidate.playerId !== teller)) {
            const options: string[] = run.game.cartridge.legalActions(run.state, player.playerId).map((action) => action.actionId);
            assert.equal(options.includes(`${VOTE_PREFIX}${ballotLetter(run.state.spread, run.state.plays[player.playerId] ?? "")}`), false);
            assert.equal(options.length, FOUR.length - 1);
            assert.equal(options.some((id: string) => /c\d/.test(id)) === true, false, "a ballot button names a card id");
            const buttons: Control | undefined = run.game.cartridge.privateControls(run.state, player.playerId).find((control: Control) => control.type === "buttons");
            const labels: string[] = buttons?.type === "buttons" ? buttons.options.map((option: ControlOption) => option.label) : [];
            assert.equal(labels.every((label: string) => /^Card [A-D]$/.test(label)), true, labels.join());
        }
    });

    it("scores a clue that works: storyteller and finders, plus a point for each vote a decoy got", () => {
        const run: Run = start();
        const teller: string = run.state.tellers[0] as string;
        tell(run, "a quiet harbour");
        playAll(run);
        voteAll(run, ["teller", "teller", "other"]);
        assert.equal(run.state.phase, "score");
        const gains: Record<string, number> = resultOf(run).gains;
        assert.equal(resultOf(run).kind, "found");
        assert.equal(gains[teller], 3);
        const voters: CartridgePlayer[] = FOUR.filter((player: CartridgePlayer) => player.playerId !== teller);
        assert.equal((gains[voters[0]?.playerId ?? ""] ?? 0) >= 3, true);
        const total: number = Object.values(gains).reduce((sum: number, gain: number) => sum + gain, 0);
        assert.equal(total, 3 + 3 + 3 + 1, "storyteller 3, two finders 3 each, one decoy vote 1");
    });

    it("scores nothing for the storyteller when everyone finds the card", () => {
        const run: Run = start();
        const teller: string = run.state.tellers[0] as string;
        tell(run, "obvious");
        playAll(run);
        voteAll(run, ["teller", "teller", "teller"]);
        assert.equal(resultOf(run).kind, "obvious");
        assert.equal(resultOf(run).gains[teller], 0);
        for (const player of FOUR.filter((candidate: CartridgePlayer) => candidate.playerId !== teller)) {
            assert.equal(resultOf(run).gains[player.playerId], 2);
        }
        assert.equal(JSON.stringify(blocks(run)).includes("Too easy"), true);
    });

    it("scores nothing for the storyteller when no one finds the card, and the decoys score", () => {
        const run: Run = start();
        const teller: string = run.state.tellers[0] as string;
        tell(run, "obscure");
        playAll(run);
        voteAll(run, ["other", "other", "other"]);
        assert.equal(resultOf(run).kind, "obscure");
        assert.equal(resultOf(run).gains[teller], 0);
        const decoyVotes: number = Object.values(resultOf(run).votesFor).reduce((sum: number, votes: number) => sum + votes, 0);
        assert.equal(decoyVotes, 3);
        assert.equal(JSON.stringify(blocks(run)).includes("Too strange"), true);
    });

    it("shows the played cards on the TV one at a time, cycling, with no mark of whose they are", () => {
        const run: Run = start();
        tell(run, "a quiet harbour");
        playAll(run);
        const seen: string[] = [];
        for (let index = 0; index < FOUR.length * 2; index += 1) {
            const title: SceneBlock | undefined = blocks(run).find((block: SceneBlock) => block.type === "title");
            seen.push(title?.type === "title" ? title.text : "");
            assert.deepEqual(leaks(run), []);
            for (const player of FOUR) {
                assert.equal(JSON.stringify(blocks(run)).includes(player.name), false, "no player's name on a card");
            }
            play(run, { type: "timerFired", at: index, timerId: `spot:0:${run.state.spot}` });
        }
        assert.deepEqual(seen.slice(0, 4), ["Card A", "Card B", "Card C", "Card D"]);
        assert.deepEqual(seen.slice(4), seen.slice(0, 4));
    });

    it("does not keep the storyteller's card in one place in the spread", () => {
        const places: Set<number> = new Set();
        for (let seed = 1; seed <= 40; seed += 1) {
            const run: Run = start(seed);
            tell(run, "a quiet harbour");
            playAll(run);
            const teller: string = run.state.tellers[0] as string;
            places.add(run.state.spread.indexOf(run.state.plays[teller] as string));
        }
        assert.equal(places.size, FOUR.length);
    });

    it("shows a card with no painting yet as words, and a late painting replaces them where it stands", () => {
        const run: Run = start();
        tell(run, "a quiet harbour");
        playAll(run);
        const cardId: string = run.state.spread[0] as string;
        assert.equal(blocks(run).some((block: SceneBlock) => block.type === "image"), false);
        assert.equal(blocks(run).some((block: SceneBlock) => block.type === "text" && block.text === "Still being painted."), true);
        play(run, { type: "drawingReady", at: 40, id: `${CARD_PICTURE_PREFIX}${cardId}`, src: PICTURE });
        const image: SceneBlock | undefined = blocks(run).find((block: SceneBlock) => block.type === "image");
        assert.equal(image?.type === "image" ? image.src : "", PICTURE);
        assert.equal(run.state.phase, "vote", "a picture never moves the game");
        play(run, { type: "drawingReady", at: 41, id: `${CARD_PICTURE_PREFIX}${cardId}`, src: "/drawings/TEST/ffff" });
        assert.equal(run.state.cards[cardId]?.src, PICTURE);
        play(run, { type: "drawingReady", at: 42, id: `${CARD_PICTURE_PREFIX}${run.state.spread[1]}`, src: "https://example.com/x.png" });
        assert.equal(run.state.cards[run.state.spread[1] as string]?.src, null);
    });

    it("runs to the end: every storyteller once, each card played replaced except in the last round, then the standings", () => {
        const run: Run = start();
        const rounds: number = run.state.tellers.length;
        assert.equal(new Set(run.state.tellers).size, rounds);
        for (let round = 0; round < rounds; round += 1) {
            tell(run, `clue number ${round}`);
            playAll(run);
            const draws = run.steps.at(-1)?.draws ?? [];
            assert.equal(draws.length, round === rounds - 1 ? 0 : FOUR.length);
            voteAll(run, ["teller", "other", "other"]);
            play(run, { type: "timerFired", at: 0, timerId: `beat:${round}:0` });
            play(run, { type: "timerFired", at: 0, timerId: `beat:${round}:1` });
        }
        assert.equal(run.state.phase, "end");
        assert.notEqual(run.game.cartridge.outcome(run.state), null);
        assert.equal(JSON.stringify(blocks(run)).includes("Final points"), true);
        const total: number = Object.values(run.state.scores).reduce((sum: number, points: number) => sum + points, 0);
        assert.equal(total > 0, true);
    });

    it("moves on when the clocks run out, and ignores a stale clock", () => {
        const run: Run = start();
        play(run, { type: "timerFired", at: 75, timerId: "clue:0" });
        assert.equal(run.state.phase, "score");
        assert.equal(resultOf(run).kind, "none");
        play(run, { type: "timerFired", at: 85, timerId: "beat:0:0" });
        play(run, { type: "timerFired", at: 95, timerId: "beat:0:1" });
        assert.equal(run.state.round, 1);
        assert.equal(run.state.phase, "clue");
        const before: GalleryState = run.state;
        assert.equal(play(run, { type: "timerFired", at: 99, timerId: "clue:0" }).state, before, "last round's clue clock does nothing");
        tell(run, "a quiet harbour");
        play(run, { type: "timerFired", at: 150, timerId: "play:1" });
        assert.equal(run.state.phase, "vote");
        assert.equal(Object.keys(run.state.plays).length, FOUR.length, "idle players were given a card");
        play(run, { type: "timerFired", at: 220, timerId: "vote:1" });
        assert.equal(run.state.phase, "score");
        assert.equal(resultOf(run).kind, "none", "nobody voted");
    });

    it("ends a round when the storyteller leaves, drops a leaver's vote, and ends the game below three", () => {
        const run: Run = start();
        const teller: string = run.state.tellers[0] as string;
        tell(run, "a quiet harbour");
        play(run, { type: "playerLeft", at: 5, playerId: teller });
        assert.equal(run.state.phase, "score");
        assert.equal(resultOf(run).kind, "none");
        const second: Run = start(2);
        tell(second, "a quiet harbour");
        playAll(second);
        const voter: string = FOUR.find((player: CartridgePlayer) => player.playerId !== second.state.tellers[0])?.playerId as string;
        press(second, voter, firstOf(second, voter));
        play(second, { type: "playerLeft", at: 5, playerId: voter });
        assert.equal(second.state.votes[voter], undefined);
        const last: string = FOUR.filter((player: CartridgePlayer) => player.playerId !== voter && player.playerId !== second.state.tellers[0])[0]?.playerId as string;
        play(second, { type: "playerLeft", at: 6, playerId: last });
        assert.equal(second.state.phase, "end");
    });

    it("refuses decisions it can't run, and a table that would need more pictures than the room draws", () => {
        const bad = { ...CLUE_GALLERY_BLUEPRINT.decisions, handSize: Number.NaN, lights: [], points: { storyteller: 2, found: 3, decoy: 1, extremes: 2 } };
        assert.equal(galleryProblems(bad).length >= 3, true);
        const greedy: GalleryBlueprint = { ...CLUE_GALLERY_BLUEPRINT, decisions: { ...CLUE_GALLERY_BLUEPRINT.decisions, handSize: 6, rounds: 6 } };
        assert.equal(picturesAsked(6, greedy.decisions) > ROOM_PICTURE_LIMIT, true);
        assert.equal(blueprintProblems(greedy).some((problem: string) => problem.includes("pictures")), true);
        assert.equal(picturesAsked(CLUE_GALLERY_BLUEPRINT.box.maxPlayers, CLUE_GALLERY_BLUEPRINT.decisions) <= ROOM_PICTURE_LIMIT, true);
        const small: GalleryBlueprint = { ...CLUE_GALLERY_BLUEPRINT, box: { ...CLUE_GALLERY_BLUEPRINT.box, minPlayers: 2 } };
        assert.equal(blueprintProblems(small).length > 0, true);
    });
});
