# Funhouse

An AI-hosted game night at [funhouse.live](https://funhouse.live). Friends scan a QR code with their phones and join a shared
room. An AI host runs the night: it listens to every player on their own stream, talks back,
draws on the big screen, keeps secrets, and can play too. Funhouse is the console; games
are cartridges: Twenty Doors, Quizmaster and Werewolf so far.

Built during the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. Everything in
this repository was written in that window.

## How Meta's models are used

| Need | Model | How |
| --- | --- | --- |
| Hear every player | Muse Voice Transcribe | One realtime WebSocket session per phone, so the room always knows who said what without diarization. `providers/meta/transcribe.ts` |
| Think and host | Muse Spark 1.3 | Streamed replies that are spoken as they are written, opening with a `[[ruling]]` when the host judges something. It also writes game content, such as secrets and quiz questions. `providers/meta/spark.ts` |
| Draw | Muse Image | Paintings drawn ahead of need: Werewolf's village through each phase, and the Twenty Doors secret for its reveal. `providers/meta/image.ts` |

Meta has no speech output, so the host's voice comes from a third-party text-to-speech
provider, OpenAI's Realtime API used only as a reader, behind a small interface in `providers/openai/speech.ts`.

## Credits

Paintings are AI-generated with Meta's Muse Image. The host's words and voice are AI too. The
lantern, icons and share image are drawn in code, with no AI art in them.

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
| `deploy/` | Containerfile for running the room anywhere. |

## Run

Requires Node 24 (`.nvmrc`) and npm. Copy `.env.example` to `.env` and fill in the keys.

```sh
npm install
npm run probe:asr        # proves the microphone path to Meta; costs under a cent
npm run room             # http://localhost:8740
```

## Verify

To play a whole game from a script, with no microphones or voice:

```sh
GAME_ROOM_TEXT_ONLY=1 npm run room
node tools/scenarios/twenty-doors.ts
```

To check the code:

```sh
npm run check            # verify.py, typecheck, lint, tests
```

## License

MIT. See `LICENSE`. Fraunces is under the SIL Open Font License. Paintings are AI-generated; see Credits.

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
