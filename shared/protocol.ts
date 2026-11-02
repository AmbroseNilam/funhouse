// Messages between the room and its stages. Text frames carry JSON of these shapes; binary
// frames carry audio: phone to room is raw 24 kHz 16-bit mono PCM, room to screen is encoded
// host speech. Both stages reduce messages into local state; the room is the only writer.

import type { ControlInput, PhoneView } from "./controls.ts";
import type { Scene } from "./scene.ts";

/** Phone to room. */
export type PhoneMessage =
    | { type: "hello"; name: string; playerId?: string }
    | { type: "input"; input: ControlInput }
    | { type: "holdToTalk"; down: boolean };

/** Room to phone. */
export type RoomToPhoneMessage =
    | { type: "welcome"; playerId: string; roomCode: string }
    | { type: "view"; view: PhoneView }
    | { type: "rejected"; reason: string };

/** Screen to room. */
export type ScreenMessage =
    | { type: "hello" };

/** Room to screen. Host audio follows as binary frames after an audioStart. */
export type RoomToScreenMessage =
    | { type: "scene"; scene: Scene; joinUrl: string; roomCode: string }
    | { type: "audioStart"; mediaType: string }
    | { type: "audioEnd" }
    | { type: "hostState"; listening: boolean; speaking: boolean };

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
