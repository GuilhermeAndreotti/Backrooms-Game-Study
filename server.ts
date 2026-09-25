/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backrooms Level 0 -- game + realtime relay server.
 *
 * One Node process serves the built client and the WebSocket relay, so a VPS
 * only needs a single port open (or a single reverse-proxy upstream).
 */

import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { ALL_ENTITY_TYPES } from "./src/shared/entityTypes";
import { ROOM_CHEATS, SUDO_CHEAT, type DeathAction, type RoomCheat, type RoomConfig } from "./src/types/game";
import { LOBBY_LEVEL, MAIN_LEVELS, LEVEL_G, LIGHTS_OUT_LEVEL, MOTION_LEVEL, POOLROOMS_LEVEL, ELECTRICAL_ROOM_LEVEL, ABANDONED_OFFICE_LEVEL, nextMainLevel } from "./src/game/levels/constants";
import { POOL_ROOM_COUNT, POOL_VALVE_COUNT, POOL_VALVES_PER_ROOM, poolValveOrderForSeed } from "./src/game/poolroomsPuzzle";

// ---------------------------------------------------------------------------
// Configuration (everything overridable from the environment / .env)
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const WS_PATH = process.env.WS_PATH ?? "/ws";

/** Players allowed in a single room. */
const ROOM_CAPACITY = Number(process.env.ROOM_CAPACITY ?? 4);
/** Rooms allowed to exist at once; protects a small VPS from unbounded growth. */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 200);
/** Total simultaneous connections accepted. */
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 200);

/** How often each room broadcasts a movement snapshot. */
const TICK_HZ = Number(process.env.TICK_HZ ?? 20);
const TICK_MS = Math.max(20, Math.round(1000 / TICK_HZ));

/** Largest accepted client frame; anything bigger is a bug or an attack. */
// 16KB: comfortably fits a WebRTC SDP offer/answer (VOIP signaling), the
// largest frame this relay ever sees.
const MAX_MESSAGE_BYTES = 16 * 1024;
/** Silence a client that has not answered a ping within this window. */
const HEARTBEAT_MS = 30_000;

const MAX_NAME_LENGTH = 24;
const MAX_CHAT_LENGTH = 240;
/** Chat messages allowed per player per CHAT_WINDOW_MS. */
const CHAT_BURST = 8;
const CHAT_WINDOW_MS = 10_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PlayerState {
  id: string;
  name: string;
  room: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flashlight: boolean;
  state: string; // 'idle' | 'walking' | 'running' | 'crouching'
  level: number;
  suitColor: string; // hex, validated against SUIT_COLORS at join time
  /**
   * Died (sanity at zero, ...) and is spectating. Revived for everyone when
   * the room advances a level or resets; the room only resets once every
   * player is dead.
   */
  dead: boolean;
  exitReady: boolean;
  /**
   * Hand-drawn helmet face: 16x16 palette digits (see src/utils/face.ts), or
   * "" for none. Sent with the join/roster messages only — stripped from the
   * movement snapshots so it isn't re-sent 20 times a second.
   */
  face: string;
  /**
   * Lobby SKIN cheat: an EntityType name worn instead of the hazmat suit, or
   * "" for none. Unlike `face`, this can change mid-session, so (unlike
   * `face`) it rides along on every movement snapshot.
   */
  monsterSkin: string;
}

/**
 * Hazmat suit colours the client offers in its customization screen. Kept in
 * sync with SUIT_COLORS in src/types/game.ts. Anything a client sends outside
 * this set is rejected and replaced with the default.
 */
const ALLOWED_SUIT_COLORS = new Set([
  "#deb81d", "#d94f2b", "#3f7d3a", "#2f6f8f",
  "#8a3ab0", "#b0243a", "#c9c2b0", "#1c1c22",
]);
const DEFAULT_SUIT_COLOR = "#deb81d";

function sanitizeSuitColor(value: unknown): string {
  return typeof value === "string" && ALLOWED_SUIT_COLORS.has(value.toLowerCase())
    ? value.toLowerCase()
    : DEFAULT_SUIT_COLOR;
}

/** 16x16 pixels, one palette digit each (0 = transparent, 1-7 = FACE_PALETTE). */
const FACE_PATTERN = /^[0-7]{256}$/;

function sanitizeFace(value: unknown): string {
  return typeof value === "string" && FACE_PATTERN.test(value) ? value : "";
}

/** Monster bodies the lobby's SKIN cheat may hand out — kept in sync with client-side MONSTER_SKIN_TYPES. */
const MONSTER_SKIN_TYPES = new Set(["DULLER", "HOUND", "CLUMP", "SKIN_STEALER", "WRETCH"]);

function sanitizeMonsterSkin(value: unknown): string {
  return typeof value === "string" && MONSTER_SKIN_TYPES.has(value) ? value : "";
}

interface Connection {
  ws: WebSocket;
  player: PlayerState;
  isAlive: boolean;
  chatTimestamps: number[];
}

interface Room {
  seed: number;
  /**
   * The level the whole room is on. Authoritative: a player reaching an exit
   * only *requests* an advance (see "level_transition_request"); this is what
   * actually decides it and gets broadcast back to everyone, so the group
   * always transitions together instead of each explorer noclipping into
   * their own separate next level.
   */
  level: number;
  /** Host-controlled settings, mutable only while the room is in the lobby. */
  config: RoomConfig;
  /** Cheats unlocked at the lobby terminal — they apply to every player in the room, for the room's lifetime. */
  cheats: Set<RoomCheat>;
  /** Player who can start the expedition from the lobby (first to join; passes on when they leave). */
  hostId: string;
  players: Map<string, PlayerState>;
  /** Sockets in this room, so a broadcast never scans unrelated connections. */
  connections: Set<Connection>;
  /** Players whose state changed since the last tick. */
  dirty: Set<string>;
  /** Last "authority" map broadcast (serialized), to only re-send on change. */
  authorityKey: string;
  /** Authoritative Poolrooms puzzle state; clients only render snapshots of it. */
  poolValvesTurned: Set<number>;
  poolValveRevision: number;
}

const rooms = new Map<string, Room>();
const connections = new Map<WebSocket, Connection>();

const DEFAULT_ROOM_CONFIG: RoomConfig = {
  deathAction: "current_level",
  secretRoutes: true,
};
const DEATH_ACTIONS = new Set<DeathAction>(["current_level", "level_0", "lobby"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips control characters: they render as garbage and can break terminals. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, maxLength);
}

/** Invite codes: 6 characters, no lookalikes (0/O, 1/I). Example: AB4D3X. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return Date.now().toString(36).toUpperCase().slice(-CODE_LENGTH);
}

/** Uppercased alphanumeric code, or "" if the input can't be a room code. */
function sanitizeRoomCode(value: unknown): string {
  const raw = typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  return raw.length >= 4 && raw.length <= 12 ? raw : "";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeRoomConfig(value: unknown, current: RoomConfig): RoomConfig {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const deathAction = DEATH_ACTIONS.has(raw.deathAction as DeathAction)
    ? raw.deathAction as DeathAction
    : current.deathAction;
  const secretRoutes = typeof raw.secretRoutes === "boolean"
    ? raw.secretRoutes
    : current.secretRoutes ?? DEFAULT_ROOM_CONFIG.secretRoutes;
  return { deathAction, secretRoutes };
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

/** Broadcast to everyone in a room, optionally skipping one connection. */
function broadcastToRoom(room: Room, payload: unknown, exclude?: Connection) {
  const raw = JSON.stringify(payload);
  room.connections.forEach((conn) => {
    if (conn === exclude) return;
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(raw);
  });
}

// ---------------------------------------------------------------------------
// World authority (monsters, smilers, blackouts)
// ---------------------------------------------------------------------------
//
// Monster AI and the level-wide blackout rolls used to run independently on
// every client, off Math.random — so each explorer saw different monsters in
// different places. Now, per level, exactly one client simulates them (the
// longest-connected player on that level: room.players keeps join order) and
// streams the result; everyone else on that level just renders it. When that
// player leaves or changes level, the next one takes over seamlessly, since
// every client already holds the full replicated state.

/** Level (as a string key) -> id of the player simulating it. */
function computeAuthority(room: Room): Record<string, string> {
  const byLevel: Record<string, string> = {};
  // Living players first: a spectator shouldn't be the one simulating monsters.
  room.players.forEach((p) => {
    const key = String(p.level);
    if (!p.dead && !p.exitReady && !(key in byLevel)) byLevel[key] = p.id;
  });
  room.players.forEach((p) => {
    const key = String(p.level);
    if (!p.exitReady && !(key in byLevel)) byLevel[key] = p.id;
  });
  return byLevel;
}

/** Broadcasts the authority map if it changed since the last broadcast. */
function refreshAuthority(room: Room) {
  const byLevel = computeAuthority(room);
  const key = JSON.stringify(byLevel);
  if (key === room.authorityKey) return;
  room.authorityKey = key;
  broadcastToRoom(room, { type: "authority", byLevel });
}

/** Sends to every player in the room currently on `level`, except `exclude`. */
function broadcastToLevel(room: Room, level: number, payload: unknown, exclude?: Connection) {
  const raw = JSON.stringify(payload);
  room.connections.forEach((conn) => {
    if (conn === exclude || conn.player.level !== level) return;
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(raw);
  });
}

function poolroomsSnapshot(room: Room) {
  let stage = 0;
  for (let sector = 0; sector < POOL_ROOM_COUNT; sector++) {
    let solved = true;
    for (let valve = 0; valve < POOL_VALVES_PER_ROOM; valve++) {
      if (!room.poolValvesTurned.has(sector * POOL_VALVES_PER_ROOM + valve)) solved = false;
    }
    if (solved) stage++;
  }
  return {
    revision: room.poolValveRevision,
    turned: [...room.poolValvesTurned].sort((a, b) => a - b),
    stage,
    solved: stage === POOL_ROOM_COUNT,
  };
}

function resetPoolroomsState(room: Room) {
  room.poolValvesTurned.clear();
  room.poolValveRevision++;
}

/** Applies one serialized valve attempt and returns the resulting full state. */
function applyPoolValveTurn(room: Room, index: number) {
  if (room.poolValvesTurned.has(index)) return poolroomsSnapshot(room);

  const order = poolValveOrderForSeed(room.seed);
  const sector = Math.floor(index / POOL_VALVES_PER_ROOM);
  const base = sector * POOL_VALVES_PER_ROOM;
  let done = 0;
  for (let valve = 0; valve < POOL_VALVES_PER_ROOM; valve++) {
    if (room.poolValvesTurned.has(base + valve)) done++;
  }

  if (index !== base + order[sector][done]) {
    for (let valve = 0; valve < POOL_VALVES_PER_ROOM; valve++) room.poolValvesTurned.delete(base + valve);
  } else {
    room.poolValvesTurned.add(index);
  }
  room.poolValveRevision++;
  return poolroomsSnapshot(room);
}

// Derived from the shared enum (not hand-maintained) so a type the client can
// actually send is never silently rejected here — this used to omit
// FINGER_KING, which meant Level G's authority's "entities" frame (always
// containing the King) was silently dropped for every other player in the
// room (sanitizeEntities nulls the whole frame on one unrecognized `t`).
const ENTITY_TYPES = new Set<string>(ALL_ENTITY_TYPES);
const MAX_ENTITIES = 40;
const MAX_SMILERS = 8;
const MAX_SPEECH_LENGTH = 64;
/** Level-wide events the authority may broadcast ("levelg_alarm": Level G's final alarm). */
const GLOBAL_EVENTS = new Set(["flicker_storm", "blackout", "levelg_alarm"]);

function gridInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 256 ? value : null;
}

function netId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1e9 ? value : null;
}

/** Rebuilds an "entities" frame from known fields only; null if malformed. */
function sanitizeEntities(data: Record<string, unknown>) {
  if (!Array.isArray(data.list) || data.list.length > MAX_ENTITIES) return null;
  const smilersIn = Array.isArray(data.smilers) ? data.smilers.slice(0, MAX_SMILERS) : [];

  const list = [];
  for (const raw of data.list) {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as Record<string, unknown>;
    const id = netId(e.id);
    const gx = gridInt(e.gx), gz = gridInt(e.gz), tx = gridInt(e.tx), tz = gridInt(e.tz);
    if (id === null || gx === null || gz === null || tx === null || tz === null) return null;
    if (typeof e.t !== "string" || !ENTITY_TYPES.has(e.t)) return null;
    list.push({
      id, t: e.t, gx, gz, tx, tz,
      p: Math.min(1, Math.max(0, finiteNumber(e.p, 0))),
      v: Math.min(10, Math.max(0, finiteNumber(e.v, 0))),
      m: e.m === true,
      a: e.a === true,
      c: e.c === true,
      s: sanitizeText(e.s, MAX_SPEECH_LENGTH),
      // Scripted pose (e.g. the Finger King's stare): a small enum, 0 = none.
      k: typeof e.k === "number" && Number.isInteger(e.k) && e.k >= 0 && e.k < 8 ? e.k : 0,
    });
  }

  const smilers = [];
  for (const raw of smilersIn) {
    if (!raw || typeof raw !== "object") return null;
    const s = raw as Record<string, unknown>;
    const id = netId(s.id), gx = gridInt(s.gx), gz = gridInt(s.gz);
    if (id === null || gx === null || gz === null) return null;
    smilers.push({ id, gx, gz });
  }

  return { list, smilers };
}

function resetRoom(room: Room, action: DeathAction) {
  const scratch = action === "level_0";
  const toLobby = action === "lobby";
  if (scratch) room.level = 0;
  if (toLobby) room.level = LOBBY_LEVEL;
  resetPoolroomsState(room);
  reviveAll(room);
  room.players.forEach((p) => { p.level = room.level; });
  refreshAuthority(room);
  broadcastToRoom(room, {
    type: "respawn",
    level: room.level,
    seed: room.seed,
    scratch,
    toLobby,
    poolroomsState: room.level === POOLROOMS_LEVEL ? poolroomsSnapshot(room) : null,
  });
}

/**
 * The players actually on the expedition: once it has started, explorers who
 * went back to the lobby on their own (return_to_lobby_request) are waiting
 * there, not playing, so they neither keep a wiped group "alive" nor hold up
 * the exit.
 */
function expeditionPlayers(room: Room): PlayerState[] {
  const all = Array.from(room.players.values());
  return room.level === LOBBY_LEVEL ? all : all.filter((p) => p.level !== LOBBY_LEVEL);
}

/** Tells the room every player is dead and applies its configured reset once. */
function checkAllDead(room: Room, autoReset = true) {
  const players = expeditionPlayers(room);
  if (players.length === 0) return;
  for (const p of players) if (!p.dead) return;
  broadcastToRoom(room, { type: "all_dead" });
  if (autoReset) resetRoom(room, room.config.deathAction);
}

/**
 * Moves the room on once every living explorer on its level is waiting at
 * the exit. Re-checked whenever someone stops counting towards that — they
 * reach the exit, leave the room, or go back to the lobby — so nobody is left
 * stuck at the door waiting for a player who is gone.
 */
function tryAdvanceRoom(room: Room) {
  if (room.level === LOBBY_LEVEL) return;
  const onLevel = Array.from(room.players.values()).filter((p) => p.level === room.level);
  if (!onLevel.some((p) => p.exitReady)) return;
  if (onLevel.some((p) => !p.dead && !p.exitReady)) return;

  if (room.level === POOLROOMS_LEVEL) {
    room.level = LOBBY_LEVEL;
    reviveAll(room);
    room.players.forEach((p) => { p.level = LOBBY_LEVEL; p.exitReady = false; room.dirty.add(p.id); });
    refreshAuthority(room);
    broadcastToRoom(room, { type: "return_to_lobby", level: LOBBY_LEVEL, seed: room.seed, completed: true });
    return;
  }

  const expected = nextMainLevel(room.level);
  if (expected === null) return;
  room.level = expected;
  if (room.level === POOLROOMS_LEVEL) resetPoolroomsState(room);
  reviveAll(room);
  room.players.forEach((p) => {
    // Secret players may finish their detour independently. They join
    // the main room once it reaches their convergence point. Players who
    // went back to the lobby rejoin the group here.
    if (p.level === LIGHTS_OUT_LEVEL || p.level === LEVEL_G) {
      if (room.level >= 4) p.level = room.level;
    } else {
      p.level = room.level;
    }
    p.exitReady = false;
    room.dirty.add(p.id);
  });
  refreshAuthority(room);
  broadcastToRoom(room, {
    type: "level_transition",
    level: room.level,
    seed: room.seed,
    convergence: room.level >= 4,
    poolroomsState: room.level === POOLROOMS_LEVEL ? poolroomsSnapshot(room) : null,
  });
}

function reviveAll(room: Room) {
  // Marked dirty so the next snapshot tells every client they're alive again.
  room.players.forEach((p) => { p.dead = false; p.exitReady = false; room.dirty.add(p.id); });
}

function removeConnection(conn: Connection) {
  connections.delete(conn.ws);

  const room = rooms.get(conn.player.room);
  if (!room) return;

  room.connections.delete(conn);
  room.players.delete(conn.player.id);
  room.dirty.delete(conn.player.id);
  if (room.hostId === conn.player.id) {
    room.hostId = room.players.keys().next().value ?? "";
    if (room.hostId) broadcastToRoom(room, { type: "host", id: room.hostId });
  }

  broadcastToRoom(room, { type: "player_left", id: conn.player.id });
  refreshAuthority(room);
  checkAllDead(room, false); // the last living player leaving strands the dead ones
  tryAdvanceRoom(room); // ...or the last one the others were waiting for at the exit

  if (room.players.size === 0) {
    rooms.delete(conn.player.room);
    console.log(`Room "${conn.player.room}" is empty. Destroyed.`);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  // Behind nginx/Caddy, so req.ip and req.protocol reflect the real client.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  wss.on("connection", (ws: WebSocket) => {
    if (connections.size >= MAX_CONNECTIONS) {
      send(ws, { type: "error", error: "Servidor lotado. Tente novamente em instantes." });
      ws.close();
      return;
    }

    let conn: Connection | null = null;

    ws.on("message", (rawMessage: Buffer) => {
      if (rawMessage.length > MAX_MESSAGE_BYTES) {
        ws.close(1009, "payload too large");
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawMessage.toString());
      } catch {
        return; // malformed frame: ignore rather than kill the session
      }
      if (!data || typeof data !== "object") return;

      const type = data.type;

      // --- join -------------------------------------------------------------
      if (type === "join") {
        if (conn) return; // already joined; ignore duplicates

        // Creating makes a fresh room with a new invite code; joining needs an existing code.
        let roomKey: string;
        let room: Room | undefined;
        if (data.create === true) {
          if (rooms.size >= MAX_ROOMS) {
            send(ws, { type: "room_full", reason: "server" });
            ws.close();
            return;
          }
          roomKey = generateRoomCode();
          const requestedSeed = data.requestedSeed;
          const seed =
            typeof requestedSeed === "number" && requestedSeed > 0 && Number.isFinite(requestedSeed)
              ? Math.floor(requestedSeed)
              : Math.floor(Math.random() * 999999) + 1;
          room = {
            seed,
            level: LOBBY_LEVEL,
            config: { ...DEFAULT_ROOM_CONFIG },
            cheats: new Set(),
            hostId: "",
            players: new Map(),
            connections: new Set(),
            dirty: new Set(),
            authorityKey: "",
            poolValvesTurned: new Set(),
            poolValveRevision: 0,
          };
          rooms.set(roomKey, room);
          console.log(`Created new room "${roomKey}" with seed ${seed}`);
        } else {
          roomKey = sanitizeRoomCode(data.room);
          room = roomKey ? rooms.get(roomKey) : undefined;
          if (!room) {
            send(ws, { type: "room_not_found" });
            ws.close();
            return;
          }
        }

        if (room.players.size >= ROOM_CAPACITY) {
          send(ws, {
            type: "room_full",
            reason: "capacity",
            capacity: ROOM_CAPACITY,
          });
          ws.close();
          return;
        }

        const playerId = Math.random().toString(36).slice(2, 11);
        const player: PlayerState = {
          id: playerId,
          name: sanitizeText(data.name, MAX_NAME_LENGTH) || `Infiltrado #${room.players.size + 1}`,
          room: roomKey,
          x: finiteNumber(data.x, 0),
          y: finiteNumber(data.y, 0),
          z: finiteNumber(data.z, 0),
          yaw: 0,
          pitch: 0,
          flashlight: false,
          state: "idle",
          level: room.level,
          suitColor: sanitizeSuitColor(data.suitColor),
          dead: false,
          exitReady: false,
          face: sanitizeFace(data.face),
          monsterSkin: sanitizeMonsterSkin(data.monsterSkin),
        };

        conn = { ws, player, isAlive: true, chatTimestamps: [] };
        connections.set(ws, conn);
        room.connections.add(conn);
        room.players.set(playerId, player);
        if (!room.hostId) room.hostId = playerId;

        // 1. Confirm join to self: client id, shared map seed, current roster and
        // level — a room the rest of the group already advanced past Level 0 in
        // must not hand a fresh joiner a Level 0 map.
        send(ws, {
          type: "joined",
          id: playerId,
          seed: room.seed,
          level: room.level,
          code: roomKey,
          hostId: room.hostId,
          roomConfig: room.config,
          cheats: [...room.cheats],
          poolroomsState: room.level === POOLROOMS_LEVEL ? poolroomsSnapshot(room) : null,
          players: Array.from(room.players.values()).filter((p) => p.id !== playerId),
          authority: computeAuthority(room),
        });

        // 2. Announce to the rest of the room.
        broadcastToRoom(room, { type: "player_joined", player }, conn);

        console.log(`Player "${player.name}" (${playerId}) joined room "${roomKey}"`);
        return;
      }

      if (!conn) return; // every other message requires a joined session
      const room = rooms.get(conn.player.room);
      if (!room) return;

      // --- movement ---------------------------------------------------------
      if (type === "update") {
        const p = conn.player;
        if (p.dead || p.exitReady) return;
        // Frames already in flight when the server moved this player between
        // the expedition and the lobby (return_to_lobby_request, start_game,
        // a transition pulling them back in) still carry the level they left.
        // Applying one would drag the player back there server-side: the room
        // then never becomes a lobby again (start_game refused) and teammates
        // in the lobby stop seeing them. Drop them whole (stale position too).
        const frameLevel = finiteNumber(data.level, p.level);
        if (room.level === LOBBY_LEVEL
          ? frameLevel !== LOBBY_LEVEL // the whole room is in the lobby: any other level is a leftover (even a private one)
          : (p.level === LOBBY_LEVEL) !== (frameLevel === LOBBY_LEVEL)) return;
        p.x = finiteNumber(data.x, p.x);
        p.y = finiteNumber(data.y, p.y);
        p.z = finiteNumber(data.z, p.z);
        p.yaw = finiteNumber(data.yaw, p.yaw);
        p.pitch = finiteNumber(data.pitch, p.pitch);
        p.flashlight = typeof data.flashlight === "boolean" ? data.flashlight : p.flashlight;
        p.state = typeof data.state === "string" ? data.state.slice(0, 16) : p.state;
        const requestedPlayerLevel = finiteNumber(data.level, p.level);
        const isPrivateLevel = requestedPlayerLevel === LIGHTS_OUT_LEVEL || requestedPlayerLevel === LEVEL_G || requestedPlayerLevel === MOTION_LEVEL;
        const isAllowedMainLevel = (MAIN_LEVELS as readonly number[]).includes(requestedPlayerLevel) || requestedPlayerLevel === LOBBY_LEVEL;
        if (Number.isInteger(requestedPlayerLevel) && (isPrivateLevel || (isAllowedMainLevel && requestedPlayerLevel === room.level))) {
          p.level = requestedPlayerLevel;
        }
        if (data.monsterSkin !== undefined) p.monsterSkin = sanitizeMonsterSkin(data.monsterSkin);

        // Queued instead of relayed immediately: see the room tick below.
        room.dirty.add(p.id);
        return;
      }

      // --- replicated world (monsters, smilers, blackouts) --------------------
      // Only accepted from the level's authority, and only for the level the
      // server last saw it on; relayed to the other players on that level.
      if (type === "entities" || type === "world_event") {
        const level = conn.player.level;
        if (data.level !== level) return;
        if (computeAuthority(room)[String(level)] !== conn.player.id) return;

        if (type === "entities") {
          const frame = sanitizeEntities(data);
          if (!frame) return;
          broadcastToLevel(room, level, { type, level, ...frame }, conn);
        } else {
          if (typeof data.state !== "string" || !GLOBAL_EVENTS.has(data.state)) return;
          const duration = Math.min(15, Math.max(0, finiteNumber(data.duration, 0)));
          broadcastToLevel(room, level, { type, level, state: data.state, duration }, conn);
        }
        return;
      }

      // A player shoved a box/crate: replay it for everyone else on that level.
      // The id is the prop's "gx,gz" cell (maps are seeded, so ids match on every client).
      if (type === "box_push") {
        const level = conn.player.level;
        const x = data.x, z = data.z;
        if (data.level !== level || typeof data.id !== "string" || !/^\d{1,3},\d{1,3}$/.test(data.id)) return;
        if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return;
        broadcastToLevel(room, level, { type: "box_push", level, id: data.id, x, z }, conn);
        return;
      }

      // Poolrooms valve attempts are serialized here. The server owns the sequence
      // and broadcasts the complete state so late joiners and simultaneous inputs
      // cannot leave clients with different water/door states.
      if (type === "valve_turn") {
        const level = conn.player.level;
        const index = data.index;
        if (level !== POOLROOMS_LEVEL || data.level !== level || typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= POOL_VALVE_COUNT) return;
        const state = applyPoolValveTurn(room, index);
        broadcastToLevel(room, level, { type: "poolrooms_state", level, ...state });
        return;
      }

      // Brick Offices: five idempotent wall switches open the barred gate.
      if (type === "brick_office_switch") {
        const level = conn.player.level;
        const index = data.index;
        if (level !== ELECTRICAL_ROOM_LEVEL || data.level !== level || typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 4) return;
        broadcastToLevel(room, level, { type: "brick_office_switch", level, index }, conn);
        return;
      }

      // Level G: a non-authority player typed a code into the terminal. The
      // authority decides (alarm for everyone, or sets the monster on them).
      if (type === "levelg_code") {
        const level = conn.player.level;
        const authorityId = computeAuthority(room)[String(level)];
        if (!authorityId || authorityId === conn.player.id) return;
        room.connections.forEach((c) => {
          if (c.player.id === authorityId) send(c.ws, { type: "levelg_code", level, ok: data.ok === true });
        });
        return;
      }

      // A non-authority player got caught: ask the authority to push every
      // monster on that level away from where the player respawned.
      if (type === "entities_relocate") {
        const level = conn.player.level;
        const authorityId = computeAuthority(room)[String(level)];
        const gx = gridInt(data.gx), gz = gridInt(data.gz);
        if (!authorityId || authorityId === conn.player.id || gx === null || gz === null) return;
        room.connections.forEach((c) => {
          if (c.player.id === authorityId) send(c.ws, { type: "entities_relocate", level, gx, gz });
        });
        return;
      }

      // --- level transition ---------------------------------------------------
      // Reaching an exit is a readiness signal, not an immediate room-wide
      // transition. The room advances only when every living explorer on the
      // current main route is ready.
      if (type === "level_transition_request") {
        const requestedLevel = data.level;
        if (typeof requestedLevel !== "number" || !Number.isFinite(requestedLevel)) return;
        if (conn.player.dead || conn.player.exitReady) return;
        const requested = Math.floor(requestedLevel);
        if (data.secret === true && room.config.secretRoutes === false) return;

        // Escaping Lights Out takes the whole room to Electrical Room. Unlike
        // Level G, this is a shared route rather than a private convergence.
        if (conn.player.level === LIGHTS_OUT_LEVEL && requested === ELECTRICAL_ROOM_LEVEL && data.secret === true) {
          room.level = ELECTRICAL_ROOM_LEVEL;
          reviveAll(room);
          room.players.forEach((p) => {
            p.level = ELECTRICAL_ROOM_LEVEL;
            p.exitReady = false;
            room.dirty.add(p.id);
          });
          refreshAuthority(room);
          broadcastToRoom(room, { type: "level_transition", level: ELECTRICAL_ROOM_LEVEL, seed: room.seed, secret: true });
          return;
        }

        // Level G remains a private route that converges at Abandoned Office.
        if (conn.player.level === LEVEL_G && requested === ABANDONED_OFFICE_LEVEL && data.secret === true) {
          conn.player.level = ABANDONED_OFFICE_LEVEL;
          conn.player.exitReady = false;
          room.dirty.add(conn.player.id);
          send(conn.ws, { type: "level_transition", level: ABANDONED_OFFICE_LEVEL, seed: room.seed, secret: true });
          refreshAuthority(room);
          return;
        }

        const expected = nextMainLevel(room.level);
        const completingPoolrooms = room.level === POOLROOMS_LEVEL && requested === LOBBY_LEVEL;
        if ((!expected || requested !== expected) && !completingPoolrooms) return;
        if (conn.player.level !== room.level) return;
        if (requested === POOLROOMS_LEVEL) resetPoolroomsState(room);

        conn.player.exitReady = true;
        room.dirty.add(conn.player.id);
        const participants = Array.from(room.players.values()).filter((p) =>
          !p.dead && p.level === room.level && !p.exitReady
        );
        broadcastToRoom(room, {
          type: "exit_progress",
          id: conn.player.id,
          level: room.level,
          ready: Array.from(room.players.values()).filter((p) => p.level === room.level && p.exitReady).length,
          required: participants.length + 1,
        });
        tryAdvanceRoom(room);
        return;
      }

      // "Abort infiltration": this explorer alone goes back to the room's lobby
      // (still in the room). The rest carry on; the next level transition or
      // group reset pulls them back in (see tryAdvanceRoom/resetRoom). If
      // nobody is left out there, the expedition is over and the room is a
      // lobby again.
      if (type === "return_to_lobby_request") {
        const p = conn.player;
        if (room.level === LOBBY_LEVEL || p.level === LOBBY_LEVEL) return;
        p.level = LOBBY_LEVEL;
        p.dead = false;
        p.exitReady = false;
        room.dirty.add(p.id);
        send(conn.ws, { type: "return_to_lobby", level: LOBBY_LEVEL, seed: room.seed, solo: true });
        room.connections.forEach((c) => { if (c !== conn) send(c.ws, { type: "player_to_lobby", id: p.id }); });
        if (!Array.from(room.players.values()).some((q) => q.level !== LOBBY_LEVEL)) {
          room.level = LOBBY_LEVEL;
          reviveAll(room);
        } else {
          checkAllDead(room);
          tryAdvanceRoom(room);
        }
        refreshAuthority(room);
        return;
      }

      // --- lobby ------------------------------------------------------------------
      // The host starts the expedition: everyone leaves the lobby for Level 0.
      if (type === "start_game") {
        if (room.level !== LOBBY_LEVEL || room.hostId !== conn.player.id) return;
        const requestedLevel = data.level === undefined ? 0 : data.level;
        if (typeof requestedLevel !== "number" || !Number.isInteger(requestedLevel) || requestedLevel < 0 || requestedLevel > MOTION_LEVEL || requestedLevel === LOBBY_LEVEL) return;
        room.level = requestedLevel;
        resetPoolroomsState(room);
        reviveAll(room);
        room.players.forEach((p) => { p.level = requestedLevel; });
        refreshAuthority(room);
        broadcastToRoom(room, {
          type: "level_transition",
          level: requestedLevel,
          seed: room.seed,
          start: true,
          poolroomsState: requestedLevel === POOLROOMS_LEVEL ? poolroomsSnapshot(room) : null,
        });
        return;
      }

      // Room settings are authoritative and can only be changed by the host
      // before the expedition starts.
      if (type === "room_config_update") {
        if (room.level !== LOBBY_LEVEL || room.hostId !== conn.player.id) return;
        const requestedConfig = data.config === undefined ? data : data.config;
        room.config = sanitizeRoomConfig(requestedConfig, room.config);
        broadcastToRoom(room, { type: "room_config", config: room.config });
        return;
      }

      // A code typed at the lobby's cheat terminal: unlocks the effect for the
      // whole room. Anyone in the lobby may unlock; there is no turning one off.
      if (type === "cheat_unlock") {
        if (room.level !== LOBBY_LEVEL || conn.player.level !== LOBBY_LEVEL) return;
        // SUDO unlocks every room cheat at once.
        const cheat = data.cheat === SUDO_CHEAT ? SUDO_CHEAT : data.cheat as RoomCheat;
        const unlocks = cheat === SUDO_CHEAT ? [...ROOM_CHEATS] : ROOM_CHEATS.includes(cheat) ? [cheat] : [];
        const fresh = unlocks.filter((c) => !room.cheats.has(c));
        if (fresh.length === 0) return;
        fresh.forEach((c) => room.cheats.add(c));
        broadcastToRoom(room, { type: "room_cheats", cheats: [...room.cheats], cheat, by: conn.player.name });
        return;
      }

      // The lobby's soccer ball: the level's authority simulates and streams it;
      // everyone else forwards their kicks to the authority.
      if (type === "ball") {
        const level = conn.player.level;
        if (level !== LOBBY_LEVEL || data.level !== level) return;
        if (computeAuthority(room)[String(level)] !== conn.player.id) return;
        const n = (v: unknown, max: number) => Math.max(-max, Math.min(max, finiteNumber(v, 0)));
        broadcastToLevel(room, level, {
          type, level,
          x: n(data.x, 200), z: n(data.z, 200), vx: n(data.vx, 40), vz: n(data.vz, 40),
          g: Math.max(0, Math.min(9999, Math.floor(finiteNumber(data.g, 0)))),
        }, conn);
        return;
      }
      if (type === "ball_kick") {
        const level = conn.player.level;
        const authorityId = computeAuthority(room)[String(level)];
        if (level !== LOBBY_LEVEL || data.level !== level || !authorityId || authorityId === conn.player.id) return;
        const vx = Math.max(-20, Math.min(20, finiteNumber(data.vx, 0)));
        const vz = Math.max(-20, Math.min(20, finiteNumber(data.vz, 0)));
        room.connections.forEach((c) => {
          if (c.player.id === authorityId) send(c.ws, { type: "ball_kick", level, vx, vz });
        });
        return;
      }

      // --- proximity voice chat (WebRTC signaling relay) -------------------------
      // The server never looks inside `data`: it's an opaque SDP offer/answer or
      // ICE candidate, blindly forwarded to one specific teammate in the same
      // room. The actual audio is peer-to-peer once the handshake completes.
      if (type === "voip_signal") {
        const toId = typeof data.to === "string" ? data.to : "";
        if (!toId || !room.players.has(toId)) return;
        for (const c of room.connections) {
          if (c.player.id === toId) {
            send(c.ws, { type: "voip_signal", from: conn.player.id, data: data.data });
            break;
          }
        }
        return;
      }

      // --- death / spectating ---------------------------------------------------
      if (type === "died") {
        if (conn.player.dead) return;
        conn.player.dead = true;
        room.dirty.add(conn.player.id);
        broadcastToRoom(room, { type: "player_died", id: conn.player.id });
        refreshAuthority(room);
        checkAllDead(room);
        return;
      }

      // Compatibility fallback for clients that still send a reset request.
      // The host's locked room policy remains authoritative.
      if (type === "room_reset") {
        const players = expeditionPlayers(room);
        if (players.length === 0) return;
        for (const p of players) if (!p.dead) return;
        resetRoom(room, room.config.deathAction);
        return;
      }

      // --- ping ---------------------------------------------------------------
      // Round-trip latency probe for the HUD: echo the client's own timestamp
      // straight back (no room broadcast, no queuing) so the measurement isn't
      // skewed by the movement-snapshot tick interval.
      if (type === "ping") {
        const t = data.t;
        if (typeof t === "number" && Number.isFinite(t)) {
          send(ws, { type: "pong", t });
        }
        return;
      }

      // --- chat -------------------------------------------------------------
      if (type === "chat") {
        const text = sanitizeText(data.message, MAX_CHAT_LENGTH);
        if (!text) return;

        const now = Date.now();
        conn.chatTimestamps = conn.chatTimestamps.filter((t) => now - t < CHAT_WINDOW_MS);
        if (conn.chatTimestamps.length >= CHAT_BURST) return; // rate limited
        conn.chatTimestamps.push(now);

        broadcastToRoom(room, { type: "chat_message", sender: conn.player.name, text });
        return;
      }
    });

    ws.on("pong", () => {
      if (conn) conn.isAlive = true;
    });

    ws.on("close", () => {
      if (!conn) return;
      console.log(`Player "${conn.player.name}" has disconnected`);
      removeConnection(conn);
    });

    ws.on("error", (error) => {
      console.error("Socket error reported:", error);
    });
  });

  /**
   * Room tick.
   *
   * The previous server relayed every "update" frame the instant it arrived:
   * with N players each sending 25 updates/s, that was N x (N-1) x 25 JSON
   * payloads per second. Batching per room turns it into one snapshot per room
   * per tick, and the client interpolates between snapshots anyway.
   */
  const tick = setInterval(() => {
    rooms.forEach((room) => {
      // Players change level via their movement updates (e.g. the solo
      // secret-level detour), so authority is re-checked every tick.
      refreshAuthority(room);
      if (room.dirty.size === 0) return;

      const players: Omit<PlayerState, "face">[] = [];
      room.dirty.forEach((id) => {
        const player = room.players.get(id);
        if (!player) return;
        const { face: _face, ...moving } = player;
        players.push(moving);
      });
      room.dirty.clear();
      if (players.length === 0) return;

      // Each client filters itself out of the snapshot.
      broadcastToRoom(room, { type: "players_snapshot", players });
    });
  }, TICK_MS);

  /** Drop half-open sockets (mobile networks leave plenty of these behind). */
  const heartbeat = setInterval(() => {
    connections.forEach((conn) => {
      if (!conn.isAlive) {
        conn.ws.terminate();
        removeConnection(conn);
        return;
      }
      conn.isAlive = false;
      conn.ws.ping();
    });
  }, HEARTBEAT_MS);

  // Only upgrade on the dedicated path so a reverse proxy can route cleanly.
  server.on("upgrade", (request, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url || "/", `http://${request.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== WS_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "online",
      uptime: Math.round(process.uptime()),
      activeRooms: rooms.size,
      totalPlayers: connections.size,
    });
  });

  if (!IS_PRODUCTION) {
    console.log("Starting development mode with Vite HMR middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting production mode serving static client from dist/client...");
    // gzip: the three.js bundle dominates the download and compresses to roughly
    // a quarter of its size.
    app.use(compression());

    const distPath = path.join(process.cwd(), "dist", "client");

    // Vite fingerprints filenames under /assets, so they can be cached forever.
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        immutable: true,
        maxAge: "1y",
      })
    );
    app.use(express.static(distPath, { maxAge: "1h", index: false }));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`Backrooms Level 0 Server up and running at http://${HOST}:${PORT}`);
    console.log(`WebSocket relay listening on ${WS_PATH} (tick ${TICK_HZ}Hz)`);
  });

  // Graceful shutdown so systemd/Docker restarts do not drop players abruptly.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    clearInterval(tick);
    clearInterval(heartbeat);
    connections.forEach((conn) => conn.ws.close(1012, "server restarting"));
    wss.close();
    server.close(() => process.exit(0));
    // Do not hang forever on a stuck socket.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("Fatal exception during server boot:", err);
  process.exit(1);
});
