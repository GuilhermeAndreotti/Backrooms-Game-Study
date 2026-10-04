# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A cooperative multiplayer 3D browser game set in the Backrooms universe. Up to 4 players (`ROOM_CAPACITY`) share a procedurally generated maze (from a shared seed), with decaying sanity, hostile entities, and real-time WebSocket sync. Single Node process serves both the built client and the game relay. UI copy is in Portuguese (the source language); code comments and identifiers are in English.

## Commands

```bash
npm install
npm run dev      # tsx watch server.ts — Vite middleware (client, HMR) + WS relay on one process, http://localhost:3000
npm run build    # vite build (client -> dist/client) + esbuild bundles server.ts -> dist/server.cjs
npm start        # NODE_ENV=production node dist/server.cjs
npm run lint     # tsc --noEmit (this is the only "lint"/typecheck step — no eslint)
npm run clean    # rm -rf dist
```

There is no test suite (no test runner configured, no `*.test.*`/`*.spec.*` files). Verifying a change means: `npm run lint`, then run `npm run dev` and check it in the browser — for gameplay/rendering changes, actually play the affected level.

The repo also carries `pnpm-lock.yaml`/`pnpm-workspace.yaml`, but treat `npm` as canonical — it's what `package-lock.json`, the Dockerfile, and CI use.

No `.env` is required; defaults in `.env.example` are sane. Key vars: `PORT`, `HOST`, `WS_PATH` (`/ws`), `ROOM_CAPACITY` (4), `TICK_HZ` (20), `MAX_ROOMS`, `MAX_CONNECTIONS`.

## Architecture

### Split: authoritative server vs. rendering client

- **`server.ts`** — Express + `ws`. Owns rooms, player roster, and *authoritative* game-flow state (which level the room is on, who's alive). It does **not** simulate gameplay (physics, monster AI, procedural generation) — it only relays and lightly validates.
- **`src/game/GameEngine.ts`** — the actual game: Three.js scene, camera, render loop, level/HUD wiring. Everything simulated (physics, AI, map generation) happens identically on every client because it's all derived from the same seeded RNG (`SeededRandom` in `ProceduralMap.ts`) — the server only needs to keep everyone on the same seed and level, not simulate the world itself.

### Per-level "world authority", not a server-side simulation

Monster AI, blackouts, and other level-wide random events used to run independently on every client (desynced). Now, for each level, exactly one connected client is elected "authority" (the longest-connected non-dead player on that level — `computeAuthority()` in `server.ts`, mirrored by `GameEngine.isWorldAuthority`) and streams `entities`/`world_event`/`ball` frames; the server validates and relays them to the rest of that level's players, who just render what they receive. Authority is recomputed every server tick and handed off seamlessly when the current authority disconnects or changes level.

### Level transitions are server-arbitrated

A player reaching an exit sends `level_transition_request`; the room only actually advances (and broadcasts `level_transition` to everyone) if the requested level is strictly ahead of `room.level`. This keeps the group moving through levels together instead of each player noclipping into their own separate instance. `room_reset` (after everyone dies) and `start_game` (leaving the lobby) follow the same pattern.

### Level numbering

Levels are plain numbers threaded through client and server (`GameEngine.level`, `PlayerState.level`, `RemotePlayer.level`). The source of truth is `src/game/levels/constants.ts`; per-level guides live in `docs/levels/`.

- Main route (`MAIN_LEVELS`): `0` → `1` (garage) → `2` (Pipe Dreams) → `3` Electrical Room → `4` Abandoned Office → `5` Poolrooms → `12` Level 79 Space Station.
- Secret/optional: `6` Lights Out (from Level 1), `7` Level G (from Level 4), `9` Level FUN (cake in Level 4), `8` Level 94 "The Old Town" (exit door in the Electrical Room, or Level 79's UNKNOWN course).
- `10` (`LOBBY_LEVEL`) — the room lobby every game starts in; the host triggers `start_game` (optionally picking a level).

**Network id ≠ content id.** `ProceduralMap` generates from a *content* id; `contentLevelFor()` maps network ids to it (e.g. Electrical Room 3→8, Poolrooms 5→7, Lights Out 6→3, Level G 7→4, Old Town 8→94, FUN 9→11). Comments/branches inside `ProceduralMap.ts` often use content ids. `ProceduralMap.gridSizeForLevel(level)` and the level branches in `GameEngine.ts`/`ProceduralMap.ts` care about this. See `docs/levels/README.md`.

### Procedural generation is deterministic and seed-driven

`ProceduralMap.ts` (~5.7k lines) builds the maze, rooms, props, lore-note placement, and secret-level entrances from a `SeededRandom` seeded once per room (`room.seed`, chosen server-side at room creation and handed to every client in `joined`/`level_transition`). Because generation is deterministic, the server never needs to transmit map geometry — every client reproduces the identical map from `(seed, level)`. Don't introduce `Math.random()` into anything that affects map layout, entity placement, or other cross-client-visible world state — it will desync clients silently.

### Client-authoritative movement, server-relayed at a fixed tick

Each client simulates its own physics/collision (`PlayerController.ts`) and sends `update` frames at ~25 Hz; the server does *not* validate physics, just clamps/sanitizes fields and batches all dirty players in a room into one `players_snapshot` broadcast per tick (`TICK_HZ`, default 20/s) rather than relaying every frame immediately — this turns O(N²) relay traffic into O(N) per tick. Remote players are interpolated client-side between snapshots.

### `App.tsx` — UI/connection state machine

`ConnectionPhase` (`src/types/game.ts`): `MENU → CONNECTING → (LOBBY →) PLAYING → ESCAPED | ERROR | GAME_OVER`. `App.tsx` owns the WebSocket connection, all React-visible game state (inventory, achievements, lore journal, chat, connected players, Level G progress), and mounts/unmounts `GameEngine` into a container div. Most gameplay logic itself lives in `GameEngine`, which talks back to React via constructor-injected callbacks (`GameEngineCallbacks`), not props/state.

### i18n

`src/i18n/` — pt-BR is the source language (`ptBR` dict defines the canonical `MessageKey` union); `en-US.ts` and `es.ts` must stay in sync with its keys. Call `t("some.key", { vars })` from anywhere, including non-React code (`GameEngine`, `ProceduralMap`) — it always reads the live selected language rather than being bound at render time. Language is persisted to `localStorage` and auto-detected from `navigator.language` on first run.

### Networking message types

The client/server protocol is a flat `{ type: ... }` JSON message set (join, update, players_snapshot, entities, world_event, box_push, levelg_code, entities_relocate, level_transition_request/level_transition, start_game, ball/ball_kick, died, room_reset, ping/pong, chat). When adding a new message type, add server-side validation/sanitization for every field the client controls (see the existing `sanitize*`/`gridInt`/`finiteNumber` helpers in `server.ts`) — the server trusts nothing from a client message body.

### Other notable pieces

- `src/game/Quality.ts` / `LightPool.ts` — graphics quality presets and a pooled-light system to bound the number of live dynamic lights (perf-critical given many rooms/props).
- `docs/` — player/developer guides: `docs/levels/` (one README per level) and `docs/entities.md`.
- `src/game/AudioManager.ts` — positional ambient/SFX audio, including procedural monster voice generation.
- `src/utils/achievements.ts` / `src/types/achievements.ts` — achievement definitions/unlock tracking, localized via `t()`.
- `src/utils/lore.ts` — procedural "Scrap of Note" journal-entry generation.
- `deploy/` — nginx config + systemd unit for running without Docker, as an alternative to the Docker/GHCR image built by `.github/workflows/main.yml` on every push to `main`.
