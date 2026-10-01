/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 1 "Habitable Zone": a three-storey parking garage, as plain data with
 * no rendering or engine imports (like spaceLayout.ts).
 *
 * The engine's world is one grid with a floor height per cell, so the three
 * storeys sit side by side along X, each one a full storey higher than the
 * last, with a solid divider between them. Ramps are the only way up: each
 * one starts in the open middle of a floor (well clear of the outer walls and
 * corners), climbs as one continuous slope through the divider, and comes out
 * in the middle of the next floor. Ramps are enclosed on both sides, so they
 * can only be entered at their foot or their top.
 *
 *   x:  2 ─── 14 │15│ 16 ─── 30 │31│ 32 ─── 45
 *        floor 1    floor 2      floor 3
 *        explore    car code     blackouts
 *
 * - Floor 1: open parking with partition walls; the level's monsters patrol it
 *   (and only it).
 * - Floor 2: the ramp up to floor 3 is shut behind a shutter. The keypad asks
 *   for the number of cars of each colour parked on this floor, in an order
 *   the keypad shows. Both the order and the counts come from the seed.
 * - Floor 3: forced blackouts. In the dark, moving outside an emergency
 *   light's circle draws the Smilers; standing still (or reaching a light) is
 *   safe. The exit is at the far end.
 *
 * Everything here is a pure function of the seed, so every client builds the
 * same garage and derives the same code.
 */

export const GARAGE_GRID = 48;
/** Floor elevation of each storey (metres). */
export const GARAGE_FLOOR_Y = [0, 3.2, 6.4] as const;

export interface GarageRect { x1: number; z1: number; x2: number; z2: number }

/** The three storeys, inclusive cell bounds. */
export const GARAGE_FLOORS: readonly GarageRect[] = [
  { x1: 2, z1: 2, x2: 14, z2: 45 },
  { x1: 16, z1: 2, x2: 30, z2: 45 },
  { x1: 32, z1: 2, x2: 45, z2: 45 },
];
/** Solid columns between storeys (only the ramps pass through them). */
export const GARAGE_DIVIDERS = [15, 31] as const;

export const GARAGE_SPAWN = { gx: 2, gz: 2 };
/** Metres from an emergency light's centre that count as safe in a blackout (the painted circle). */
export const GARAGE_SAFE_RADIUS = 2.6;

/** A ramp climbs one storey eastwards along X, two cells wide. */
export interface GarageRamp {
  /** Storey it starts on (0 or 1). */
  from: 0 | 1;
  x1: number; x2: number;
  z1: number; z2: number;
}

const RAMP_LEN = 9; // 4 cells on the lower floor, the divider, 4 on the upper floor

export type CarColor = "red" | "green" | "yellow" | "blue";
export const CAR_COLORS: readonly CarColor[] = ["red", "green", "yellow", "blue"];
export const CAR_COLOR_HEX: Record<CarColor | "grey", number> = {
  red: 0xa3201b, green: 0x2f7d32, yellow: 0xd9b21c, blue: 0x2350a8, grey: 0x3d474a,
};

export interface GarageCar { gx: number; gz: number; x: number; z: number; yaw: number; color: CarColor | "grey" }

export interface GaragePlan {
  ramps: [GarageRamp, GarageRamp];
  /** Floor 2's shutter: the foot cells of the ramp up to floor 3. */
  gate: { gx: number; z1: number; z2: number };
  /** The keypad kiosk beside the shutter (world metres), its screen facing -x. */
  keypad: { gx: number; gz: number; x: number; z: number };
  /** The colours, in the order the keypad asks for them, and the code that results. */
  colorOrder: CarColor[];
  code: string;
  /** Every car parked on floor 2, coloured or not (grey ones don't count). */
  cars: GarageCar[];
  /** Solid service cores (elevator shafts) on floors 1 and 2. */
  cores: GarageRect[];
  /** Short partition walls on floor 1. */
  partitions: [number, number][];
  /** Floor 3's emergency lights (cell centres): safe ground during a blackout. */
  safeLights: [number, number][];
  exit: { gx: number; gz: number };
}

/** Tiny deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inRect = (r: GarageRect, x: number, z: number) => x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;

export function garageFloorAt(gx: number): 0 | 1 | 2 | null {
  const i = GARAGE_FLOORS.findIndex((f) => gx >= f.x1 && gx <= f.x2);
  return i < 0 ? null : (i as 0 | 1 | 2);
}

/** Floor height across a ramp at a fractional cell position along X (cells, not metres). */
export function rampHeightAt(ramp: GarageRamp, cellX: number): number {
  const t = Math.min(1, Math.max(0, (cellX - ramp.x1) / (ramp.x2 - ramp.x1 + 1)));
  return GARAGE_FLOOR_Y[ramp.from] + (GARAGE_FLOOR_Y[ramp.from + 1] - GARAGE_FLOOR_Y[ramp.from]) * t;
}

export function rampAt(plan: GaragePlan, gx: number, gz: number): GarageRamp | null {
  return plan.ramps.find((r) => inRect(r, gx, gz)) ?? null;
}

/**
 * Cells kept clear of props, pillars and cars: the ramps and a ring around
 * them (so their mouths have room to circulate), the shutter's approach and
 * the keypad, the exit, and the emergency lights' circles.
 */
export function garageKeepClear(plan: GaragePlan, gx: number, gz: number): boolean {
  for (const r of plan.ramps) {
    if (gx >= r.x1 - 2 && gx <= r.x2 + 2 && gz >= r.z1 - 1 && gz <= r.z2 + 1) return true;
  }
  if (Math.abs(gx - plan.keypad.gx) <= 1 && Math.abs(gz - plan.keypad.gz) <= 1) return true;
  if (Math.abs(gx - plan.exit.gx) + Math.abs(gz - plan.exit.gz) <= 2) return true;
  if (plan.safeLights.some(([x, z]) => x === gx && z === gz)) return true;
  return gx <= GARAGE_SPAWN.gx + 2 && gz <= GARAGE_SPAWN.gz + 2;
}

/** Parking-structure columns: a regular grid, minus whatever has to stay clear. */
export function garagePillarAt(plan: GaragePlan, gx: number, gz: number): boolean {
  const floor = garageFloorAt(gx);
  if (floor === null) return false;
  const f = GARAGE_FLOORS[floor];
  if ((gx - f.x1) % 4 !== 2 || (gz - f.z1) % 4 !== 2) return false;
  if (garageKeepClear(plan, gx, gz)) return false;
  return !plan.cars.some((c) => c.gx === gx && c.gz === gz);
}

export function garagePlan(seed: number): GaragePlan {
  const r = rng((seed ^ 0x6a7a3e) >>> 0);
  const pick = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

  // Ramps: well inside each floor's length, and far apart from each other so
  // floor 2 has to be crossed (and searched) to get from one to the next.
  const zA = pick(12, 31);
  let zB = pick(8, 36);
  for (let tries = 0; Math.abs(zB - zA) < 12 && tries < 50; tries++) zB = pick(8, 36);
  if (Math.abs(zB - zA) < 12) zB = zA < 24 ? zA + 14 : zA - 14;
  const rampA: GarageRamp = { from: 0, x1: 11, x2: 11 + RAMP_LEN - 1, z1: zA, z2: zA + 1 };
  const rampB: GarageRamp = { from: 1, x1: 27, x2: 27 + RAMP_LEN - 1, z1: zB, z2: zB + 1 };

  const gate = { gx: rampB.x1, z1: rampB.z1, z2: rampB.z2 };
  const keypadGz = zB - 1;
  const keypad = { gx: rampB.x1 - 1, gz: keypadGz, x: (rampB.x1 - 1) * 4 + 3.2, z: keypadGz * 4 + 2.6 };

  // Floor 3: emergency lights on a grid, the exit at the end away from the ramp.
  const exit = { gx: 45, gz: zB < 24 ? 42 : 5 };
  const safeLights: [number, number][] = [];
  for (const x of [34, 39, 44]) {
    for (let z = 4; z <= 44; z += 6) {
      if (x <= rampB.x2 + 1 && z >= rampB.z1 - 1 && z <= rampB.z2 + 1) continue;
      safeLights.push([x, z]);
    }
  }

  const plan: GaragePlan = {
    ramps: [rampA, rampB], gate, keypad, colorOrder: [], code: "", cars: [], cores: [], partitions: [], safeLights, exit,
  };

  // Service cores: a 3x7 solid block on floors 1 and 2, clear of the ramps.
  const coreFor = (floor: 0 | 1, avoidZ: number[]) => {
    const f = GARAGE_FLOORS[floor];
    for (let tries = 0; tries < 120; tries++) {
      const x1 = floor === 0 ? pick(4, 7) : pick(19, 23);
      const z1 = pick(5, 36);
      const core = { x1, z1, x2: x1 + 2, z2: z1 + 6 };
      if (core.x2 > f.x2 - 2) continue;
      if (avoidZ.some((z) => z >= core.z1 - 3 && z <= core.z2 + 3)) continue;
      if (floor === 0 && core.z1 <= GARAGE_SPAWN.gz + 3) continue;
      return core;
    }
    return null;
  };
  const core1 = coreFor(0, [zA, zA + 1]);
  const core2 = coreFor(1, [zA, zA + 1, zB, zB + 1]);
  if (core1) plan.cores.push(core1);
  if (core2) plan.cores.push(core2);
  const inCore = (x: number, z: number) => plan.cores.some((c) => x >= c.x1 - 1 && x <= c.x2 + 1 && z >= c.z1 - 1 && z <= c.z2 + 1);

  // Floor 1: short partition walls (2 cells), never near a ramp, a core or spawn.
  const f1 = GARAGE_FLOORS[0];
  for (let tries = 0; tries < 60 && plan.partitions.length < 16; tries++) {
    const x = pick(f1.x1 + 2, f1.x2 - 2), z = pick(f1.z1 + 3, f1.z2 - 3);
    const horizontal = r() < 0.5;
    const cells: [number, number][] = horizontal ? [[x, z], [x + 1, z]] : [[x, z], [x, z + 1]];
    const ok = cells.every(([cx, cz]) => cx <= f1.x2 - 1 && !garageKeepClear(plan, cx, cz) && !inCore(cx, cz)
      && !plan.partitions.some(([px, pz]) => Math.abs(px - cx) <= 2 && Math.abs(pz - cz) <= 2));
    if (ok) plan.partitions.push(...cells);
  }

  // Floor 2's cars: 1-4 of each colour (the code's digits) plus a few grey
  // wrecks that don't count, each in its own bay.
  const order = [...CAR_COLORS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  plan.colorOrder = order;
  const counts = new Map<CarColor, number>(CAR_COLORS.map((c) => [c, pick(1, 4)]));
  const f2 = GARAGE_FLOORS[1];
  const bays: [number, number][] = [];
  for (let x = f2.x1; x <= f2.x2; x++) {
    for (let z = f2.z1 + 1; z <= f2.z2 - 1; z++) {
      if (garageKeepClear(plan, x, z) || inCore(x, z)) continue;
      const f = GARAGE_FLOORS[1];
      if ((x - f.x1) % 4 === 2 && (z - f.z1) % 4 === 2) continue; // a column stands there
      bays.push([x, z]);
    }
  }
  const take = (): [number, number] | null => {
    while (bays.length > 0) {
      const [x, z] = bays.splice(Math.floor(r() * bays.length), 1)[0];
      // One car per bay, never two side by side: each one stays easy to count.
      if (plan.cars.some((c) => Math.abs(c.gx - x) <= 1 && Math.abs(c.gz - z) <= 1)) continue;
      return [x, z];
    }
    return null;
  };
  const park = (color: CarColor | "grey") => {
    const bay = take();
    if (!bay) return false;
    const [gx, gz] = bay;
    plan.cars.push({ gx, gz, x: gx * 4 + 2 + (r() - 0.5) * 0.8, z: gz * 4 + 2 + (r() - 0.5) * 0.6, yaw: r() < 0.75 ? 0 : Math.PI / 2, color });
    return true;
  };
  for (const color of CAR_COLORS) {
    const n = counts.get(color)!;
    let parked = 0;
    for (let i = 0; i < n; i++) if (park(color)) parked++;
    counts.set(color, parked); // in the (unlikely) case the floor ran out of bays
  }
  for (let i = 0, grey = pick(3, 6); i < grey; i++) park("grey");
  plan.code = order.map((c) => counts.get(c)!).join("");

  return plan;
}
