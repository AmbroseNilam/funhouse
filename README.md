# Game Room

An AI-hosted virtual game room. Friends scan a QR code with their phones and join a shared
room. An AI host runs the night: it listens to every player on their own stream, talks back,
draws on the big screen, keeps secrets, and can play too. Game Room is the console; games
are cartridges. Werewolf is the first cartridge.

Built during the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. Everything in
this repository was written in that window.

## How Meta's models are used

| Need | Model | How |
| --- | --- | --- |
| Hear every player | Muse Voice Transcribe | One realtime WebSocket session per phone, so the room always knows who said what without diarization. `providers/meta/transcribe.ts` |
| Think and host | Muse Spark 1.3 | Streamed completions with tool calls and structured output for scenes and phone controls. `providers/meta/spark.ts` |
| Draw | Muse Image | Scenes, role cards, victory murals on the big screen. |

Meta has no speech output, so the host's voice comes from a third-party text-to-speech
provider behind a small interface in `providers/openai/speech.ts`.

## Layout

| Path | Owns |
| --- | --- |
| `room/` | The runtime: HTTP and WebSocket server, the event timeline, visibility scopes, the host loop. |
| `shared/` | The vocabulary both sides agree on: scenes, phone controls, timeline events, the cartridge contract. |
| `screen/` | The public stage, a web page for a laptop or TV. |
| `landing/` | The front door at `/`: host on a big screen, or join with a room code. |
| `phone/` | The private stage, a web page opened from the QR code. Microphone capture lives here. |
| `cartridges/` | Games. Each has a manifest, a rules core, and simulated-player tests. |
| `providers/` | Meta and OpenAI clients. Provider details never leak past this folder. |
| `tools/` | Latency probes and the `verify.py` guard. |
| `deploy/` | Containerfile and the rootless Podman pod definition. |

## Run

Requires Node 24 (`.nvmrc`) and npm. Copy `.env.example` to `.env` and fill in the keys.

```sh
npm install
npm run probe:asr        # proves the microphone path to Meta; costs under a cent
npm run room             # http://localhost:8740
```

## Verify

```sh
npm run check            # verify.py, typecheck, lint, tests
```

## Conventions

Follows the Ambrose Nilam Engineering Standards: guard clauses and no `else`, braces on
every block, `=== true` and `=== false` for scanability, full-word names, explicit types,
a purpose comment at the top of every file, doc comments on every export, 4-space
indentation, minimal dependencies. `tools/verify.py` fails the build on the parts a
linter cannot see.

## Decisions

Dated decisions live in the planning notes alongside this repository. The short version:
rooms first and the game is chosen inside; rules are code and the host never overrides
them; every fact has a visibility scope; the host wakes only on events; WebSocket audio
relay now with WebRTC as a later upgrade; web only, no native apps.
