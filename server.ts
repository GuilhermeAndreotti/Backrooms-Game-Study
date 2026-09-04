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
const MAX_MESSAGE_BYTES = 8 * 1024;
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
}

interface Connection {
  ws: WebSocket;
  player: PlayerState;
  isAlive: boolean;
  chatTimestamps: number[];
}

interface Room {
  seed: number;
  players: Map<string, PlayerState>;
  /** Sockets in this room, so a broadcast never scans unrelated connections. */
  connections: Set<Connection>;
  /** Players whose state changed since the last tick. */
  dirty: Set<string>;
}

const rooms = new Map<string, Room>();
const connections = new Map<WebSocket, Connection>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips control characters: they render as garbage and can break terminals. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, maxLength);
}

function sanitizeRoomKey(value: unknown): string {
  const raw = sanitizeText(value, 40).toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "sala-principal";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function removeConnection(conn: Connection) {
  connections.delete(conn.ws);

  const room = rooms.get(conn.player.room);
  if (!room) return;

  room.connections.delete(conn);
  room.players.delete(conn.player.id);
  room.dirty.delete(conn.player.id);

  broadcastToRoom(room, { type: "player_left", id: conn.player.id });

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

        const roomKey = sanitizeRoomKey(data.room);
        let room = rooms.get(roomKey);

        if (!room) {
          if (rooms.size >= MAX_ROOMS) {
            send(ws, { type: "room_full", error: "O servidor atingiu o limite de salas ativas." });
            ws.close();
            return;
          }
          const requestedSeed = data.requestedSeed;
          const seed =
            typeof requestedSeed === "number" && requestedSeed > 0 && Number.isFinite(requestedSeed)
              ? Math.floor(requestedSeed)
              : Math.floor(Math.random() * 999999) + 1;
          room = { seed, players: new Map(), connections: new Set(), dirty: new Set() };
          rooms.set(roomKey, room);
          console.log(`Created new room "${roomKey}" with seed ${seed}`);
        }

        if (room.players.size >= ROOM_CAPACITY) {
          send(ws, {
            type: "room_full",
            error: `Esta sala atingiu o limite de ${ROOM_CAPACITY} jogadores.`,
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
          level: 0,
        };

        conn = { ws, player, isAlive: true, chatTimestamps: [] };
        connections.set(ws, conn);
        room.connections.add(conn);
        room.players.set(playerId, player);

        // 1. Confirm join to self: client id, shared map seed, current roster.
        send(ws, {
          type: "joined",
          id: playerId,
          seed: room.seed,
          players: Array.from(room.players.values()).filter((p) => p.id !== playerId),
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
        p.x = finiteNumber(data.x, p.x);
        p.y = finiteNumber(data.y, p.y);
        p.z = finiteNumber(data.z, p.z);
        p.yaw = finiteNumber(data.yaw, p.yaw);
        p.pitch = finiteNumber(data.pitch, p.pitch);
        p.flashlight = typeof data.flashlight === "boolean" ? data.flashlight : p.flashlight;
        p.state = typeof data.state === "string" ? data.state.slice(0, 16) : p.state;
        p.level = finiteNumber(data.level, p.level);

        // Queued instead of relayed immediately: see the room tick below.
        room.dirty.add(p.id);
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
      if (room.dirty.size === 0) return;

      const players: PlayerState[] = [];
      room.dirty.forEach((id) => {
        const player = room.players.get(id);
        if (player) players.push(player);
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
