/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 79 "Space Station": floor plan, terminals and the navigation puzzle's
 * rules, as plain data with no rendering or engine imports.
 *
 * Cells are 4 m; x is the grid column (gx) and z the grid row (gz). North
 * (-z) is where the black hole and the planet hang, so every room meant to
 * look at them has its big windows on its north wall:
 *
 *   deck ─────────────── observation deck (north + side windows): the finale
 *     │ corrDeckN
 *   nav ── corrDeckE     Navigation Room (north windows), the three consoles
 *     │                  and the helm
 *   lab   nav   comms    north of the spine
 *   ═════ spine ═══════  a long, closed service corridor, dock at its west end
 *   crew  tech  eng      south of the spine; cargo bay at its east end
 *
 * The puzzle: the station's systems all recommend the planet. Pointing all
 * three consoles at it "works" for a few seconds and then falls apart; the
 * clues (lab, comms, crew log, and the systems room once the planet run has
 * failed) point at the black hole instead, which is the real way out.
 */

export const SPACE_GRID = 32;
export const SPACE_WALL_H = 3.4;

export type SpaceRectKind = "hall" | "room" | "corridor";

export interface SpaceRect {
  id: string;
  kind: SpaceRectKind;
  x1: number; z1: number; x2: number; z2: number;
}

const rect = (id: string, kind: SpaceRectKind, x1: number, z1: number, x2: number, z2: number): SpaceRect => ({ id, kind, x1, z1, x2, z2 });

/** As in funLayout: neighbours are always one solid cell apart, so every join is a corridor. */
export const SPACE_RECTS: readonly SpaceRect[] = [
  rect("dock", "room", 2, 14, 4, 16),
  rect("spine", "corridor", 5, 15, 26, 15),
  rect("cargo", "room", 27, 13, 29, 17),

  rect("lab", "room", 3, 9, 7, 12),
  rect("corrLab", "corridor", 6, 13, 6, 14),
  rect("nav", "hall", 11, 9, 17, 12),
  rect("corrNavS", "corridor", 14, 13, 14, 14),
  rect("comms", "room", 21, 9, 25, 12),
  rect("corrComms", "corridor", 23, 13, 23, 14),

  // The route to the deck: out of the Navigation Room's east side, then north.
  rect("corrDeckE", "corridor", 18, 10, 19, 10),
  rect("corrDeckN", "corridor", 19, 6, 19, 9),
  rect("deck", "hall", 16, 3, 23, 5),

  rect("crew", "room", 4, 18, 8, 21),
  rect("corrCrew", "corridor", 6, 16, 6, 17),
  rect("tech", "room", 11, 18, 16, 21),
  rect("corrTech", "corridor", 13, 16, 13, 17),
  rect("eng", "room", 19, 17, 23, 20),
  rect("corrEng", "corridor", 21, 16, 21, 16),
];

export const SPACE_SPAWN = { gx: 3, gz: 15 };

/** Standing anywhere in these regions when the station arrives counts as watching it happen. */
export const OBSERVATION_REGIONS: readonly string[] = ["deck"];

export interface SpaceDoor {
  id: string;
  gx: number;
  gz: number;
  /** Axis a walker crosses the door along. */
  axis: "x" | "z";
  /** Sign over the door as read from its lower-coordinate side (-x or -z), and from the other side. */
  fromLow: string;
  fromHigh: string;
}

/** Automatic doors: always in a straight corridor cell, next to the room they serve. */
export const SPACE_DOORS: readonly SpaceDoor[] = [
  { id: "dLab", gx: 6, gz: 13, axis: "z", fromLow: "MAIN CORRIDOR", fromHigh: "ASTRONOMY LAB" },
  { id: "dNavS", gx: 14, gz: 13, axis: "z", fromLow: "MAIN CORRIDOR", fromHigh: "NAVIGATION" },
  { id: "dNavE", gx: 18, gz: 10, axis: "x", fromLow: "OBSERVATION DECK", fromHigh: "NAVIGATION" },
  { id: "dDeck", gx: 19, gz: 6, axis: "z", fromLow: "NAVIGATION", fromHigh: "OBSERVATION DECK" },
  { id: "dComms", gx: 23, gz: 13, axis: "z", fromLow: "MAIN CORRIDOR", fromHigh: "COMMUNICATIONS" },
  { id: "dCrew", gx: 6, gz: 17, axis: "z", fromLow: "CREW QUARTERS", fromHigh: "MAIN CORRIDOR" },
  { id: "dTech", gx: 13, gz: 17, axis: "z", fromLow: "SYSTEMS ANALYSIS", fromHigh: "MAIN CORRIDOR" },
  { id: "dEng", gx: 21, gz: 16, axis: "z", fromLow: "ENGINEERING", fromHigh: "MAIN CORRIDOR" },
];

export type SpaceSide = "N" | "S" | "W" | "E";

/**
 * Which outer walls are glass. A window only replaces a wall that faces solid
 * rock, and `from`/`to` (grid column or row along that wall) narrow it down.
 * The spine is left closed on purpose: a long metal tube between big views.
 */
export const SPACE_WINDOWS: readonly { region: string; side: SpaceSide; from?: number; to?: number }[] = [
  { region: "deck", side: "N" },
  { region: "deck", side: "W" },
  { region: "deck", side: "E" },
  { region: "nav", side: "N", from: 11, to: 15 },
  { region: "lab", side: "N" },
  { region: "lab", side: "W" },
  { region: "comms", side: "E" },
  { region: "crew", side: "S" },
  { region: "crew", side: "W" },
  { region: "tech", side: "S" },
  { region: "eng", side: "E" },
  { region: "cargo", side: "E" },
  { region: "cargo", side: "N" },
  { region: "dock", side: "W" },
];

/**
 * Wayfinding on the spine's walls. Arrows are as the reader sees them: on a
 * north wall (reader facing north) "►" points east, on a south wall west,
 * on a west wall north.
 */
export const SPACE_SIGNS: readonly { gx: number; gz: number; side: SpaceSide; text: string }[] = [
  { gx: 8, gz: 15, side: "N", text: "◄ DOCK      NAVIGATION ►" },
  { gx: 12, gz: 15, side: "N", text: "◄ ASTRONOMY LAB      NAVIGATION ►" },
  { gx: 17, gz: 15, side: "N", text: "◄ NAVIGATION      COMMUNICATIONS ►" },
  { gx: 25, gz: 15, side: "N", text: "◄ NAVIGATION      CARGO ►" },
  { gx: 10, gz: 15, side: "S", text: "◄ SYSTEMS ANALYSIS      CREW ►" },
  { gx: 18, gz: 15, side: "S", text: "◄ ENGINEERING      SYSTEMS ►" },
  { gx: 19, gz: 8, side: "W", text: "OBSERVATION DECK ►" },
];

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export type SpaceConsoleId = "orientation" | "destination" | "trajectory";
export const SPACE_CONSOLES: readonly SpaceConsoleId[] = ["orientation", "destination", "trajectory"];

export type SpaceTerminalId = "helm" | SpaceConsoleId | "analysis" | "destAnalysis" | "comms" | "crewLog" | "power";

export interface SpaceTerminal {
  id: SpaceTerminalId;
  /** World position (metres) of the terminal's base centre. */
  x: number;
  z: number;
  /** Rotation about Y; 0 means the screen faces +z (south). */
  yaw: number;
  /** Short name on the console's own nameplate. */
  name: string;
}

export const SPACE_TERMINALS: readonly SpaceTerminal[] = [
  // Engineering: the main power bus. Nothing else answers until it's rewired.
  { id: "power", x: 80, z: 68.8, yaw: 0, name: "POWER DISTRIBUTION" },
  // The three navigation systems are spread over the rooms around the helm:
  // DESTINATION in the Navigation Room, ORIENTATION in the astronomy lab,
  // TRAJECTORY in communications.
  { id: "destination", x: 58, z: 40.2, yaw: 0, name: "DESTINATION" },
  { id: "orientation", x: 29, z: 37.2, yaw: 0, name: "ORIENTATION" },
  { id: "trajectory", x: 91, z: 37.2, yaw: 0, name: "TRAJECTORY" },
  { id: "helm", x: 58, z: 46.5, yaw: 0, name: "NAVIGATION CORE" },
  // Clues.
  { id: "analysis", x: 18, z: 37.2, yaw: 0, name: "OBJECT ANALYSIS" },
  { id: "comms", x: 96, z: 37.2, yaw: 0, name: "SIGNAL LOG" },
  { id: "crewLog", x: 32, z: 72.8, yaw: 0, name: "CREW LOG" },
  { id: "destAnalysis", x: 62, z: 72.8, yaw: 0, name: "DESTINATION ANALYSIS" },
];

export function spaceTerminal(id: SpaceTerminalId): SpaceTerminal {
  return SPACE_TERMINALS.find((t) => t.id === id)!;
}

// ---------------------------------------------------------------------------
// The puzzle
// ---------------------------------------------------------------------------

export type SpaceTarget = "planet" | "blackhole" | "unknown";
export const SPACE_TARGETS: readonly SpaceTarget[] = ["planet", "blackhole", "unknown"];

/** What the station's computer calls each target (diegetic text: the station speaks English). */
export const TARGET_LABEL: Record<SpaceTarget, string> = {
  planet: "PLANET",
  blackhole: "BLACK HOLE",
  unknown: "UNKNOWN",
};

export type SpaceConfig = Record<SpaceConsoleId, SpaceTarget | null>;

export type SpaceExecResult =
  | { ok: true; target: "planet" | "blackhole" }
  | { ok: false; reason: "incomplete" | "conflict" | "noCoordinates" };

/** What pressing EXECUTE on the helm does with the consoles as they stand. */
export function evaluateSpaceConfig(config: SpaceConfig): SpaceExecResult {
  const values = SPACE_CONSOLES.map((c) => config[c]);
  if (values.some((v) => v === null)) return { ok: false, reason: "incomplete" };
  if (!values.every((v) => v === values[0])) return { ok: false, reason: "conflict" };
  if (values[0] === "unknown") return { ok: false, reason: "noCoordinates" };
  return { ok: true, target: values[0] as "planet" | "blackhole" };
}

/** Network encoding of a console setting: one small integer (console * 3 + target). */
export function encodeSetting(console: SpaceConsoleId, target: SpaceTarget): number {
  return SPACE_CONSOLES.indexOf(console) * SPACE_TARGETS.length + SPACE_TARGETS.indexOf(target);
}

export function decodeSetting(index: number): { console: SpaceConsoleId; target: SpaceTarget } | null {
  const console = SPACE_CONSOLES[Math.floor(index / SPACE_TARGETS.length)];
  const target = SPACE_TARGETS[index % SPACE_TARGETS.length];
  return console && target ? { console, target } : null;
}

// ---------------------------------------------------------------------------
// The power puzzle: rewire the main bus, colour to colour
// ---------------------------------------------------------------------------

export type WireColor = "red" | "blue" | "yellow" | "green" | "white";
export const WIRE_COLORS: readonly WireColor[] = ["red", "blue", "yellow", "green", "white"];

/** The order the cable ends (left) and the sockets (right) sit in on the panel; the same for the whole room. */
export function wiringForSeed(seed: number): { left: WireColor[]; right: WireColor[] } {
  const rng = spaceRng((seed ^ 0x77e1) >>> 0);
  const shuffle = (list: readonly WireColor[]) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const left = shuffle(WIRE_COLORS);
  let right = shuffle(WIRE_COLORS);
  // Never straight across: that would be no puzzle at all.
  while (right.every((c, i) => c === left[i])) right = shuffle(WIRE_COLORS);
  return { left, right };
}

/** Seconds from TRAJECTORY LOCKED to arrival. */
export const ARRIVAL_SECONDS = 17;

// ---------------------------------------------------------------------------
// Region lookup
// ---------------------------------------------------------------------------

const regionGrid: (SpaceRect | null)[][] = Array.from({ length: SPACE_GRID }, () => Array<SpaceRect | null>(SPACE_GRID).fill(null));
for (const r of SPACE_RECTS) {
  for (let x = r.x1; x <= r.x2; x++) for (let z = r.z1; z <= r.z2; z++) regionGrid[x][z] = r;
}

/** The rectangle a cell belongs to, or null for open space. */
export function spaceRegionAt(gx: number, gz: number): SpaceRect | null {
  return regionGrid[gx]?.[gz] ?? null;
}

export function spaceDoorAt(gx: number, gz: number): SpaceDoor | undefined {
  return SPACE_DOORS.find((d) => d.gx === gx && d.gz === gz);
}

/** Whether a cell's `side` wall is glass. */
export function spaceWindowAt(gx: number, gz: number, side: SpaceSide): boolean {
  const region = spaceRegionAt(gx, gz);
  if (!region) return false;
  const along = side === "N" || side === "S" ? gx : gz;
  return SPACE_WINDOWS.some((w) => w.region === region.id && w.side === side && along >= (w.from ?? -Infinity) && along <= (w.to ?? Infinity));
}

/** Tiny deterministic PRNG (mulberry32), layout-side only: never Math.random for anything cross-client. */
export function spaceRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
