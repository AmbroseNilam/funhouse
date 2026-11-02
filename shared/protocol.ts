// Messages between the room and its stages. Text frames carry JSON of these shapes; binary
// frames carry audio: phone to room is raw 24 kHz 16-bit mono PCM, room to screen is encoded
// host speech. Both stages reduce messages into local state; the room is the only writer.

import type { ControlInput, PhoneView } from "./controls.ts";
import type { Scene } from "./scene.ts";

/** Why the room turned a stage away. */
export type RejectedReason = "unknownRoom" | "roomFull" | "noRoomsFree";

/** Phone to room. */
export type PhoneMessage =
    | { type: "hello"; name: string; playerId?: string; resumeToken?: string }
    | { type: "input"; input: ControlInput }
    | { type: "holdToTalk"; down: boolean }
    | { type: "rename"; name: string }
    | { type: "leave" }
    | { type: "textOnlySay"; text: string };

/** Room to phone. */
export type RoomToPhoneMessage =
    | { type: "welcome"; playerId: string; roomCode: string; name: string; resumeToken: string }
    | { type: "view"; view: PhoneView }
    | { type: "rejected"; reason: RejectedReason }
    | { type: "heartbeat" };

/** Screen to room. */
export type ScreenMessage =
    | { type: "hello" }
    | { type: "ready" };

/**
 * Room to screen. Host audio follows as binary 24 kHz 16-bit mono PCM frames after an
 * audioStart; audioCancel means drop anything still queued because someone cut in.
 */
export type RoomToScreenMessage =
    | { type: "scene"; scene: Scene; joinUrl: string; roomCode: string }
    | { type: "audioStart"; mediaType: string }
    | { type: "audioEnd" }
    | { type: "audioCancel" }
    | { type: "hostState"; thinking: boolean; speaking: boolean; hostName: string }
    | { type: "micLevel"; level: number }
    | { type: "rejected"; reason: RejectedReason }
    | { type: "heartbeat" };

/** How long a stage waits with nothing from the server before it assumes the connection died. */
export const SERVER_SILENCE_LIMIT_MILLISECONDS: number = 70000;

/**
 * Checks a parsed message from a phone has the fields the room will read. Phones are outside
 * the room's trust, and a missing field must not bring the room down.
 * @param message a message with some type.
 * @returns true when it is a well-formed phone message.
 */
export function isPhoneMessage(message: { type: string } & Record<string, unknown>): boolean {
    if (message.type === "hello") {
        return typeof message.name === "string" && ["string", "undefined"].includes(typeof message.playerId) === true && ["string", "undefined"].includes(typeof message.resumeToken) === true;
    }
    if (message.type === "holdToTalk") {
        return typeof message.down === "boolean";
    }
    if (message.type === "rename") {
        return typeof message.name === "string";
    }
    if (message.type === "textOnlySay") {
        return typeof message.text === "string";
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
