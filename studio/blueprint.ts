// A blueprint is a game as data: which kit it is, the decisions on that kit, and its box. Studio
// edits blueprints; the kit turns one into a cartridge the room can run. A blueprint never holds
// words the host is told: kits own those, so no creator text reaches the host's brief except short
// checked names. This file is the one place that knows every kit.

import type { Cartridge } from "../shared/cartridge.ts";
import type { Box, HiddenValue } from "./kit/kit.ts";
import type { EstimateDecisions } from "./kits/estimate/estimate.ts";
import type { GateDecisions } from "./kits/gate/gate.ts";
import type { LineDecisions } from "./kits/line/line.ts";
import type { ClueBoardDecisions } from "./kits/clueboard/clueboard.ts";
import type { OddWordDecisions } from "./kits/oddword/oddword.ts";
import type { StrangerDecisions } from "./kits/stranger/stranger.ts";
import type { ChainDecisions } from "./kits/chain/chain.ts";
import type { GalleryDecisions } from "./kits/gallery/gallery.ts";
import type { GuessingDecisions } from "./kits/guessing/guessing.ts";
import type { PlantDecisions } from "./kits/plant/plant.ts";
import type { DiceDecisions } from "./kits/tap/tap-dice.ts";
import type { FitsDecisions } from "./kits/tap/tap-fits.ts";
import type { PushDecisions } from "./kits/tap/tap-push.ts";
import type { WitDecisions } from "./kits/wit/wit.ts";
import type { IdentityDecisions } from "./kits/identity/identity.ts";
import type { HostGuessDecisions } from "./kits/host-guess/host-guess.ts";
import type { HandDecisions } from "./kits/hand/hand.ts";
import type { ClueDecisions } from "./kits/clue/clue.ts";
import type { CharadesDecisions } from "./kits/charades/charades.ts";
import type { BluffDecisions } from "./kits/bluff/bluff.ts";
import type { BotDecisions } from "./kits/bot/bot.ts";
import { KITS, type KitDefinition } from "./registry.ts";

/** A guessing game: a secret the host holds, a judge, a count. */
export interface GuessingBlueprint {
    kit: "guessing";
    box: Box;
    decisions: GuessingDecisions;
}

/** A plant game: a word the host holds, one player who knows it, questions, a vote. */
export interface PlantBlueprint {
    kit: "plant";
    box: Box;
    decisions: PlantDecisions;
}

/** The tap games, each its own style on the tap kit. */
export type TapDecisions = FitsDecisions | DiceDecisions | PushDecisions;

/** A tap game: people play by tapping their phones, and the host only talks. */
export interface TapBlueprint<Decisions extends TapDecisions = TapDecisions> {
    kit: "tap";
    box: Box;
    decisions: Decisions;
}

/** A wit game: two players answer one prompt in secret and the room votes. */
export interface WitBlueprint {
    kit: "wit";
    box: Box;
    decisions: WitDecisions;
}

/** A gate game: a keeper the host plays, a secret rule code checks against each plea, and cargo words. */
export interface GateBlueprint {
    kit: "gate";
    box: Box;
    decisions: GateDecisions;
}

/** An estimate game: a numeric question, secret guesses, and bets on whose guess is closest. */
export interface EstimateBlueprint {
    kit: "estimate";
    box: Box;
    decisions: EstimateDecisions;
}

/** A line game: a row of dated cards, a new card each round, and a pick of which gap it goes in. */
export interface LineBlueprint {
    kit: "line";
    box: Box;
    decisions: LineDecisions;
}

/** A clue-board game: two teams, a shared grid of words, a hidden key and a clue-giver on each side. */
export interface ClueBoardBlueprint {
    kit: "clueboard";
    box: Box;
    decisions: ClueBoardDecisions;
}

/** A stranger game: everyone but one player knows the place, and they question each other in turn. */
export interface StrangerBlueprint {
    kit: "stranger";
    box: Box;
    decisions: StrangerDecisions;
}

/** An odd-word game: everyone knows the secret word but one player, and says one word about it each round. */
export interface OddWordBlueprint {
    kit: "oddword";
    box: Box;
    decisions: OddWordDecisions;
}

/** A chain game: lines and paintings passed round the table, then shown in full. */
export interface ChainBlueprint {
    kit: "chain";
    box: Box;
    decisions: ChainDecisions;
}

/** A gallery game: private hands of painted cards, a clue, a matching card from everyone, a vote. */
export interface GalleryBlueprint {
    kit: "gallery";
    box: Box;
    decisions: GalleryDecisions;
}

/** An identity game: every player wears a name tag the others can see, and works out who they are by asking. */
export interface IdentityBlueprint {
    kit: "identity";
    box: Box;
    decisions: IdentityDecisions;
}

/** A host-guess game: the players hold a thing in secret and the host asks questions to find it. */
export interface HostGuessBlueprint {
    kit: "hostGuess";
    box: Box;
    decisions: HostGuessDecisions;
}

/** A hand game: dealt cards on phones, a rotating judge, a prompt with a gap. */
export interface HandBlueprint {
    kit: "hand";
    box: Box;
    decisions: HandDecisions;
}

/** A clue game: a secret word, one-word clues that cancel when they match, one guess. */
export interface ClueBlueprint {
    kit: "clue";
    box: Box;
    decisions: ClueDecisions;
}

/** A charades game: one player acts a private prompt in silence while the rest shout guesses. */
export interface CharadesBlueprint {
    kit: "charades";
    box: Box;
    decisions: CharadesDecisions;
}

/** A bluff game: a real fact with a blank, fakes written in secret, and a pick. */
export interface BluffBlueprint {
    kit: "bluff";
    box: Box;
    decisions: BluffDecisions;
}

/** A bot game: everyone answers in secret, the host writes one more, and the table votes for the machine's. */
export interface BotBlueprint {
    kit: "bot";
    box: Box;
    decisions: BotDecisions;
}

/** Any game as data. */
export type Blueprint =
    | GuessingBlueprint
    | PlantBlueprint
    | TapBlueprint
    | WitBlueprint
    | GateBlueprint
    | EstimateBlueprint
    | LineBlueprint
    | ClueBoardBlueprint
    | StrangerBlueprint
    | OddWordBlueprint
    | ChainBlueprint
    | GalleryBlueprint
    | IdentityBlueprint
    | HostGuessBlueprint
    | HandBlueprint
    | ClueBlueprint
    | CharadesBlueprint
    | BluffBlueprint
    | BotBlueprint;

/** A running game of any kit, with its state hidden behind the cartridge. */
export interface AnyKitGame {
    cartridge: Cartridge<unknown>;
    hidden(state: unknown): HiddenValue[];
}

/**
 * A blueprint's kit, looked up by the name the blueprint gives it.
 * @param blueprint the blueprint.
 * @returns the kit's definition.
 */
function kitOf(blueprint: Blueprint): KitDefinition<Blueprint> {
    return KITS[blueprint.kit];
}

/**
 * Checks a blueprint is one its kit can run. Studio never offers a value that fails this, so a
 * creator cannot make an unrunnable game; the check guards hand-written and stored blueprints.
 * @param blueprint the blueprint.
 * @returns the problems found, in plain words; empty when it is runnable.
 */
export function blueprintProblems(blueprint: Blueprint): string[] {
    return kitOf(blueprint).problems(blueprint);
}

/**
 * Builds a running game from a blueprint. The kit copies what it is given, so changing the
 * blueprint afterwards never reaches a game in progress.
 * @param blueprint a runnable blueprint.
 * @param random a function returning [0, 1).
 * @returns the game.
 */
export function createKitGame(blueprint: Blueprint, random: () => number = Math.random): AnyKitGame {
    return kitOf(blueprint).create(blueprint, random);
}

/**
 * The rows a game adds to the pause menu, so one stray tap can't end it.
 * @param blueprint the game.
 * @returns the actions, by id and label.
 */
export function blueprintPauseActions(blueprint: Blueprint): { id: string; label: string }[] {
    return kitOf(blueprint).pauseActions(blueprint);
}
