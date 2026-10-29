/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Poolrooms' three parts, as data. Part 1 (the four flooded halls and
 * their valves) is still carved by ProceduralMap.carveLevel7; this file lays
 * out what lies past its drained gate:
 *
 *  - Part 2, "A Caçada" (x 38..93, z 2..39): one huge ankle-deep natatorium
 *    split into three halls by partition walls with wide openings, and the
 *    machine wing east of them. Bleachers, lifeguard towers, a diving
 *    platform, water tanks, catwalks and block stacks rise out of the water.
 *    The rule the whole part teaches: the Vigia never leaves the floor, and
 *    cannot reach anyone standing VIGIA_REACH_UP above it. Three levers,
 *    spread over the part, open the door down to Part 3.
 *  - Part 3, "As Profundezas" (x 42..76, z 40..76): a drowned labyrinth with
 *    corridors two cells wide under a low roof, broken by air holes where you
 *    can come up to breathe. Over its roof lies a dark tiled hall the holes
 *    open into like wells: that is where the Vigia walks. The two ways out
 *    (Level 79's station door and Level 94's road) wait side by side on a
 *    landing past the labyrinth's last hole.
 *
 * Everything here is a pure function of constants (no seed), so every client
 * and the server agree on it without sending geometry. Heights are world Y in
 * metres: the dry floor is 0, Part 1's pool floor is POOL_FLOOR_Y (-0.55).
 */

import { POOL_FLOOR_Y } from "../Water";
import type { MessageKey } from "../../i18n";

export const POOL_GRID = 96;
export const POOL_CELL = 4;

export type PoolPart = 1 | 2 | 3;

interface Rect { x1: number; z1: number; x2: number; z2: number }

/** Part 1's original halls. */
export const POOL_PART1: Rect = { x1: 2, z1: 2, x2: 37, z2: 37 };
const PART2: Rect = { x1: 38, z1: 2, x2: 93, z2: 39 };
const PART3: Rect = { x1: 42, z1: 40, x2: 76, z2: 76 };

const inside = (r: Rect, x: number, z: number) => x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;

/** Which part a cell belongs to (0 outside every part). */
export function poolPartAt(gx: number, gz: number): PoolPart | 0 {
  if (inside(POOL_PART1, gx, gz)) return 1;
  if (inside(PART2, gx, gz)) return 2;
  if (inside(PART3, gx, gz)) return 3;
  return 0;
}

// --- Heights ----------------------------------------------------------------

/** Part 2's ankle-deep hall floor and its water surface. */
export const P2_FLOOR = POOL_FLOOR_Y;
export const P2_WATER = -0.25;
/** Part 3's water surface (everywhere it is open to the air). */
export const P3_WATER = -0.15;
const DECK = 0;
const DEEP = -4.4;
/** Underside of the roof over Part 3's drowned corridors. */
const ROOF = -1.1;
/** Part 3's hall over the labyrinth's roof: the air holes are wells this far above the water. */
export const P3_HALL = 0.6;

/** Block tops, each one jump (≈0.9 m) above the last. */
const STEP = 0.3, MID = 1.2, HIGH = 2.1, TOWER = 3.0, CHAIR = 2.6;

// --- The Vigia's physical rules ---------------------------------------------

/** It only walks cells whose floor is at most this high (never blocks, stairs or ladders)... */
export const VIGIA_MAX_FLOOR = 0.1;
/** ...and only water it can wade (deeper than this and it stays on the edge). */
export const VIGIA_MAX_WADE = 0.75;
/** Feet this far above the floor it stands on are out of its reach: its arms are long, not endless. */
export const VIGIA_REACH_UP = 2.0;
/**
 * Feet this far below it are out of reach too: from Part 3's hall it can
 * still pull a swimmer out of a well, but not anyone who has dived.
 */
export const VIGIA_REACH_DOWN = 2.3;

/** Water deeper than this can't be waded: you swim. */
export const SWIM_DEPTH = 1.45;

// --- Cells ------------------------------------------------------------------

export type PoolCellKind =
  | "floor" // Part 2's flooded hall floor
  | "block" // a raised, dry block / platform / catwalk
  | "deck" // a dry pool deck at floor level
  | "wade" // shallow water
  | "deep" // water you swim in
  | "stair" // a staircase between two heights
  | "gate" // Part 1's drained gate
  | "corridor" // a dry connecting passage
  | "landing" // the exit landing
  | "nook" // an exit door's nook
  | "hall"; // the dark hall over Part 3's labyrinth: the Vigia's floor, out of an explorer's reach

export interface PoolStair { dx: number; dz: number; from: number; to: number }

export interface PoolCell {
  part: 2 | 3;
  kind: PoolCellKind;
  /** Top of the floor here (m). */
  floor: number;
  /** Water surface, or null where it's dry. */
  water: number | null;
  /** Underside of a roof dipping into the water; Infinity where it's open above. */
  ceil: number;
  stair?: PoolStair;
  /** Over a drowned corridor: the hall floor on top of its roof, where the Vigia walks. */
  deck?: number;
}

export interface PoolLadder {
  /** The cell you climb from... */
  x: number; z: number;
  /** ...toward this neighbour (unit step), whose floor is `top`. */
  dx: number; dz: number;
  top: number;
}

const cells = new Map<string, PoolCell>();
export const POOL_LADDERS: PoolLadder[] = [];

const key = (x: number, z: number) => `${x},${z}`;

function paint(x1: number, z1: number, x2: number, z2: number, part: 2 | 3, kind: PoolCellKind, floor: number, water: number | null, ceil = Infinity) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) cells.set(key(x, z), { part, kind, floor, water, ceil });
  }
}
function wall(x1: number, z1: number, x2: number, z2: number) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) cells.delete(key(x, z));
  }
}
function block(x: number, z: number, top: number, part: 2 | 3 = 2) { paint(x, z, x, z, part, "block", top, null); }
function stair(x: number, z: number, dx: number, dz: number, from: number, to: number, part: 2 | 3) {
  cells.set(key(x, z), { part, kind: "stair", floor: Math.max(from, to), water: null, ceil: Infinity, stair: { dx, dz, from, to } });
}
function ladder(x: number, z: number, dx: number, dz: number) {
  const top = cells.get(key(x + dx, z + dz));
  if (!top) throw new Error(`Poolrooms ladder at ${x},${z} leads into a wall`);
  POOL_LADDERS.push({ x, z, dx, dz, top: top.floor });
}

// Part 2 — "A Caçada" ---------------------------------------------------------

/** The three levers ([gx, gz]); all of them open the door down to Part 3. */
export const POOL_LEVERS: [number, number][] = [[92, 17], [88, 34], [78, 36]];
export const POOL_LEVER_SLOTS = POOL_LEVERS.length;
/** The heavy door at the top of the way down to Part 3 (in the high corridor). */
export const POOL_DEEP_DOOR = { x: 60, z: 38 };

{
  const P = 2;
  paint(40, 2, 71, 37, P, "floor", P2_FLOOR, P2_WATER);
  // Partitions with wide openings: they break the sight lines, not the hall.
  wall(40, 13, 71, 13); paint(47, 13, 49, 13, P, "floor", P2_FLOOR, P2_WATER); paint(62, 13, 64, 13, P, "floor", P2_FLOOR, P2_WATER);
  wall(40, 25, 71, 25);
  paint(42, 25, 44, 25, P, "floor", P2_FLOOR, P2_WATER); paint(55, 25, 57, 25, P, "floor", P2_FLOOR, P2_WATER); paint(68, 25, 70, 25, P, "floor", P2_FLOOR, P2_WATER);

  // The drained gate out of Part 1's third hall, and the step down into the water.
  paint(38, 10, 38, 10, P, "gate", DECK, null);
  paint(39, 10, 39, 10, P, "corridor", DECK, null);
  paint(40, 9, 41, 11, P, "block", STEP, null);

  // Hall A: the bleachers. Each row one jump above the last; the top two are out of its reach.
  paint(44, 5, 59, 5, P, "block", STEP, null);
  paint(44, 4, 59, 4, P, "block", MID, null);
  paint(44, 3, 59, 3, P, "block", HIGH, null);
  paint(44, 2, 59, 2, P, "block", TOWER, null);
  // Lifeguard chairs, climbed by their ladders.
  block(52, 9, CHAIR); ladder(52, 10, 0, -1);
  block(66, 6, CHAIR); ladder(65, 6, 1, 0);
  block(50, 15, CHAIR); ladder(49, 15, 1, 0);
  // A stack of blocks in the east corner, and loose low ones (no shelter).
  block(68, 10, STEP); block(69, 10, MID); block(70, 10, HIGH); block(70, 9, HIGH);
  block(46, 8, STEP); block(58, 8, STEP); block(60, 11, STEP); block(61, 11, MID);

  // Hall B: the competition pool. A diving platform in the middle...
  paint(54, 18, 56, 20, P, "block", HIGH, null);
  ladder(53, 19, 1, 0); ladder(57, 19, -1, 0);
  // ...starting blocks along the west lanes, ending in a high block wall.
  block(42, 15, STEP); block(42, 17, STEP); block(42, 19, STEP); block(42, 20, STEP);
  block(41, 20, MID); paint(40, 21, 41, 23, P, "block", HIGH, null);
  // A high gallery along the east wall, reached by one ladder.
  paint(64, 16, 71, 16, P, "block", HIGH, null); ladder(63, 16, 1, 0);
  block(66, 22, STEP); block(67, 22, MID);

  // Hall C: the slides and the catwalks to the way out (high in the south wall).
  // West route: a ladder onto a catwalk that collapsed halfway — drop, cross, climb again.
  paint(41, 35, 48, 35, P, "block", HIGH, null); ladder(41, 34, 0, 1);
  block(50, 36, STEP); block(51, 36, MID); block(52, 36, HIGH);
  paint(52, 35, 65, 35, P, "block", HIGH, null);
  // East route: the slide tower, up its stairs, then down a catwalk onto the same walkway.
  stair(62, 29, 1, 0, P2_FLOOR, MID, P); stair(63, 29, 1, 0, MID, TOWER, P);
  paint(64, 28, 66, 30, P, "block", TOWER, null);
  paint(65, 31, 65, 34, P, "block", HIGH, null);
  // A pump house in the middle: shelter on the way.
  paint(47, 29, 48, 30, P, "block", HIGH, null); ladder(46, 29, 1, 0);
  // The high doorway into Part 3: only reachable from the walkway, shut until the levers are pulled.
  paint(60, 36, 60, 39, P, "corridor", HIGH, null);

  // The machine wing, east of the three halls (through openings in their shared wall).
  paint(74, 2, 93, 37, P, "floor", P2_FLOOR, P2_WATER);
  for (const z of [6, 7, 19, 20, 31, 32]) paint(72, z, 73, z, P, "floor", P2_FLOOR, P2_WATER);
  wall(74, 20, 93, 20); paint(78, 20, 80, 20, P, "floor", P2_FLOOR, P2_WATER); paint(88, 20, 90, 20, P, "floor", P2_FLOOR, P2_WATER);
  // North: a tall water tank, a pump stack up to the catwalk along the north wall.
  paint(77, 5, 80, 8, P, "block", TOWER, null); ladder(76, 6, 1, 0);
  block(84, 5, STEP); block(85, 5, MID); block(86, 5, HIGH); block(86, 4, HIGH);
  paint(82, 3, 93, 3, P, "block", HIGH, null);
  block(90, 12, STEP); block(91, 12, MID); block(92, 12, HIGH);
  block(80, 15, STEP); block(81, 15, MID);
  // South: a pipe bridge with a missing span, a second tank, a refuge stack in the corner.
  paint(76, 28, 91, 28, P, "block", HIGH, null); wall(83, 28, 84, 28); paint(83, 28, 84, 28, P, "floor", P2_FLOOR, P2_WATER);
  ladder(76, 29, 0, -1);
  block(84, 29, STEP); block(85, 29, MID);
  paint(86, 32, 89, 35, P, "block", TOWER, null); ladder(85, 33, 1, 0);
  block(77, 33, STEP); block(76, 33, MID); block(75, 33, HIGH);
  block(80, 23, STEP); block(81, 23, MID); block(82, 23, HIGH);
}

// Part 3 — "As Profundezas" --------------------------------------------------

/** The labyrinth: UNIT×UNIT rooms of 2×2 cells (corridors two cells wide), walls one cell thick. */
const MAZE = { x0: 44, z0: 45, nx: 10, nz: 10 };
const UNIT = 3;
/** Rooms open to the hall above (air holes), by unit — filled in below. */
export const POOL_AIR_HOLES: [number, number][] = [];
const P3_LAMPS: [number, number, PoolLampKind][] = [];
const P3_PATROL: [number, number][] = [];

{
  const P = 3;
  // The way down from Part 2's high doorway, into a dry room over the water.
  stair(60, 40, 0, 1, HIGH, 1.05, P); stair(60, 41, 0, 1, 1.05, DECK, P);
  paint(56, 42, 64, 43, P, "deck", DECK, null);
  paint(59, 44, 60, 44, P, "deep", DEEP, P3_WATER); // the way in: jump in

  // A fixed, seedless maze (every client and the server agree on it): a
  // depth-first carve, then a few extra openings so it loops instead of
  // forcing one long thread.
  let state = 0x5eed;
  const rand = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296);
  const { nx, nz } = MAZE;
  const id = (ux: number, uz: number) => ux * nz + uz;
  const open = new Set<string>(); // "a|b" unit links
  const link = (a: number, b: number) => open.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  const linked = (a: number, b: number) => open.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set<number>([id(5, 0)]);
  const stack: [number, number][] = [[5, 0]];
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [ux, uz] = stack[stack.length - 1];
    const next = N4.map(([dx, dz]) => [ux + dx, uz + dz]).filter(([x, z]) => x >= 0 && z >= 0 && x < nx && z < nz && !seen.has(id(x, z)));
    if (next.length === 0) { stack.pop(); continue; }
    const [x, z] = next[Math.floor(rand() * next.length)];
    link(id(ux, uz), id(x, z));
    seen.add(id(x, z));
    stack.push([x, z]);
  }
  for (let ux = 0; ux < nx; ux++) for (let uz = 0; uz < nz; uz++) {
    if (ux + 1 < nx && rand() < 0.14) link(id(ux, uz), id(ux + 1, uz));
    if (uz + 1 < nz && rand() < 0.14) link(id(ux, uz), id(ux, uz + 1));
  }

  // Air: the entrance and the exit rooms, then the room farthest (through the
  // corridors) from any air, again and again, until no stretch under the roof
  // is longer than two rooms.
  const air = new Set<number>([id(5, 0), id(nx - 1, nz - 1)]);
  const farthest = () => {
    const dist = new Map<number, number>();
    const q = [...air];
    for (const a of q) dist.set(a, 0);
    for (let h = 0; h < q.length; h++) {
      const u = q[h], ux = Math.floor(u / nz), uz = u % nz;
      for (const [dx, dz] of N4) {
        const x = ux + dx, z = uz + dz;
        if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
        const v = id(x, z);
        if (dist.has(v) || !linked(u, v)) continue;
        dist.set(v, dist.get(u)! + 1);
        q.push(v);
      }
    }
    let best = -1, bestD = -1;
    for (const [u, d] of dist) if (d > bestD) { bestD = d; best = u; }
    return { best, bestD };
  };
  for (let f = farthest(); f.bestD > 2; f = farthest()) air.add(f.best);

  // Lay it out: rooms and their links are drowned corridors (or holes, where
  // there's air); everything between them is the hall's floor.
  const cx = (ux: number) => MAZE.x0 + ux * UNIT, cz = (uz: number) => MAZE.z0 + uz * UNIT;
  paint(MAZE.x0, MAZE.z0, cx(nx - 1) + 2, cz(nz - 1) + 2, P, "hall", P3_HALL, null);
  const corridor = (x1: number, z1: number, x2: number, z2: number, isAir: boolean) => {
    paint(x1, z1, x2, z2, P, "deep", DEEP, P3_WATER, isAir ? Infinity : ROOF);
    if (!isAir) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) cells.get(key(x, z))!.deck = P3_HALL;
  };
  for (let ux = 0; ux < nx; ux++) for (let uz = 0; uz < nz; uz++) {
    const u = id(ux, uz);
    const isAir = air.has(u);
    corridor(cx(ux), cz(uz), cx(ux) + 1, cz(uz) + 1, isAir);
    if (isAir) {
      POOL_AIR_HOLES.push([ux, uz]);
      P3_LAMPS.push([cx(ux), cz(uz), "pocket"]);
    } else if ((ux * 7 + uz * 3) % 4 === 0) {
      P3_LAMPS.push([cx(ux) + 1, cz(uz), "under"]);
    }
    if (ux + 1 < nx && linked(u, id(ux + 1, uz))) corridor(cx(ux) + 2, cz(uz), cx(ux) + 2, cz(uz) + 1, false);
    if (uz + 1 < nz && linked(u, id(ux, uz + 1))) corridor(cx(ux), cz(uz) + 2, cx(ux) + 1, cz(uz) + 2, false);
    // Its rounds: the hall's crossings, every other one.
    if ((ux + uz) % 2 === 0 && ux < nx - 1 && uz < nz - 1) P3_PATROL.push([cx(ux) + 2, cz(uz) + 2]);
    if ((ux + uz) % 3 === 0) P3_LAMPS.push([cx(ux) + 2, cz(uz) + 2, "hall"]);
  }

  // Out: from the last room east into a pocket under the landing; its ladder
  // climbs out of the Vigia's reach, to the two doors.
  const ex = cx(nx - 1) + 2, ez = cz(nz - 1) + 1; // (73, 73)
  paint(ex, ez, ex, ez, P, "deep", DEEP, P3_WATER);
  paint(ex + 1, ez - 1, ex + 3, ez + 1, P, "landing", TOWER, null);
  ladder(ex, ez, 1, 0);
  // The two doors open off the landing's north side.
  paint(ex + 1, ez - 2, ex + 1, ez - 2, P, "nook", TOWER, null);
  paint(ex + 3, ez - 2, ex + 3, ez - 2, P, "nook", TOWER, null);
  // Wall the landing off from the hall beside it: no dropping down into its floor.
  wall(ex, ez - 2, ex, ez - 1); wall(ex, ez + 1, ex, ez + 1);
}

/** The authored cell at (gx, gz) in Part 2/3, or undefined (a wall, or Part 1). */
export function poolCellAt(gx: number, gz: number): PoolCell | undefined {
  return cells.get(key(gx, gz));
}

/** Every authored cell, for the map's carve. */
export function forEachPoolCell(fn: (gx: number, gz: number, cell: PoolCell) => void) {
  for (const [k, cell] of cells) {
    const [x, z] = k.split(",").map(Number);
    fn(x, z, cell);
  }
}

/** The ladder you'd climb from (gx, gz) toward (dx, dz), if any. */
export function poolLadderFrom(gx: number, gz: number): PoolLadder[] {
  return POOL_LADDERS.filter((l) => l.x === gx && l.z === gz);
}

/** Floor height of a stair cell at a world position. */
export function poolStairHeight(cell: PoolCell, gx: number, gz: number, wx: number, wz: number): number {
  const s = cell.stair!;
  // 0 at the edge the stair starts from, 1 at the edge it leads to.
  const t = ((wx - (gx + 0.5) * POOL_CELL) * s.dx + (wz - (gz + 0.5) * POOL_CELL) * s.dz) / POOL_CELL + 0.5;
  const steps = 5;
  const k = Math.max(0, Math.min(steps, Math.floor(Math.max(0, Math.min(0.999, t)) * steps + 1)));
  return s.from + (s.to - s.from) * (k / steps);
}

// --- Exits, gates and set pieces --------------------------------------------

/** Part 1's drained gate into Part 2. */
export const POOL_GATE = { x: 38, z: 10 };
/** Level 79's station door and Level 94's road, side by side off the landing. */
export const POOL_STATION_EXIT = { x: 74, z: 71 };
export const POOL_TOWN_EXIT = { x: 76, z: 71 };
/** The landing's cells: where the shutter wheel can be reached from. */
export const POOL_LANDING: Rect = { x1: 74, z1: 72, x2: 76, z2: 74 };
export const onPoolLanding = (gx: number, gz: number) => inside(POOL_LANDING, gx, gz);
/** The shutter wheel's cell (on its west wall). */
export const POOL_SHUTTER_WHEEL = { x: 74, z: 74 };

/** The labyrinth's last rooms: crossing them under water sets the Vigia waiting. */
export const POOL_FINALE: Rect = { x1: 65, z1: 66, x2: 73, z2: 74 };
export const inPoolFinale = (gx: number, gz: number) => inside(POOL_FINALE, gx, gz);
/** Where it waits for whoever comes through the last rooms: at the rim of the exit hole, looking down into it. */
export const POOL_AMBUSH = { x: 70, z: 73, watchX: 71, watchZ: 73 };

/** Where each part's Vigia walks its rounds (cells it can stand on). */
export const POOL_PATROL: Record<PoolPart, [number, number][]> = {
  1: [],
  2: [[48, 7], [62, 8], [56, 11], [45, 18], [60, 22], [68, 19], [45, 30], [55, 31], [68, 33], [58, 28], [50, 22],
    [83, 10], [90, 8], [79, 17], [87, 24], [80, 31], [91, 36], [76, 22]],
  3: P3_PATROL,
};

/** Lamps hanging over (or set under) the water: [gx, gz, kind]. */
export type PoolLampKind = "hall" | "deck" | "under" | "pocket" | "emergency" | "gallery";
export const POOL_LAMPS: [number, number, PoolLampKind][] = [
  // Part 2.
  [47, 4, "hall"], [56, 9, "hall"], [66, 4, "hall"], [44, 18, "hall"], [55, 19, "gallery"], [68, 16, "gallery"],
  [61, 22, "hall"], [44, 30, "hall"], [56, 33, "gallery"], [65, 29, "hall"], [60, 37, "emergency"],
  [50, 9, "hall"], [62, 18, "hall"], [52, 31, "hall"], [70, 33, "hall"], [42, 8, "hall"],
  [80, 10, "hall"], [89, 8, "hall"], [84, 16, "hall"], [92, 17, "gallery"], [79, 26, "hall"], [88, 25, "hall"],
  [82, 34, "hall"], [78, 36, "gallery"], [88, 33, "gallery"],
  // Part 3.
  [60, 42, "deck"], [57, 43, "deck"], [63, 43, "deck"],
  ...P3_LAMPS,
  [75, 73, "emergency"], [73, 73, "pocket"],
];

/** In-world painted warnings: [gx, gz, side the wall is on, i18n key]. */
export const POOL_SIGNS: [number, number, "N" | "S" | "E" | "W", MessageKey][] = [
  [40, 12, "S", "pool.sign.climb"],
  [60, 38, "W", "pool.sign.below"],
  [57, 42, "N", "pool.sign.breath"],
  [75, 72, "N", "pool.sign.exit"],
];
