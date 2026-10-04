/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94 "The Old Town": floor plan, puzzle data and the rules both the
 * world and the monsters need, as plain data with no rendering imports.
 *
 * Cells are 4 m; x is the grid column (gx) and z the grid row (gz). The
 * level runs from south (high z) to north (low z):
 *
 *        exit (35,2)
 *   ┌── THRONE ROOM ──┐   the King sits in the middle; the door is north
 *   │   corridor      │   a short corridor behind the puzzle gate
 *   │ ANIMATION ROOM  │   the model of the town
 *   │   ENTRANCE      │   toys, paintings
 *   └──── gate ───────┘
 *      GRASS HILLS        a winding valley, empty but for furniture
 *         road            the barricade (35,50) only opens at night
 *   ┌──── OLD TOWN ────┐  ring streets, a plaza with the clock tower in
 *   │  ▢ ▢  │  ▢ ▢     │  the middle, four blocks of houses (six of them
 *   │  ▢ ▢  ┼  ▢ ▢     │  can be entered), and the bus stop at (35,68)
 *   └──── bus stop ────┘  where everyone arrives
 *
 * Map layout is fixed. The room seed only picks where each clock part lies
 * (out of two spots each) and how the model starts out of place, through
 * {@link townRng} — never Math.random, which would desync clients.
 */

import { EntityType } from "../../shared/entityTypes";

export const TOWN_GRID = 72;
/** Metres per grid cell. */
export const TOWN_CELL = 4;

export type TownKind = "street" | "alley" | "plaza" | "interior" | "road" | "hills" | "room" | "door" | "exit";
export type TownZone = "town" | "road" | "hills" | "castle";
export type TownSide = "N" | "S" | "W" | "E";

export interface TownRect {
  id: string;
  kind: TownKind;
  x1: number; z1: number; x2: number; z2: number;
}

const rect = (id: string, kind: TownKind, x1: number, z1: number, x2: number, z2: number): TownRect => ({ id, kind, x1, z1, x2, z2 });

/** World-space centre of a cell. */
export const cellCenter = (g: number) => g * TOWN_CELL + TOWN_CELL / 2;

// ---------------------------------------------------------------------------
// The town
// ---------------------------------------------------------------------------

/** Everything a player can walk on in town, apart from the house interiors. */
export const TOWN_STREETS: readonly TownRect[] = [
  rect("northSt", "street", 25, 51, 45, 51),
  rect("midSt", "street", 25, 57, 45, 57),
  rect("southSt", "street", 25, 67, 45, 67),
  rect("westSt", "street", 25, 51, 25, 67),
  rect("eastSt", "street", 45, 51, 45, 67),
  rect("mainSt", "street", 35, 51, 35, 57),
  rect("busStop", "street", 35, 68, 35, 68),
  rect("alleyNW", "alley", 30, 52, 30, 56),
  rect("alleyNE", "alley", 40, 52, 40, 56),
  rect("alleySW", "alley", 26, 62, 30, 62),
  rect("alleySE", "alley", 40, 62, 44, 62),
  rect("plaza", "plaza", 31, 58, 39, 66),
];

/** The town square's clock tower (one solid cell in the middle of the plaza). */
export const TOWN_TOWER = { gx: 35, gz: 62 };
/** Where everyone arrives: the bus stop south of the town. */
export const TOWN_SPAWN = { gx: 35, gz: 68 };
/** The only way out of town: a road north, barricaded until night falls. */
export const TOWN_BARRICADE = { gx: 35, gz: 50 };
/** Cells of the road out (barricade included). */
export const TOWN_ROAD = rect("road", "road", 35, 46, 35, 50);
/** The town's flat footprint (houses and all); beyond it the hills begin. */
export const TOWN_FOOTPRINT = { x1: 22, z1: 50, x2: 48, z2: 71 };
/** Centre of the town in world metres (the model in the castle is built around it). */
export const TOWN_CENTER_X = (TOWN_FOOTPRINT.x1 + TOWN_FOOTPRINT.x2 + 1) * TOWN_CELL / 2;
export const TOWN_CENTER_Z = (TOWN_FOOTPRINT.z1 + TOWN_FOOTPRINT.z2 + 1) * TOWN_CELL / 2;

export type LotStyle = "cottage" | "house" | "tall" | "shop" | "garage" | "chapel" | "cinema" | "hotel";

export interface TownLot {
  id: string;
  x1: number; z1: number; x2: number; z2: number;
  style: LotStyle;
  /** Wall and roof colours. */
  wall: number;
  roof: number;
  floors: number;
  /** Enterable houses: the cell and side of their door. Their whole lot is the interior. */
  door?: { gx: number; gz: number; side: TownSide };
  /** i18n key of a shop sign over the front. */
  sign?: string;
}

const lot = (id: string, x1: number, z1: number, x2: number, z2: number, style: LotStyle, wall: number, roof: number, floors: number, extra: Partial<TownLot> = {}): TownLot =>
  ({ id, x1, z1, x2, z2, style, wall, roof, floors, ...extra });

/**
 * Every building in town. The four blocks between the streets are tiled
 * exactly (alleys aside); the ring outside the ring streets is dotted with
 * more houses whose backs sink into the hills.
 */
export const TOWN_LOTS: readonly TownLot[] = [
  // NW block (west of the alley, then east of it)
  lot("houseA", 26, 52, 29, 53, "cottage", 0xf2b8b5, 0x8f3b3b, 1, { door: { gx: 27, gz: 52, side: "N" } }),
  lot("nw2", 26, 54, 29, 56, "house", 0xf3dc8c, 0x6b4a32, 2),
  lot("garage", 31, 52, 34, 53, "garage", 0xc9c2b2, 0x5b5f66, 1, { door: { gx: 34, gz: 53, side: "E" }, sign: "town.sign.garage" }),
  lot("hotel", 31, 54, 34, 56, "hotel", 0xd9a6c8, 0x5a3d6b, 3, { sign: "town.sign.hotel" }),
  // NE block
  lot("bakery", 36, 52, 39, 53, "shop", 0xf6e7c8, 0xb5523b, 1, { door: { gx: 36, gz: 52, side: "W" }, sign: "town.sign.bakery" }),
  lot("ne2", 36, 54, 39, 56, "house", 0xa9d3e8, 0x3c5a7a, 2),
  lot("ne3", 41, 52, 44, 54, "house", 0xb6d9a8, 0x4d6b3a, 2),
  lot("houseB", 41, 55, 44, 56, "cottage", 0xf0c99a, 0x7a4a2a, 1, { door: { gx: 43, gz: 56, side: "S" } }),
  // SW block (north of the alley, then south of it)
  lot("chapel", 26, 58, 30, 61, "chapel", 0xeeeae0, 0x4a4f5a, 1),
  lot("houseC", 26, 63, 27, 65, "cottage", 0xc8d8f0, 0x40527a, 1, { door: { gx: 26, gz: 64, side: "W" } }),
  lot("sw3", 28, 63, 30, 66, "house", 0xf2c6a0, 0x8a4b2f, 2),
  lot("sw4", 26, 66, 27, 66, "shop", 0xe8d0e8, 0x6b3a5a, 1, { sign: "town.sign.barber" }),
  // SE block
  lot("seShops", 40, 58, 40, 61, "shop", 0xf7d9a0, 0x7a5a2a, 1, { sign: "town.sign.grocer" }),
  lot("houseD", 41, 58, 44, 60, "house", 0xd0e6c8, 0x5a6b3a, 1, { door: { gx: 44, gz: 59, side: "E" } }),
  lot("se2", 41, 61, 44, 61, "shop", 0xe6c3c3, 0x6b3434, 1, { sign: "town.sign.tailor" }),
  lot("cinema", 40, 63, 44, 66, "cinema", 0xe9b44c, 0x7a2e2e, 2, { sign: "town.sign.cinema" }),
  // Outer ring
  lot("w1", 22, 52, 24, 55, "house", 0xe8c4d8, 0x6b3a52, 2),
  lot("w2", 22, 57, 24, 60, "cottage", 0xf5e2a8, 0x7a5a2a, 1),
  lot("w3", 22, 62, 24, 66, "tall", 0xc4d4e8, 0x3a4a6b, 3),
  lot("e1", 46, 52, 48, 56, "tall", 0xf0b8a0, 0x7a3a2a, 3),
  lot("e2", 46, 58, 48, 61, "house", 0xc8e8d8, 0x3a6b5a, 2),
  lot("e3", 46, 63, 48, 66, "cottage", 0xf8d8c0, 0x8a5a3a, 1),
  lot("s1", 28, 68, 33, 70, "house", 0xd8d0f0, 0x4a3a7a, 2),
  lot("s2", 37, 68, 42, 70, "house", 0xf0e0b0, 0x7a6a3a, 2),
];

export function townLot(id: string): TownLot {
  return TOWN_LOTS.find((l) => l.id === id)!;
}

/** The house with the chair facing the open door (the secret ending ends there). */
export const STAY_HOUSE = "houseC";
/** The chair itself (world metres); it faces west, out of the door. */
export const STAY_CHAIR = { x: 109.0, z: 258.0 };

// ---------------------------------------------------------------------------
// The hills
// ---------------------------------------------------------------------------

/** The valley's centre line (cells), from the road out of town to the castle gate. */
export const VALLEY_PATH: readonly [number, number][] = [
  [35, 47], [39, 44], [41, 40], [36, 37], [29, 36], [25, 32], [27, 29], [35, 28],
];
/** Half-width of the walkable valley, in cells. */
export const VALLEY_RADIUS = 3.2;

// ---------------------------------------------------------------------------
// The castle
// ---------------------------------------------------------------------------

/** Solid outline the castle's outer walls stand on. */
export const CASTLE_FOOTPRINT = { x1: 31, z1: 1, x2: 39, z2: 26 };

export const CASTLE_ROOMS: readonly TownRect[] = [
  rect("entrance", "room", 32, 22, 38, 25),
  rect("animRoom", "room", 32, 16, 38, 20),
  rect("corridor", "room", 35, 13, 35, 15),
  rect("throne", "room", 32, 3, 38, 12),
];

/** Doorways between castle rooms (and the gate from the hills). */
export const CASTLE_DOORS: readonly { id: string; gx: number; gz: number }[] = [
  { id: "gate", gx: 35, gz: 26 },
  { id: "inner", gx: 35, gz: 21 },
];

/** The corridor's first cell: shut until the model of the town is put right. */
export const PUZZLE_GATE = { gx: 35, gz: 15 };
/** Beyond the throne room's north door. Walking in ends the level. */
export const TOWN_EXIT = { gx: 35, gz: 2 };
/** Where the King sits (facing south, towards whoever walks in). */
export const KING_THRONE = { gx: 35, gz: 8 };
/** Where someone the King caught wakes up again. */
export const KING_CHECKPOINT = { gx: 35, gz: 12 };
/** The throne room's north door, in world metres (its centre, on the wall). */
export const THRONE_DOOR_X = cellCenter(TOWN_EXIT.gx);
export const THRONE_DOOR_Z = (TOWN_EXIT.gz + 1) * TOWN_CELL;

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export type ClockPart = "key" | "gear" | "hand";
export const CLOCK_PARTS: readonly ClockPart[] = ["key", "gear", "hand"];

export interface PartSpot {
  /** World metres; y is the height of the surface it lies on. */
  x: number; y: number; z: number;
  /** The lot (house) it is in. */
  lot: string;
}

/** Two candidate spots per part, each on a table, bench or counter the world builds. */
export const PART_SPOTS: Record<ClockPart, readonly PartSpot[]> = {
  key: [
    { x: 105.2, y: 0.78, z: 255.4, lot: "houseC" },
    { x: 116.0, y: 0.78, z: 210.0, lot: "houseA" },
  ],
  gear: [
    { x: 129.0, y: 0.95, z: 209.0, lot: "garage" },
    { x: 177.5, y: 0.78, z: 242.0, lot: "houseD" },
  ],
  hand: [
    { x: 153.0, y: 1.02, z: 213.2, lot: "bakery" },
    { x: 176.0, y: 0.78, z: 225.5, lot: "houseB" },
  ],
};

/** Which candidate spot each part lies on, for this room. */
export function partSpot(part: ClockPart, seed: number): PartSpot {
  const rng = townRng((seed ^ 0x94c10c) >>> 0);
  const picks = CLOCK_PARTS.map(() => (rng() < 0.5 ? 0 : 1));
  return PART_SPOTS[part][picks[CLOCK_PARTS.indexOf(part)]];
}

/** The clock's mechanism hatch, on the tower's south face (world metres; the player stands south of it). */
export const CLOCK_HATCH = { x: cellCenter(TOWN_TOWER.gx), y: 1.25, z: (TOWN_TOWER.gz + 1) * TOWN_CELL };
/** Height of the tower's four clock faces. */
export const CLOCK_FACE_Y = 17.5;

// ---------------------------------------------------------------------------
// The model of the town (Animation Room)
// ---------------------------------------------------------------------------

/** Table the model sits on, in the middle of the Animation Room (world metres). */
export const MODEL_TABLE = { x: cellCenter(35), z: 72, y: 0.92 };
/** Model metres per real metre. */
export const MODEL_SCALE = 0.04;

export type ModelPieceId = "house" | "car" | "clock";
export const MODEL_PIECES: readonly ModelPieceId[] = ["house", "car", "clock"];

/**
 * Where each piece may stand, in REAL town metres (the model maps them onto
 * the table). Slot 0 is always where the thing really is: the clock in the
 * plaza, the red car outside the garage, the house with the chair on its lot.
 */
export const MODEL_SLOTS: Record<ModelPieceId, readonly [number, number][]> = {
  house: [[108, 258], [158, 236], [118, 278]],
  car: [[143.4, 214], [174, 270], [122, 246]],
  clock: [[142, 250], [162, 230], [106, 206]],
};

/** How the model starts: every piece off its true spot (slot 1 or 2), picked by the room seed. */
export function modelStart(seed: number): Record<ModelPieceId, number> {
  const rng = townRng((seed ^ 0x3a0de1) >>> 0);
  const out = {} as Record<ModelPieceId, number>;
  for (const id of MODEL_PIECES) out[id] = rng() < 0.5 ? 1 : 2;
  return out;
}

/** Real-town metres -> world metres on the model table. */
export function modelPoint(x: number, z: number): [number, number] {
  return [MODEL_TABLE.x + (x - TOWN_CENTER_X) * MODEL_SCALE, MODEL_TABLE.z + (z - TOWN_CENTER_Z) * MODEL_SCALE];
}

/** Network encoding of a model move: piece * 3 + slot. */
export function encodeModel(piece: ModelPieceId, slot: number): number {
  return MODEL_PIECES.indexOf(piece) * 3 + slot;
}

export function decodeModel(index: number): { piece: ModelPieceId; slot: number } | null {
  const piece = MODEL_PIECES[Math.floor(index / 3)];
  return piece ? { piece, slot: index % 3 } : null;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type TownsfolkRole = "sweeper" | "reader" | "postman" | "kid" | "lady" | "waver" | "painter" | "dancer" | "hatman";

export interface TownsfolkSpot {
  role: TownsfolkRole;
  /** World metres. */
  x: number; z: number;
  /** Facing (radians about Y; 0 looks south, +z). */
  yaw: number;
  /** Clothes and hat. */
  coat: number;
  hat: number;
}

/** The daytime townsfolk: harmless, looping the same few motions forever. */
export const TOWNSFOLK: readonly TownsfolkSpot[] = [
  { role: "sweeper", x: 150, z: 205.5, yaw: 0.4, coat: 0x6b8fbf, hat: 0x2b2b2b },
  { role: "reader", x: 129.5, z: 238.5, yaw: Math.PI / 2, coat: 0x8a6b4a, hat: 0x3a2a1a },
  { role: "postman", x: 110, z: 229, yaw: Math.PI / 2, coat: 0x2f4f8f, hat: 0x2f4f8f },
  { role: "kid", x: 153, z: 261, yaw: -2.4, coat: 0xd94f4f, hat: 0xf2d24b },
  { role: "lady", x: 144.2, z: 272.6, yaw: Math.PI, coat: 0x9a5fa8, hat: 0xd9a6c8 },
  { role: "waver", x: 157.5, z: 257, yaw: -Math.PI / 2, coat: 0xe9b44c, hat: 0x7a2e2e },
  { role: "painter", x: 182.6, z: 247, yaw: -Math.PI / 2, coat: 0xf2f2f2, hat: 0xf2f2f2 },
  { role: "dancer", x: 136.5, z: 245, yaw: 0.6, coat: 0x4fa87a, hat: 0x2b2b2b },
  { role: "dancer", x: 147.5, z: 245, yaw: -0.6, coat: 0xd98fb5, hat: 0x2b2b2b },
  { role: "hatman", x: 102, z: 222, yaw: -Math.PI / 2, coat: 0x4a4a4a, hat: 0x1a1a1a },
];

/** Where the night's Animations stand when the lights go out (cells). Some townsfolk never left. */
export const ANIMATION_CELLS: readonly [number, number][] = [[33, 60], [40, 57], [30, 54], [35, 51]];

/** Houses that make noises behind their doors by day (world metres of the sound). */
export const NOISY_HOUSES: readonly { x: number; z: number }[] = [
  { x: 100, z: 216 }, { x: 186, z: 236 }, { x: 140, z: 222 }, { x: 116, z: 278 },
];

// ---------------------------------------------------------------------------
// The cell grid
// ---------------------------------------------------------------------------

export interface TownCell {
  kind: TownKind;
  zone: TownZone;
  /** Street, lot, castle room or "valley". */
  region: string;
}

const grid: (TownCell | null)[][] = Array.from({ length: TOWN_GRID }, () => Array<TownCell | null>(TOWN_GRID).fill(null));

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance (cells) from a point to the valley's centre line. */
export function valleyDistance(gx: number, gz: number): number {
  let best = Infinity;
  for (let i = 0; i < VALLEY_PATH.length - 1; i++) {
    const [ax, az] = VALLEY_PATH[i], [bx, bz] = VALLEY_PATH[i + 1];
    best = Math.min(best, distToSegment(gx, gz, ax, az, bx, bz));
  }
  return best;
}

const inRect = (gx: number, gz: number, r: { x1: number; z1: number; x2: number; z2: number }) => gx >= r.x1 && gx <= r.x2 && gz >= r.z1 && gz <= r.z2;

(function buildGrid() {
  // 1. The valley, clipped off the town and the castle.
  for (let x = 2; x < TOWN_GRID - 2; x++) {
    for (let z = 2; z < TOWN_GRID - 2; z++) {
      if (inRect(x, z, TOWN_FOOTPRINT) || inRect(x, z, CASTLE_FOOTPRINT)) continue;
      if (valleyDistance(x, z) <= VALLEY_RADIUS) grid[x][z] = { kind: "hills", zone: "hills", region: "valley" };
    }
  }
  // 2. The road out of town (it runs through the valley's first cells).
  for (let z = TOWN_ROAD.z1; z <= TOWN_ROAD.z2; z++) grid[TOWN_ROAD.x1][z] = { kind: "road", zone: "road", region: "road" };
  // 3. Streets, alleys and the plaza; the tower stays solid.
  for (const r of TOWN_STREETS) {
    for (let x = r.x1; x <= r.x2; x++) for (let z = r.z1; z <= r.z2; z++) grid[x][z] = { kind: r.kind, zone: "town", region: r.id };
  }
  grid[TOWN_TOWER.gx][TOWN_TOWER.gz] = null;
  // 4. Houses that can be entered: their whole lot.
  for (const l of TOWN_LOTS) {
    if (!l.door) continue;
    for (let x = l.x1; x <= l.x2; x++) for (let z = l.z1; z <= l.z2; z++) grid[x][z] = { kind: "interior", zone: "town", region: l.id };
  }
  // 5. The castle.
  for (const r of CASTLE_ROOMS) {
    for (let x = r.x1; x <= r.x2; x++) for (let z = r.z1; z <= r.z2; z++) grid[x][z] = { kind: "room", zone: "castle", region: r.id };
  }
  for (const d of CASTLE_DOORS) grid[d.gx][d.gz] = { kind: "door", zone: "castle", region: d.id };
  grid[TOWN_EXIT.gx][TOWN_EXIT.gz] = { kind: "exit", zone: "castle", region: "exit" };
})();

/** What a cell is, or null for solid ground (buildings, hillsides, castle walls). */
export function townCellAt(gx: number, gz: number): TownCell | null {
  return grid[gx]?.[gz] ?? null;
}

/** The zone a world position is in (null when it isn't on a walkable cell). */
export function townZoneAt(x: number, z: number): TownZone | null {
  return townCellAt(Math.floor(x / TOWN_CELL), Math.floor(z / TOWN_CELL))?.zone ?? null;
}

/** Inside a house: the Animations never follow anyone in. */
export function townIsIndoors(x: number, z: number): boolean {
  return townCellAt(Math.floor(x / TOWN_CELL), Math.floor(z / TOWN_CELL))?.kind === "interior";
}

/** The lot an enterable house's cell belongs to. */
export function townRegionAt(x: number, z: number): string | null {
  return townCellAt(Math.floor(x / TOWN_CELL), Math.floor(z / TOWN_CELL))?.region ?? null;
}

/**
 * Where each monster may go: the Animations keep to the town's streets
 * (never a house, never the road out); the King never leaves his hall.
 */
export function townEntityMayEnter(type: EntityType, gx: number, gz: number): boolean {
  const cell = grid[gx]?.[gz];
  if (!cell) return false;
  if (type === EntityType.TOWN_KING) return cell.region === "throne";
  if (type === EntityType.ANIMATION) return cell.zone === "town" && cell.kind !== "interior";
  return true;
}

/** Cells a monster of `type` could stand on, furthest from (gx, gz) first. */
export function townRelocationCells(type: EntityType, gx: number, gz: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < TOWN_GRID; x++) for (let z = 0; z < TOWN_GRID; z++) if (townEntityMayEnter(type, x, z)) out.push([x, z]);
  return out.sort((a, b) => Math.hypot(b[0] - gx, b[1] - gz) - Math.hypot(a[0] - gx, a[1] - gz));
}

/**
 * Whether there is a clear line between two points (metres). `blocked` is
 * the map's collision test: walls, house fronts and parked cars all hide
 * someone; a lamp post mostly doesn't (it's thinner than the step).
 */
export function townSightClear(ax: number, az: number, bx: number, bz: number, blocked: (x: number, z: number) => boolean): boolean {
  const dx = bx - ax, dz = bz - az;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
  for (let i = 2; i < steps - 1; i++) {
    if (blocked(ax + (dx * i) / steps, az + (dz * i) / steps)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ground height (the hills)
// ---------------------------------------------------------------------------

/** Distance (cells) from each cell to the nearest open ground: the valley, the town or the castle. */
const openDistance: Float32Array = (() => {
  const n = TOWN_GRID;
  const d = new Float32Array(n * n).fill(1e6);
  for (let x = 0; x < n; x++) {
    for (let z = 0; z < n; z++) {
      const g = grid[x][z];
      if ((g && g.zone !== "castle") || inRect(x, z, TOWN_FOOTPRINT) || inRect(x, z, CASTLE_FOOTPRINT)) d[x * n + z] = 0;
    }
  }
  // Two-pass chamfer distance transform (1 / sqrt 2 weights).
  const D = Math.SQRT2;
  const relax = (x: number, z: number, nx: number, nz: number, w: number) => {
    if (nx < 0 || nz < 0 || nx >= n || nz >= n) return;
    const v = d[nx * n + nz] + w;
    if (v < d[x * n + z]) d[x * n + z] = v;
  };
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    relax(x, z, x - 1, z, 1); relax(x, z, x, z - 1, 1); relax(x, z, x - 1, z - 1, D); relax(x, z, x + 1, z - 1, D);
  }
  for (let x = n - 1; x >= 0; x--) for (let z = n - 1; z >= 0; z--) {
    relax(x, z, x + 1, z, 1); relax(x, z, x, z + 1, 1); relax(x, z, x + 1, z + 1, D); relax(x, z, x - 1, z + 1, D);
  }
  return d;
})();

/** Bilinear distance to open ground at a fractional cell position; keeps growing past the grid's edge. */
function openDistanceAt(cx: number, cz: number): number {
  const n = TOWN_GRID;
  const outside = Math.hypot(Math.max(0, -cx, cx - (n - 1)), Math.max(0, -cz, cz - (n - 1)));
  const x = Math.max(0, Math.min(n - 1.001, cx)), z = Math.max(0, Math.min(n - 1.001, cz));
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
  const v = (a: number, b: number) => openDistance[Math.min(n - 1, a) * n + Math.min(n - 1, b)];
  const top = v(x0, z0) * (1 - fx) + v(x0 + 1, z0) * fx;
  const bottom = v(x0, z0 + 1) * (1 - fx) + v(x0 + 1, z0 + 1) * fx;
  return top * (1 - fz) + bottom * fz + outside;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rectDistance(x: number, z: number, r: { x1: number; z1: number; x2: number; z2: number }): number {
  const x1 = r.x1 * TOWN_CELL, x2 = (r.x2 + 1) * TOWN_CELL, z1 = r.z1 * TOWN_CELL, z2 = (r.z2 + 1) * TOWN_CELL;
  return Math.hypot(Math.max(0, x1 - x, x - x2), Math.max(0, z1 - z, z - z2));
}

/**
 * Ground height (metres) at a world position. Flat in town and inside the
 * castle; a gentle roll along the valley floor; and outside the walkable
 * ground, hills that rise from the edge of it (never under anyone's feet:
 * the slope starts beyond the last walkable cell's border).
 */
export function townGroundHeight(x: number, z: number): number {
  const flat = Math.min(rectDistance(x, z, TOWN_FOOTPRINT), rectDistance(x, z, CASTLE_FOOTPRINT));
  if (flat <= 0) return 0;
  const fade = smoothstep(4, 18, flat);
  const roll = (Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.7) * 1.1 + Math.sin(x * 0.09 + z * 0.07) * 0.45) * fade;
  const d = openDistanceAt(x / TOWN_CELL - 0.5, z / TOWN_CELL - 0.5);
  if (d <= 0.7) return roll;
  const lumps = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(x * 0.031 - z * 0.017) * Math.cos(z * 0.027 + x * 0.011));
  const cap = 15 + 9 * (0.5 + 0.5 * Math.sin(x * 0.013 + 2.1) * Math.sin(z * 0.019 - 0.4));
  return roll + Math.min(cap, 6.5 * Math.pow(d - 0.7, 1.12)) * lumps;
}

/** Tiny deterministic PRNG (mulberry32): never Math.random for anything cross-client. */
export function townRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
