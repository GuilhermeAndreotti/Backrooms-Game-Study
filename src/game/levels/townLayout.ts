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
 *   └──── gate ───────┘   all of it on top of a tall, steep hill
 *      GRASS HILLS        a winding valley, empty but for furniture, climbing
 *         road            the barricade (35,50) only opens at night
 *   ┌──── OLD TOWN ────┐  houses on hilltops (six can be entered), roads
 *   │ ⌂   ⌂    ⌂  ⌂    │  winding between the hills, the clock tower on the
 *   │   ⌂  ~~ ♜ ~~  ⌂  │  highest one, and the bus stop at (35,69) where
 *   └──── bus stop ────┘  everyone arrives
 *
 * Map layout is fixed. The room seed only picks where each clock part lies
 * (out of two spots each), through
 * {@link townRng} — never Math.random, which would desync clients.
 */

import { EntityType } from "../../shared/entityTypes";

export const TOWN_GRID = 72;
/** Metres per grid cell. */
export const TOWN_CELL = 4;

export type TownKind = "street" | "lawn" | "plaza" | "interior" | "road" | "hills" | "room" | "door" | "exit";
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
// The town: houses on hilltops, roads winding between them
// ---------------------------------------------------------------------------

/** The town's ground: every cell in here is walkable grass (houses and the tower aside). */
export const TOWN_AREA = { x1: 14, z1: 49, x2: 57, z2: 70 };
/** Kept for older call sites: the town's rectangle on the grid. */
export const TOWN_FOOTPRINT = TOWN_AREA;
/** World z of the town's north edge (its last fence): past it, the hills. */
export const TOWN_EDGE_Z = TOWN_AREA.z1 * 4;

/** The clock tower: one solid cell on top of the town's highest hill. */
export const TOWN_TOWER = { gx: 42, gz: 60 };
/** The little square around the tower (the hilltop's flat top). */
export const TOWER_PLAZA = { x1: 41, z1: 59, x2: 43, z2: 61 };
/** Where everyone arrives: the bus stop at the bottom of the main road. */
export const TOWN_SPAWN = { gx: 35, gz: 69 };
/** The only way out of town: the main road north, barricaded until night falls. */
export const TOWN_BARRICADE = { gx: 35, gz: 48 };
/** Cells of the road out (just the barricade: past it is the valley). */
export const TOWN_ROAD = rect("road", "road", 35, 48, 35, 48);
/** Centre of the town in world metres (the model in the castle is built around it). */
export const TOWN_CENTER_X = (TOWN_AREA.x1 + TOWN_AREA.x2 + 1) * 4 / 2;
export const TOWN_CENTER_Z = (TOWN_AREA.z1 + TOWN_AREA.z2 + 1) * 4 / 2;

/**
 * The town's roads (cell coordinates), winding through the valleys between
 * the hills and riding up and down over their feet. Purely visual: the grass
 * around them is just as walkable.
 */
export const TOWN_ROADS: readonly (readonly [number, number])[][] = [
  // Main road: bus stop -> past the chapel -> under the tower hill -> the barricade.
  [[35, 70], [35, 66], [34, 61], [33, 56], [35, 52], [35, 48]],
  // East loop: round the tower hill, between the houses on the east side.
  [[35, 66], [43, 67], [48, 61], [51, 56], [47, 54], [41, 55], [35, 54]],
  // West road: out past the garage and the blue house to the pink cottage.
  [[34, 61], [27, 61], [21, 59], [19, 56], [21, 50]],
];
/** Half-width of the asphalt (metres). */
export const TOWN_ROAD_HALF = 1.9;

export type LotStyle = "cottage" | "house" | "tall" | "shop" | "garage" | "chapel" | "cinema" | "hotel";

export interface TownLot {
  id: string;
  x1: number; z1: number; x2: number; z2: number;
  style: LotStyle;
  /** Wall and roof colours. */
  wall: number;
  roof: number;
  floors: number;
  /** Height of the hill the house stands on (metres above the town's base ground). */
  hill: number;
  /** Enterable houses: the cell and side of their door. Their whole lot is the interior. */
  door?: { gx: number; gz: number; side: TownSide };
  /** i18n key of a shop sign over the front. */
  sign?: string;
}

const lot = (id: string, x1: number, z1: number, x2: number, z2: number, style: LotStyle, wall: number, roof: number, floors: number, hill: number, extra: Partial<TownLot> = {}): TownLot =>
  ({ id, x1, z1, x2, z2, style, wall, roof, floors, hill, ...extra });

/**
 * Every building in town, each on its own hill (like a model railway's
 * village): the lot is the hill's flat top. Six of them can be entered.
 */
export const TOWN_LOTS: readonly TownLot[] = [
  // The six houses you can walk into (the clock parts are in three of them).
  lot("houseA", 17, 52, 20, 53, "cottage", 0xf2b8b5, 0x8f3b3b, 1, 3.5, { door: { gx: 18, gz: 52, side: "N" } }),
  lot("garage", 24, 54, 27, 55, "garage", 0xc9c2b2, 0x5b5f66, 1, 2.5, { door: { gx: 27, gz: 55, side: "E" }, sign: "town.sign.garage" }),
  lot("bakery", 38, 51, 41, 52, "shop", 0xf6e7c8, 0xb5523b, 1, 2.0, { door: { gx: 38, gz: 51, side: "W" }, sign: "town.sign.bakery" }),
  lot("houseB", 46, 57, 49, 58, "cottage", 0xf0c99a, 0x7a4a2a, 1, 4.0, { door: { gx: 48, gz: 58, side: "S" } }),
  lot("houseC", 21, 62, 22, 64, "cottage", 0xc8d8f0, 0x40527a, 1, 3.0, { door: { gx: 21, gz: 63, side: "W" } }),
  lot("houseD", 51, 62, 54, 64, "house", 0xd0e6c8, 0x5a6b3a, 1, 5.0, { door: { gx: 54, gz: 63, side: "E" } }),
  // The rest of the village.
  lot("chapel", 28, 63, 30, 65, "chapel", 0xeeeae0, 0x4a4f5a, 1, 4.5),
  lot("n2", 44, 50, 45, 51, "house", 0xa9d3e8, 0x3c5a7a, 2, 3.0),
  lot("n3", 53, 51, 54, 52, "tall", 0xf0b8a0, 0x7a3a2a, 2, 6.0),
  lot("n4", 55, 57, 56, 58, "house", 0xb6d9a8, 0x4d6b3a, 2, 6.5),
  lot("n5", 15, 58, 16, 59, "cottage", 0xf5e2a8, 0x7a5a2a, 1, 5.0),
  lot("n6", 29, 50, 30, 51, "house", 0xe8c4d8, 0x6b3a52, 2, 4.0),
  lot("n7", 46, 64, 47, 65, "cottage", 0xf8d8c0, 0x8a5a3a, 1, 2.5),
  lot("n8", 16, 66, 17, 67, "tall", 0xc4d4e8, 0x3a4a6b, 2, 6.0),
  lot("n9", 25, 67, 26, 68, "house", 0xd8d0f0, 0x4a3a7a, 2, 3.5),
  lot("n10", 47, 68, 48, 69, "cottage", 0xc8e8d8, 0x3a6b5a, 1, 2.0),
  lot("n11", 29, 57, 30, 58, "house", 0xf2c6a0, 0x8a4b2f, 2, 2.0),
  lot("n12", 51, 67, 52, 68, "house", 0xf0e0b0, 0x7a6a3a, 2, 3.5),
  lot("barber", 31, 68, 32, 69, "shop", 0xe8d0e8, 0x6b3a5a, 1, 0.6, { sign: "town.sign.barber" }),
  lot("grocer", 38, 68, 39, 69, "shop", 0xf7d9a0, 0x7a5a2a, 1, 0.6, { sign: "town.sign.grocer" }),
];

export function townLot(id: string): TownLot {
  return TOWN_LOTS.find((l) => l.id === id)!;
}

/** The tower's hill: the highest in town, its top flattened into a little square. */
export const TOWER_HILL = 9;

/** The house with the chair facing the open door (the secret ending ends there). */
export const STAY_HOUSE = "houseC";

/** Lot-relative spot (metres from the lot's north-west corner) -> world metres, on the lot's floor. */
export function lotPoint(lotId: string, u: number, v: number): { x: number; y: number; z: number } {
  const l = townLot(lotId);
  return { x: l.x1 * 4 + u, y: lotFloor(l), z: l.z1 * 4 + v };
}

/** The chair itself (world metres, on the house's floor); it faces west, out of the door. */
export function stayChair(): { x: number; y: number; z: number } {
  return lotPoint(STAY_HOUSE, 5, 6);
}

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
/** The castle stands on top of a tall, steep hill: its floor is this high (metres). */
export const CASTLE_FLOOR = 38;
/** How far (metres) from the castle's walls its hill runs before it meets the valley floor. */
export const CASTLE_HILL_RADIUS = 100;
/** The terrain around the castle stays open (no side hills) this far out from its walls. */
const CASTLE_SLOPE_WALK = 64;

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
  /** The lot (house) it is in, and where in it (metres from the lot's north-west corner). */
  lot: string;
  u: number; v: number;
  /** Height of the surface it lies on, above the house's floor. */
  y: number;
}

/** Two candidate spots per part, each on a table, workbench or counter the world builds. */
export const PART_SPOTS: Record<ClockPart, readonly PartSpot[]> = {
  key: [
    { lot: "houseC", u: 1.2, v: 3.4, y: 0.78 },
    { lot: "houseA", u: 12, v: 2, y: 0.78 },
  ],
  gear: [
    { lot: "garage", u: 5, v: 1, y: 0.95 },
    { lot: "houseD", u: 13.5, v: 10, y: 0.78 },
  ],
  hand: [
    { lot: "bakery", u: 9, v: 5.2, y: 1.02 },
    { lot: "houseB", u: 12, v: 5.5, y: 0.78 },
  ],
};

/** Which candidate spot each part lies on, for this room. */
export function partSpot(part: ClockPart, seed: number): PartSpot {
  const rng = townRng((seed ^ 0x94c10c) >>> 0);
  const picks = CLOCK_PARTS.map(() => (rng() < 0.5 ? 0 : 1));
  return PART_SPOTS[part][picks[CLOCK_PARTS.indexOf(part)]];
}

/** A part spot in world metres (y on the surface it lies on). */
export function partSpotWorld(spot: PartSpot): { x: number; y: number; z: number } {
  const p = lotPoint(spot.lot, spot.u, spot.v);
  return { x: p.x, y: p.y + spot.y, z: p.z };
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
export const MODEL_SCALE = 0.025;

/**
 * The model is missing five buildings: their plots stand empty on it, and
 * the buildings wait in a tray (the assembly panel, TownModelModal). Each one
 * goes back on the plot where the real one stands. `lot` is the real
 * building's lot; the tower's is its hilltop square.
 */
export type ModelPieceId = "tower" | "houseC" | "bakery" | "chapel" | "houseD";
export const MODEL_PIECES: readonly ModelPieceId[] = ["tower", "houseC", "bakery", "chapel", "houseD"];

export interface ModelPiece {
  id: ModelPieceId;
  /** Lot rectangle (cells) of the real building. */
  x1: number; z1: number; x2: number; z2: number;
  wall: number;
  roof: number;
}

export const MODEL_PIECE_DATA: readonly ModelPiece[] = MODEL_PIECES.map((id) => {
  if (id === "tower") return { id, ...TOWER_PLAZA, wall: 0xd8c8b0, roof: 0x2f5f4a };
  const l = townLot(id);
  return { id, x1: l.x1, z1: l.z1, x2: l.x2, z2: l.z2, wall: l.wall, roof: l.roof };
});

/** Real-town metres -> world metres on the model table. */
export function modelPoint(x: number, z: number): [number, number] {
  return [MODEL_TABLE.x + (x - TOWN_CENTER_X) * MODEL_SCALE, MODEL_TABLE.z + (z - TOWN_CENTER_Z) * MODEL_SCALE];
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
  { role: "sweeper", x: 149, z: 201.5, yaw: 0.4, coat: 0x6b8fbf, hat: 0x2b2b2b },
  { role: "reader", x: 165.2, z: 246.5, yaw: Math.PI / 2, coat: 0x8a6b4a, hat: 0x3a2a1a },
  { role: "postman", x: 133, z: 226, yaw: Math.PI / 2, coat: 0x2f4f8f, hat: 0x2f4f8f },
  { role: "kid", x: 126, z: 270, yaw: -2.4, coat: 0xd94f4f, hat: 0xf2d24b },
  { role: "lady", x: 143.4, z: 278.6, yaw: Math.PI, coat: 0x9a5fa8, hat: 0xd9a6c8 },
  { role: "waver", x: 190, z: 241, yaw: 0, coat: 0xe9b44c, hat: 0x7a2e2e },
  { role: "painter", x: 203.6, z: 271, yaw: -Math.PI / 2, coat: 0xf2f2f2, hat: 0xf2f2f2 },
  { role: "dancer", x: 165.5, z: 237.5, yaw: 0.6, coat: 0x4fa87a, hat: 0x2b2b2b },
  { role: "dancer", x: 174.5, z: 237.5, yaw: -0.6, coat: 0xd98fb5, hat: 0x2b2b2b },
  { role: "hatman", x: 78, z: 203, yaw: Math.PI, coat: 0x4a4a4a, hat: 0x1a1a1a },
];

/** Where the night's Animations stand when the lights go out (cells). Some townsfolk never left. */
export const ANIMATION_CELLS: readonly [number, number][] = [[34, 59], [46, 54], [24, 60], [35, 51]];

/** Houses that make noises behind their doors by day (world metres of the sound). */
export const NOISY_HOUSES: readonly { x: number; z: number }[] = [
  { x: 180, z: 204 }, { x: 64, z: 236 }, { x: 236, z: 232 }, { x: 104, z: 270 },
];

// ---------------------------------------------------------------------------
// The cell grid
// ---------------------------------------------------------------------------

export interface TownCell {
  kind: TownKind;
  zone: TownZone;
  /** "town", "road", "plaza", a lot, a castle room or "valley". */
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

/** Cells a road's centre line runs through. */
function roadCells(road: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, az] = road[i], [bx, bz] = road[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
    for (let k = 0; k <= n; k++) out.push([Math.round(ax + ((bx - ax) * k) / n), Math.round(az + ((bz - az) * k) / n)]);
  }
  return out;
}

/** Distance (metres) from a world point to the nearest town road's centre line. */
export function townRoadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const road of TOWN_ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i], [bx, bz] = road[i + 1];
      best = Math.min(best, distToSegment(x, z, cellCenter(ax), cellCenter(az), cellCenter(bx), cellCenter(bz)));
    }
  }
  return best;
}

(function buildGrid() {
  // 1. Everything north of the town's fence is open hillside, up to the castle's walls.
  //    No grid wall stops you out there: only ground too steep to climb does (see
  //    townSlope / TOWN_MAX_SLOPE, enforced by ProceduralMap.checkCollision), so every
  //    limit is something you can see.
  for (let x = 2; x < TOWN_GRID - 2; x++) {
    for (let z = 2; z <= TOWN_BARRICADE.gz; z++) {
      if (inRect(x, z, CASTLE_FOOTPRINT)) continue;
      grid[x][z] = { kind: "hills", zone: "hills", region: "valley" };
    }
  }
  // 2. The town: all grass, the tower and the houses aside; the barricade north.
  for (let x = TOWN_AREA.x1; x <= TOWN_AREA.x2; x++) {
    for (let z = TOWN_AREA.z1; z <= TOWN_AREA.z2; z++) grid[x][z] = { kind: "lawn", zone: "town", region: "town" };
  }
  for (const [x, z] of TOWN_ROADS.flatMap((r) => roadCells(r))) {
    if (grid[x]?.[z]?.region === "town") grid[x][z] = { kind: "street", zone: "town", region: "road" };
  }
  for (let x = TOWER_PLAZA.x1; x <= TOWER_PLAZA.x2; x++) for (let z = TOWER_PLAZA.z1; z <= TOWER_PLAZA.z2; z++) grid[x][z] = { kind: "plaza", zone: "town", region: "plaza" };
  grid[TOWN_TOWER.gx][TOWN_TOWER.gz] = null;
  for (let z = TOWN_ROAD.z1; z <= TOWN_ROAD.z2; z++) grid[TOWN_ROAD.x1][z] = { kind: "road", zone: "road", region: "road" };
  // 3. Houses: solid, except the ones you can walk into (their whole lot).
  for (const l of TOWN_LOTS) {
    for (let x = l.x1; x <= l.x2; x++) for (let z = l.z1; z <= l.z2; z++) {
      grid[x][z] = l.door ? { kind: "interior", zone: "town", region: l.id } : null;
    }
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
 * Where each monster may go: the Animations keep to the town (never a house,
 * never the road out); the King never leaves his hall.
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
 * someone; a lamp post mostly doesn't (it's thinner than the step). With
 * `ground`, a hill between the two eyes (1.5 m up) hides them too.
 */
export function townSightClear(ax: number, az: number, bx: number, bz: number, blocked: (x: number, z: number) => boolean, ground?: (x: number, z: number) => number): boolean {
  const dx = bx - ax, dz = bz - az;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
  const ya = ground ? ground(ax, az) + 1.5 : 0, yb = ground ? ground(bx, bz) + 1.5 : 0;
  for (let i = 2; i < steps - 1; i++) {
    const k = i / steps;
    const x = ax + dx * k, z = az + dz * k;
    if (blocked(x, z)) return false;
    if (ground && i % 3 === 0 && ground(x, z) > ya + (yb - ya) * k - 0.15) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ground height (the hills)
// ---------------------------------------------------------------------------

/** Distance (cells) from each cell to the nearest open ground: the valley, the town or the castle. */
/**
 * Cells the terrain keeps open (flat, valley-like): the town, the castle, the
 * road corridor and the castle's own slopes. Everything else rises into hills
 * around them. (The grid used to double as this; now it only says where walls are.)
 */
function isOpenSource(x: number, z: number): boolean {
  if (inRect(x, z, TOWN_AREA) || inRect(x, z, CASTLE_FOOTPRINT)) return true;
  if (z >= TOWN_BARRICADE.gz) return x === TOWN_BARRICADE.gx && z === TOWN_BARRICADE.gz;
  if (valleyDistance(x, z) <= VALLEY_RADIUS) return true;
  return rectDistance(cellCenter(x), cellCenter(z), CASTLE_FOOTPRINT) < CASTLE_SLOPE_WALK;
}

const openDistance: Float32Array = (() => {
  const n = TOWN_GRID;
  const d = new Float32Array(n * n).fill(1e6);
  for (let x = 0; x < n; x++) {
    for (let z = 0; z < n; z++) {
      if (isOpenSource(x, z)) d[x * n + z] = 0;
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
 * How steep the ground is at a world position (rise over run; 1 = 45 degrees),
 * measured over about 1.5 m. On open hillside, anything steeper than
 * {@link TOWN_MAX_SLOPE} can't be walked: that is the hills' only wall.
 */
export function townSlope(x: number, z: number): number {
  const h = 0.75;
  return Math.hypot(townGroundHeight(x + h, z) - townGroundHeight(x - h, z), townGroundHeight(x, z + h) - townGroundHeight(x, z - h)) / (2 * h);
}
/** About 38 degrees: the castle's own slopes (up to ~35) and its road are walkable, the valley's sides are not. */
export const TOWN_MAX_SLOPE = 0.8;

/** The castle's hill at `d` metres from its walls: a steep cone, rounded a little at the top. */
function castleRise(d: number): number {
  if (d >= CASTLE_HILL_RADIUS) return 0;
  return CASTLE_FLOOR * Math.pow(1 - d / CASTLE_HILL_RADIUS, 1.3);
}

/** The gentle roll everything sits on (town, valley, hills alike). */
function baseRoll(x: number, z: number): number {
  return Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.7) * 1.1 + Math.sin(x * 0.09 + z * 0.07) * 0.45;
}

/** A town hill: flat on top over its rect, falling away around it like a dome. */
interface Hill { r: { x1: number; z1: number; x2: number; z2: number }; h: number; radius: number }
/** Height of a hill's shoulder at `d` metres out from its flat top. */
const shoulder = (h: number, radius: number, d: number) => {
  if (d >= radius) return 0;
  const k = Math.cos((d / radius) * Math.PI * 0.5);
  return h * k * k;
};

/** Gap (metres) between two cell rectangles. */
function rectGap(a: { x1: number; z1: number; x2: number; z2: number }, b: { x1: number; z1: number; x2: number; z2: number }): number {
  const dx = Math.max(0, a.x1 - b.x2 - 1, b.x1 - a.x2 - 1) * TOWN_CELL;
  const dz = Math.max(0, a.z1 - b.z2 - 1, b.z1 - a.z2 - 1) * TOWN_CELL;
  return Math.hypot(dx, dz);
}

const HILLS: Hill[] = (() => {
  const hills: Hill[] = [
    ...TOWN_LOTS.map((l) => ({ r: l, h: l.hill, radius: 9 + l.hill * 1.6 })),
    { r: TOWER_PLAZA, h: TOWER_HILL, radius: 22 },
  ];
  // A house standing on a neighbour's slope sits as high as that slope reaches
  // its lot: hills merge into one another instead of meeting at a cliff.
  for (let pass = 0; pass < 4; pass++) {
    for (const a of hills) {
      for (const b of hills) {
        if (a !== b) a.h = Math.max(a.h, shoulder(b.h, b.radius, rectGap(a.r, b.r)));
      }
    }
  }
  return hills;
})();

/** The town's own ground before the roads are cut in: the roll, plus every hill (the tallest wins where they meet). */
function townRaw(x: number, z: number): number {
  let top = 0;
  for (const hill of HILLS) top = Math.max(top, shoulder(hill.h, hill.radius, rectDistance(x, z, hill.r)));
  return baseRoll(x, z) * 0.6 + top;
}

/** Floor height of a lot (the flat top of its hill). */
export function lotFloor(l: { x1: number; z1: number; x2: number; z2: number }): number {
  const cx = (l.x1 + l.x2 + 1) * TOWN_CELL / 2, cz = (l.z1 + l.z2 + 1) * TOWN_CELL / 2;
  return townRaw(cx, cz);
}

/** The tower's square, on top of its hill. */
export const TOWER_FLOOR = lotFloor(TOWER_PLAZA);

/** Pads: the lots' flat tops (blended out over a couple of metres so a doorstep never becomes a cliff). */
const PADS = [...TOWN_LOTS.map((l) => ({ r: l as { x1: number; z1: number; x2: number; z2: number }, y: lotFloor(l) })), { r: TOWER_PLAZA, y: TOWER_FLOOR }];

/**
 * Ground height (metres) at a world position. In town: hills under every
 * house, flat on top, the roads winding over the ground between them. Along the valley:
 * a gentle roll. Flat inside the castle. And outside the walkable ground, big
 * hills that rise from its edge (the slope starts beyond the last walkable
 * cell's border, never under anyone's feet).
 */
export function townGroundHeight(x: number, z: number): number {
  const castle = rectDistance(x, z, CASTLE_FOOTPRINT);
  if (castle <= 0) return CASTLE_FLOOR;
  const inTown = rectDistance(x, z, TOWN_AREA);
  let h: number;
  if (inTown < 40) {
    // The town (and a blend out of it): the hills, the roads riding over their feet.
    let town = townRaw(x, z);
    for (const pad of PADS) {
      const d = rectDistance(x, z, pad.r);
      if (d < 2.5) town += (pad.y - town) * (1 - smoothstep(0, 2.5, d));
    }
    const valley = baseRoll(x, z) * smoothstep(4, 18, castle) + castleRise(castle);
    h = town + (valley - town) * smoothstep(0, 40, inTown);
  } else {
    h = baseRoll(x, z) * smoothstep(4, 18, castle) + castleRise(castle);
  }
  // The valley's walls: big hills beyond the walkable ground, fading out on the castle's
  // own hill so it stands alone above everything else.
  const d = openDistanceAt(x / TOWN_CELL - 0.5, z / TOWN_CELL - 0.5);
  const walls = smoothstep(CASTLE_SLOPE_WALK * 0.7, CASTLE_HILL_RADIUS * 1.2, castle);
  if (d <= 0.7 || walls <= 0) return h;
  const lumps = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(x * 0.031 - z * 0.017) * Math.cos(z * 0.027 + x * 0.011));
  const cap = 15 + 9 * (0.5 + 0.5 * Math.sin(x * 0.013 + 2.1) * Math.sin(z * 0.019 - 0.4));
  return h + Math.min(cap, 6.5 * Math.pow(d - 0.7, 1.12)) * lumps * walls;
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
