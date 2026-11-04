// Messages between the room and its stages. Text frames carry JSON of these shapes; binary
// frames carry audio: phone to room is raw 24 kHz 16-bit mono PCM, room to screen is encoded
// host speech. Both stages reduce messages into local state; the room is the only writer.

import type { Turn } from "./turn.ts";
import type { HostMood } from "./hostMood.ts";
import type { ControlInput, PhoneView } from "./controls.ts";
import type { Scene } from "./scene.ts";
import type { NavAction, ShellView } from "./shell.ts";

/** Why the room turned a stage away. */
export type RejectedReason = "unknownRoom" | "roomFull" | "noRoomsFree" | "roomClosed";

/** Phone to room. */
export type PhoneMessage =
    | { type: "hello"; name: string; playerId?: string; resumeToken?: string; sameName?: "takeSeat" | "newSeat" }
    | { type: "input"; input: ControlInput }
    | { type: "answer"; controlId: string; value: string | number }
    | { type: "holdToTalk"; down: boolean }
    | { type: "rename"; name: string }
    | { type: "leave" }
    | { type: "guest"; action: "add" | "remove" | "inviteAgent"; playerId?: string }
    | { type: "textOnlySay"; text: string }
    | { type: "nav"; action: NavAction }
    | { type: "lean"; x: number; y: number }
    | { type: "touched" }
    | { type: "released"; why?: TapEnd }
    | { type: "reactions"; wanted: boolean }
    | { type: "micSettings"; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }
    | { type: "presence"; away: boolean };

/** Room to phone. */
export type RoomToPhoneMessage =
    | { type: "welcome"; playerId: string; roomCode: string; name: string; resumeToken: string }
    | { type: "view"; view: PhoneView }
    | { type: "nameTaken"; name: string }
    | { type: "rejected"; reason: RejectedReason }
    | { type: "heartbeat" };

/** Screen to room. */
export type ScreenMessage =
    | { type: "hello" }
    | { type: "ready"; resumed?: boolean };

/**
 * Room to screen. Host audio follows as binary 24 kHz 16-bit mono PCM frames after an
 * audioStart; audioCancel means drop anything still queued because someone cut in.
 */
export type RoomToScreenMessage =
    | { type: "scene"; scene: Scene; joinUrl: string; roomCode: string; turn: Turn | null }
    | { type: "seatTouched"; playerId: string }
    | { type: "heardYou"; playerId: string }
    | { type: "audioStart"; mediaType: string }
    | { type: "audioEnd" }
    | { type: "audioCancel" }
    | { type: "hostState"; thinking: boolean; speaking: boolean; hostName: string; mood: HostMood | null }
    | { type: "shell"; view: ShellView }
    | { type: "edge" }
    | { type: "lean"; x: number; y: number }
    | { type: "micLevel"; level: number }
    | { type: "rejected"; reason: RejectedReason }
    | { type: "heartbeat" };

/** How long a stage waits with nothing from the server before it assumes the connection died. */
export const SERVER_SILENCE_LIMIT_MILLISECONDS: number = 35000;

/** How long a phone back in the foreground waits for the room to answer before it assumes the connection died. */
export const FOREGROUND_ANSWER_LIMIT_MILLISECONDS: number = 3000;

/** Why a tap-to-talk recording ended. */
export type TapEnd = "stop" | "silence" | "limit" | "hidden";

/** Every reason a phone may give, so nothing else from a phone reaches the logs. */
const TAP_ENDS: TapEnd[] = ["stop", "silence", "limit", "hidden"];

/**
 * Checks a parsed message from a phone has the fields the room will read. Phones are outside
 * the room's trust, and a missing field must not bring the room down.
 * @param message a message with some type.
 * @returns true when it is a well-formed phone message.
 */
export function isPhoneMessage(message: { type: string } & Record<string, unknown>): boolean {
    if (message.type === "hello") {
        return typeof message.name === "string" && ["string", "undefined"].includes(typeof message.playerId) === true && ["string", "undefined"].includes(typeof message.resumeToken) === true && ["takeSeat", "newSeat", undefined].includes(message.sameName as string | undefined) === true;
    }
    if (message.type === "holdToTalk") {
        return typeof message.down === "boolean";
    }
    if (message.type === "presence") {
        return typeof message.away === "boolean";
    }
    if (message.type === "reactions") {
        return typeof message.wanted === "boolean";
    }
    if (message.type === "micSettings") {
        return typeof message.echoCancellation === "boolean" && typeof message.noiseSuppression === "boolean" && typeof message.autoGainControl === "boolean";
    }
    if (message.type === "released") {
        return message.why === undefined || TAP_ENDS.includes(message.why as TapEnd) === true;
    }
    if (message.type === "touched") {
        return true;
    }
    if (message.type === "rename") {
        return typeof message.name === "string";
    }
    if (message.type === "nav") {
        const action: { kind?: unknown; delta?: unknown; index?: unknown } | null = typeof message.action === "object" ? message.action : null;
        return action?.kind === "select" || action?.kind === "back" || (action?.kind === "choose" && typeof action.index === "number") || (action?.kind === "step" && typeof action.delta === "number" && Number.isFinite(action.delta) === true);
    }
    if (message.type === "lean") {
        return typeof message.x === "number" && typeof message.y === "number";
    }
    if (message.type === "guest") {
        return (message.action === "add" || message.action === "remove" || message.action === "inviteAgent") && ["string", "undefined"].includes(typeof message.playerId) === true;
    }
    if (message.type === "textOnlySay") {
        return typeof message.text === "string";
    }
    if (message.type === "answer") {
        return typeof message.controlId === "string" && (typeof message.value === "string" || typeof message.value === "number");
    }
    if (message.type === "input") {
        const input: { value?: unknown; controlIndex?: unknown } | null = typeof message.input === "object" ? message.input : null;
        return typeof input?.value === "string" && typeof input.controlIndex === "number";
    }
    return message.type === "leave";
}

/**
 * Parses a text frame into a message, or returns null when it is not valid JSON with a type.
 * @param raw the text frame.
 * @returns the parsed message or null.
 */
export function parseMessage<Message extends { type: string }>(raw: string): Message | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || typeof (parsed as { type?: unknown }).type !== "string") {
            return null;
        }
        return parsed as Message;
    } catch {
        return null;
    }
}
