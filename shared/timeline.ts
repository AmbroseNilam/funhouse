// Everything that happens in a room is an event on one ordered timeline: speech turns, taps,
// phase changes, host lines, drawings, timers. The cartridge reacts to it, the host is woken
// by it, the recap reads it, and tests replay it. Bounded in memory by the room.

import type { ScopedFact } from "./visibility.ts";

/** One entry on the timeline. */
export type RoomEvent =
    | { type: "playerJoined"; at: number; playerId: string; name: string }
    | { type: "playerLeft"; at: number; playerId: string }
    | { type: "speechStarted"; at: number; playerId: string }
    | { type: "speechEnded"; at: number; playerId: string; text: string }
    | { type: "controlUsed"; at: number; playerId: string; value: string; controlIndex: number }
    | { type: "phaseChanged"; at: number; phaseId: string }
    | { type: "timerFired"; at: number; timerId: string }
    | { type: "silence"; at: number; seconds: number }
    | { type: "hostSaid"; at: number; text: string; scopeKey: string }
    | { type: "hostDrew"; at: number; prompt: string; src: string }
    | { type: "fact"; at: number; fact: ScopedFact }
    | { type: "hostRuled"; at: number; ruling: string; detail: string; playerId: string | null }
    | { type: "contentReady"; at: number; text: string };

/** Maximum events a room keeps in memory; older ones roll off the front. */
export const TIMELINE_LIMIT: number = 5000;

/**
 * Appends an event, trimming the oldest when the bound is exceeded.
 * @param timeline the room's event list, mutated in place by its single owner.
 * @param event the event to append.
 */
export function appendEvent(timeline: RoomEvent[], event: RoomEvent): void {
    timeline.push(event);
    if (timeline.length <= TIMELINE_LIMIT) {
        return;
    }
    timeline.splice(0, timeline.length - TIMELINE_LIMIT);
}
