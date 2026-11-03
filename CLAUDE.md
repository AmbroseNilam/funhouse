# Working on Funhouse

Read `DESIGN.md` before changing anything a player sees, and follow it exactly. Check `README.md`
for the layout and how to run it.

- **Code:** Node 24, strict TypeScript run directly by Node, `node:http` and `ws`, React and Vite, plain
  CSS. Justify any new dependency. Guard clauses, no `else`, braces on every block, `=== true` and
  `=== false`, full-word names, explicit types, a purpose comment at the top of every file, doc comments on
  exports, 4-space indent.
- **Checks before every commit:** `python3 tools/verify.py`, `npx tsc --noEmit`, `npx eslint .`. Commit
  only if they pass. Play a game with `GAME_ROOM_TEXT_ONLY=1` and `tools/scenarios/`.
- **Commits:** small, with a message that says why and what was really verified.
- **Logs:** never what anyone said, what the host replied, or a player's name.
- **Secrets:** never read or print `.env`, and never commit it.
