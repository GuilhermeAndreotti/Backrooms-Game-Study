import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHotelAction, createHotelState, hotelBlocked, hotelPuzzle, parseHotelAction, HOTEL_PSI_BANDS, type HotelAction, type HotelState, type Pressure } from "./hotel";
import { HOTEL_ALCOVES, HOTEL_BEVERLY_DOOR, HOTEL_EXIT, HOTEL_RECEPTION, HOTEL_SPAWN, HOTEL_TABLE, HOTEL_VALVES, hotelCenter, hotelFloorAt, hotelZone } from "../game/levels/hotelLayout";
import { ABANDONED_OFFICE_LEVEL, HOTEL_LEVEL, LIGHTS_OUT_LEVEL, POOLROOMS_LEVEL, SPACE_LEVEL, nextMainLevel } from "../game/levels/constants";

const time = 100000;
const player = (pos: { x: number; z: number }) => ({ ...pos, y: hotelFloorAt(pos.x, pos.z) + 1.6 });
function reachable(s: HotelState, at = time) {
  const queue = [[HOTEL_SPAWN.gx, HOTEL_SPAWN.gz]], seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i], key = `${x},${z}`;
    if (seen.has(key) || !hotelZone(x, z) || hotelBlocked(s, x, z, at)) continue;
    seen.add(key); queue.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
  }
  return seen;
}
function solve(seed: number) {
  let state = createHotelState(3, time - 5000);
  const act = (a: HotelAction, pos: { x: number; z: number }, now = time) => {
    const next = applyHotelAction(state, a, seed, player(pos), now);
    assert.ok(next, JSON.stringify(a)); state = next; return state;
  };
  const puzzle = hotelPuzzle(seed);
  act({ kind: "code", code: puzzle.code }, HOTEL_RECEPTION);
  act({ kind: "key" }, HOTEL_RECEPTION);
  act({ kind: "beverly" }, hotelCenter(HOTEL_BEVERLY_DOOR.gx, HOTEL_BEVERLY_DOOR.gz));
  for (let index = 0; index < 4; index++) {
    const slot = puzzle.alcoves[index], d = HOTEL_ALCOVES[slot];
    act({ kind: "door", index: slot }, hotelCenter(d.gx, d.gz));
    assert.ok(reachable(state).has(`${Math.floor(d.tile.x / 4)},${Math.floor(d.tile.z / 4)}`));
    act({ kind: "tile", index }, d.tile);
  }
  act({ kind: "place" }, HOTEL_TABLE);
  return { get state() { return state; }, act };
}
test("seeds produce unique discoverable codes and a connected gated route", () => {
  const codes = new Set<string>();
  for (let seed = 1; seed <= 150; seed++) {
    const p = hotelPuzzle(seed); codes.add(p.code);
    assert.deepEqual(p, hotelPuzzle(seed));
    assert.equal(new Set(p.cards.map(c => c.suit)).size, 4);
    assert.match(p.code, /^[1-9]{4}$/);
    p.valves.forEach((v, i) => { const [lo, hi] = HOTEL_PSI_BANDS[v]; assert.ok(p.psi[i] >= lo && p.psi[i] <= hi && p.psi[i] % 5 === 0); });
    const accessible = reachable(createHotelState(1, time));
    p.cards.forEach(c => assert.ok(accessible.has(`${c.gx},${c.gz}`)));
    assert.ok(!accessible.has("37,10"));
    const solved = solve(seed);
    assert.ok(!reachable(solved.state, time + 4999).has("39,18"));
    assert.ok(reachable(solved.state, time + 5000).has("39,18"));
  }
  assert.ok(codes.size > 50);
});
test("distance, height, prerequisites, duplicates and out-of-order pickups are rejected", () => {
  const state = createHotelState(1, time), puzzle = hotelPuzzle(42);
  assert.equal(applyHotelAction(state, { kind: "key" }, 42, player(HOTEL_RECEPTION), time), null);
  assert.equal(applyHotelAction(state, { kind: "code", code: puzzle.code }, 42, { x: 0, y: 0, z: 0 }, time), null);
  assert.equal(applyHotelAction(state, { kind: "code", code: puzzle.code }, 42, { ...HOTEL_RECEPTION, y: -6 }, time), null);
  assert.equal(applyHotelAction(state, { kind: "tile", index: 0 }, 42, player(HOTEL_ALCOVES[puzzle.alcoves[0]].tile), time), null);
  const open = applyHotelAction(state, { kind: "code", code: puzzle.code }, 42, player(HOTEL_RECEPTION), time)!;
  assert.equal(applyHotelAction(open, { kind: "code", code: puzzle.code }, 42, player(HOTEL_RECEPTION), time), null);
  assert.equal(state.boxOpen, false);
  const solved = solve(42);
  assert.equal(solved.state.collected, 4); assert.equal(solved.state.placed, 4);
  assert.equal(applyHotelAction(solved.state, { kind: "place" }, 42, player(HOTEL_TABLE), time), null);
});
test("pressure errors block optional passages but preserve recovery; correct settings open exit", () => {
  const run = solve(42), at = time + 5100, valves = hotelPuzzle(42).valves;
  run.act({ kind: "valve", index: 0, setting: ((valves[0] + 1) % 3) as Pressure }, HOTEL_VALVES[0], at);
  assert.ok(!hotelBlocked(run.state, 29, 36, at + 100));
  assert.ok(hotelBlocked(run.state, 29, 36, at + 2000));
  const accessible = reachable(run.state, at + 2000);
  HOTEL_VALVES.forEach(v => assert.ok(accessible.has(`${Math.floor(v.x / 4)},${Math.floor(v.z / 4)}`)));
  assert.ok(!accessible.has(`${HOTEL_EXIT.gx},${HOTEL_EXIT.gz}`));
  for (const index of [2, 0, 1] as const) run.act({ kind: "valve", index, setting: valves[index] }, HOTEL_VALVES[index], at + 3000);
  assert.ok(run.state.exitOpen); assert.equal(run.state.steamUntil, 0);
  assert.ok(reachable(run.state, at + 3000).has(`${HOTEL_EXIT.gx},${HOTEL_EXIT.gz}`));
  assert.equal(createHotelState(run.state.epoch + 1, at).collected, 0);
});
test("malformed messages and numeric-id regressions are handled explicitly", () => {
  for (const value of [null, {}, { kind: "code", code: 1234 }, { kind: "code", code: "12345" }, { kind: "tile", index: -1 }, { kind: "door", index: 0.5 }, { kind: "valve", index: 4, setting: 2 }, { kind: "valve", index: 0, setting: "LOW" }]) assert.equal(parseHotelAction(value), null);
  assert.equal(nextMainLevel(ABANDONED_OFFICE_LEVEL), HOTEL_LEVEL);
  assert.equal(nextMainLevel(HOTEL_LEVEL), LIGHTS_OUT_LEVEL);
  assert.equal(nextMainLevel(LIGHTS_OUT_LEVEL), POOLROOMS_LEVEL);
  assert.equal(nextMainLevel(POOLROOMS_LEVEL), SPACE_LEVEL);
});
