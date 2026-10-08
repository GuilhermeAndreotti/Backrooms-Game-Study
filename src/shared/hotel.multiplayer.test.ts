/** Integration smoke test against `npm run dev` (isolated, temporary room). */
import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { hotelPuzzle, type HotelState } from "./hotel";
import { HOTEL_ALCOVES, HOTEL_BEVERLY_DOOR, HOTEL_EXIT, HOTEL_RECEPTION, HOTEL_TABLE, HOTEL_VALVES, hotelCenter, hotelFloorAt } from "../game/levels/hotelLayout";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
class Client {
  ws = new WebSocket(process.env.HOTEL_TEST_WS ?? "ws://localhost:3000/ws");
  messages: any[] = [];
  constructor() { this.ws.on("message", b => this.messages.push(JSON.parse(b.toString()))); }
  send(msg: unknown) { this.ws.send(JSON.stringify(msg)); }
  async wait(type: string, predicate: (m: any) => boolean = () => true) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const index = this.messages.findIndex(m => m.type === type && predicate(m));
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await delay(15);
    }
    throw new Error(`Timed out waiting for ${type}`);
  }
  move(pos: { x: number; z: number }, level = 13) {
    this.send({ type: "update", ...pos, y: hotelFloorAt(pos.x, pos.z) + 1.6, level, state: "idle", yaw: 0, pitch: 0 });
  }
}

test("four explorers share puzzles, late join, authority handoff, reset and the complete route", { timeout: 45000 }, async () => {
  const clients: Client[] = [];
  const join = async (room?: string) => {
    const c = new Client(); clients.push(c);
    await new Promise<void>((resolve, reject) => { c.ws.once("open", resolve); c.ws.once("error", reject); });
    c.send({ type: "join", create: !room, room, requestedSeed: 42, name: `Hotel test ${clients.length}` });
    return { c, joined: await c.wait("joined") };
  };
  try {
    const first = await join(), code = first.joined.code;
    const second = await join(code);
    const a = first.c, b = second.c;
    a.send({ type: "start_game", level: 13 });
    await a.wait("level_transition", m => m.level === 13); await b.wait("level_transition", m => m.level === 13);
    a.send({ type: "hotel_sync" });
    let state: HotelState = (await a.wait("hotel_state")).state;
    const action = async (c: Client, act: unknown, pos: { x: number; z: number }) => {
      await delay(215); c.move(pos); c.send({ type: "hotel_action", epoch: state.epoch, action: act });
      assert.ok((await c.wait("hotel_result")).ok, JSON.stringify(act));
      state = (await c.wait("hotel_state", m => m.state.revision > state.revision)).state;
    };
    const puzzle = hotelPuzzle(42);
    await action(a, { kind: "code", code: puzzle.code }, HOTEL_RECEPTION);
    await action(b, { kind: "key" }, HOTEL_RECEPTION);
    const third = await join(code), c = third.c;
    c.send({ type: "hotel_sync" });
    assert.equal((await c.wait("hotel_state")).state.key, true);
    await action(c, { kind: "beverly" }, hotelCenter(HOTEL_BEVERLY_DOOR.gx, HOTEL_BEVERLY_DOOR.gz));
    const fourth = await join(code), d = fourth.c;
    d.send({ type: "hotel_sync" }); assert.equal((await d.wait("hotel_state")).state.beverlyOpen, true);

    const door = HOTEL_ALCOVES[puzzle.alcoves[0]];
    await action(d, { kind: "door", index: puzzle.alcoves[0] }, hotelCenter(door.gx, door.gz));
    a.move(door.tile); b.move(door.tile);
    for (const client of [a, b]) client.send({ type: "hotel_action", epoch: state.epoch, action: { kind: "tile", index: 0 } });
    const results = await Promise.all([a.wait("hotel_result"), b.wait("hotel_result")]);
    assert.equal(results.filter(r => r.ok).length, 1, "only one simultaneous collector wins");
    state = (await a.wait("hotel_state", m => m.state.collected === 1)).state;
    const now = Date.now();
    a.send({ type: "hotel_world", epoch: state.epoch, world: { at: now, nextAt: now + 60000, until: now + 30000, lastSeen: now, mode: 1, target: second.joined.id, dwell: {}, decor: 1, event: 4 } });
    await b.wait("hotel_world", m => m.world.event === 4);
    a.ws.close();
    await b.wait("authority", m => m.byLevel[13] === second.joined.id);
    b.send({ type: "hotel_sync" });
    assert.equal((await b.wait("hotel_state", m => m.world?.event === 4)).state.collected, 1);

    for (let i = 1; i < 4; i++) {
      const who = [b, c, d][i % 3], slot = puzzle.alcoves[i], alcove = HOTEL_ALCOVES[slot];
      await action(who, { kind: "door", index: slot }, hotelCenter(alcove.gx, alcove.gz));
      await action(who, { kind: "tile", index: i }, alcove.tile);
    }
    await action(c, { kind: "place" }, HOTEL_TABLE);
    const reconnect = await join(code), e = reconnect.c;
    e.send({ type: "hotel_sync" });
    const late = await e.wait("hotel_state");
    assert.equal(late.state.stairAt, state.stairAt); assert.equal(late.state.placed, 4);
    await delay(Math.max(0, state.stairAt - Date.now()) + 50);
    await action(b, { kind: "valve", index: 0, setting: 2 }, HOTEL_VALVES[0]);
    assert.ok(state.steamUntil > Date.now());
    for (const index of [0, 1, 2] as const) await action([b, c, d][index], { kind: "valve", index, setting: index }, HOTEL_VALVES[index]);
    assert.ok(state.exitOpen);
    for (const client of [b, c, d, e]) { client.move(hotelCenter(HOTEL_EXIT.gx, HOTEL_EXIT.gz)); client.send({ type: "level_transition_request", level: 6 }); }
    for (const client of [b, c, d, e]) await client.wait("level_transition", m => m.level === 6);
    // Delayed Hotel updates cannot pull a player back after the server transition.
    b.move(HOTEL_RECEPTION, 13);
    for (const client of [b, c, d, e]) client.send({ type: "level_transition_request", level: 5 });
    for (const client of [b, c, d, e]) await client.wait("level_transition", m => m.level === 5);
    // This is a transition regression test, not a Poolrooms puzzle test.
    for (const client of [b, c, d, e]) client.send({ type: "level_transition_request", level: 12 });
    for (const client of [b, c, d, e]) await client.wait("level_transition", m => m.level === 12);
    for (const client of [b, c, d, e]) client.send({ type: "return_to_lobby_request" });
    await delay(200);
    b.send({ type: "start_game", level: 13 }); await b.wait("level_transition", m => m.level === 13);
    b.send({ type: "hotel_sync" });
    const fresh = await b.wait("hotel_state", m => m.state.epoch > state.epoch);
    assert.equal(fresh.state.collected, 0); assert.equal(fresh.state.exitOpen, false);
    for (const client of [b, c, d, e]) client.send({ type: "died", cause: "caught" });
    await b.wait("respawn", m => m.level === 13);
    b.send({ type: "hotel_sync" }); assert.ok((await b.wait("hotel_state", m => m.state.epoch > fresh.state.epoch)).state.revision === 0);
  } finally { clients.forEach(c => c.ws.close()); }
});
