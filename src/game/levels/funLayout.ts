/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level FUN's floor plan and puzzle data, as plain data with no rendering or
 * engine imports (so it can be reasoned about, and tested, on its own).
 *
 * Cells are 4 m; x is the grid column (gx) and z the grid row (gz). The level
 * is one route with side branches, in three movements:
 *
 *   PUZZLE 1  Hall A (spawn) + two side rooms (A2, A3)      -> gate G1
 *   PUZZLE 2  a long gallery ("hub") with four themed rooms  -> gate G2
 *             off its south side; the sequence lock sits on
 *             the hub's east wall
 *   PUZZLE 3  a long corridor, a depot, then the huge last   -> gate G3 -> exit
 *             hall with a kitchen and a playroom branching
 *             off it
 *
 * Nothing here is random except the puzzle-2 code, which is derived from the
 * room seed so every client agrees on it.
 */

import type { FunDoorVariant, PartyColor, PartyItem, PartySymbol } from "../LevelFunModels";

export const FUN_GRID = 48;

export type FunRectKind = "hall" | "room" | "corridor";

export interface FunRect {
  id: string;
  kind: FunRectKind;
  x1: number; z1: number; x2: number; z2: number;
}

const rect = (id: string, kind: FunRectKind, x1: number, z1: number, x2: number, z2: number): FunRect => ({ id, kind, x1, z1, x2, z2 });

/**
 * Later entries win where two overlap (a corridor mouth into a room, say).
 * A one-cell gap of solid between neighbours is deliberate everywhere: two
 * walkable cells side by side are one open space, so every join below is a
 * corridor.
 */
export const FUN_RECTS: readonly FunRect[] = [
  // --- Puzzle 1 --------------------------------------------------------
  rect("hallA", "hall", 2, 2, 12, 10),
  rect("roomA2", "room", 2, 14, 6, 19),
  rect("roomA3", "room", 9, 14, 13, 19),
  rect("corrA2", "corridor", 4, 11, 4, 13),
  rect("corrA3", "corridor", 11, 11, 11, 13),
  rect("corrA23", "corridor", 7, 17, 8, 17),
  rect("corrG1", "corridor", 13, 6, 14, 6),

  // --- Puzzle 2 --------------------------------------------------------
  rect("hub", "hall", 15, 2, 38, 9),
  rect("red", "room", 16, 13, 19, 18),
  rect("blue", "room", 22, 13, 25, 18),
  rect("yellow", "room", 28, 13, 31, 18),
  rect("green", "room", 34, 13, 37, 18),
  rect("corrRed", "corridor", 17, 10, 17, 12),
  rect("corrBlue", "corridor", 23, 10, 23, 12),
  rect("corrYellow", "corridor", 29, 10, 29, 12),
  rect("corrGreen", "corridor", 35, 10, 35, 12),
  rect("corrG2", "corridor", 39, 6, 44, 6),

  // --- Puzzle 3 --------------------------------------------------------
  rect("corrLong", "corridor", 44, 7, 44, 22),
  rect("depot", "room", 39, 14, 42, 20),
  rect("corrDepot", "corridor", 43, 17, 43, 17),
  rect("hallLast", "hall", 30, 23, 44, 41),
  rect("kitchen", "room", 33, 44, 40, 46),
  rect("corrKitchen", "corridor", 36, 42, 36, 43),
  rect("playroom", "room", 20, 28, 25, 34),
  rect("corrPlay", "corridor", 26, 31, 29, 31),
  rect("corrExit", "corridor", 26, 38, 29, 38),
];

export const FUN_SPAWN = { gx: 3, gz: 6 };
export const FUN_EXIT = { gx: 26, gz: 38 };

export interface FunGate {
  id: string;
  gx: number;
  gz: number;
  /** Axis a walker crosses the gate along. */
  axis: "x" | "z";
  color: PartyColor;
  variant: FunDoorVariant;
  /** Closed at the start; a director opens it. */
  closed: boolean;
}

export const FUN_GATES: readonly FunGate[] = [
  { id: "g1", gx: 13, gz: 6, axis: "x", color: "yellow", variant: "blocked", closed: true },
  { id: "g2", gx: 39, gz: 6, axis: "x", color: "purple", variant: "blocked", closed: true },
  { id: "g3", gx: 29, gz: 38, axis: "x", color: "green", variant: "exit", closed: true },
  // The themed rooms' own doors: open, apart from the odd scripted slam.
  { id: "doorRed", gx: 17, gz: 11, axis: "z", color: "red", variant: "normal", closed: false },
  { id: "doorBlue", gx: 23, gz: 11, axis: "z", color: "blue", variant: "normal", closed: false },
  { id: "doorYellow", gx: 29, gz: 11, axis: "z", color: "yellow", variant: "normal", closed: false },
  { id: "doorGreen", gx: 35, gz: 11, axis: "z", color: "green", variant: "normal", closed: false },
];

// ---------------------------------------------------------------------------
// Puzzle 1 — preparing the party
// ---------------------------------------------------------------------------

/** The right order to set the table, slot 1 first. `balloons` is the decoy pickup. */
export const P1_ORDER: readonly PartyItem[] = ["tablecloth", "plates", "cups", "gift", "candles"];
export const P1_DECOY: PartyItem = "balloons";

// ---------------------------------------------------------------------------
// Puzzle 2 — the four party rooms
// ---------------------------------------------------------------------------

export type FunTheme = "red" | "blue" | "yellow" | "green";
export const FUN_THEMES: readonly FunTheme[] = ["red", "blue", "yellow", "green"];

/** Which symbol each room paints; the panel's buttons carry the same four. */
export const THEME_SYMBOL: Record<FunTheme, PartySymbol> = {
  red: "heart",
  blue: "moon",
  yellow: "star",
  green: "triangle",
};

/** Panel button colours are deliberately *not* the rooms' colours: the symbol is the clue. */
export const PANEL_BUTTONS: readonly { color: PartyColor; symbol: PartySymbol }[] = [
  { color: "green", symbol: "heart" },
  { color: "yellow", symbol: "moon" },
  { color: "purple", symbol: "star" },
  { color: "orange", symbol: "triangle" },
];

export interface FunCode {
  /** For each room, its symbol's place (1-4) in the sequence, shown as a count of drawings. */
  position: Record<FunTheme, number>;
  /** Panel button indices in the order they must be pressed. */
  presses: number[];
}

/** Tiny deterministic PRNG (mulberry32); layout-side only, never Math.random. */
export function funRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** funRng wrapped in the Rng shape the model builders take (nextInt's max is exclusive, like SeededRandom's). */
export class FunRandom {
  private readonly draw: () => number;
  constructor(seed: number) { this.draw = funRng(seed); }
  next(): number { return this.draw(); }
  nextRange(min: number, max: number): number { return min + this.draw() * (max - min); }
  nextInt(min: number, max: number): number { return Math.floor(this.nextRange(min, max)); }
}

export function funCodeForSeed(seed: number): FunCode {
  const r = funRng((seed ^ 0xf00d5eed) >>> 0);
  const places = [1, 2, 3, 4];
  for (let i = places.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [places[i], places[j]] = [places[j], places[i]];
  }
  const position = {} as Record<FunTheme, number>;
  FUN_THEMES.forEach((theme, i) => { position[theme] = places[i]; });
  // Button k carries THEME_SYMBOL[theme]; press them by ascending place.
  const presses = FUN_THEMES
    .map((theme) => ({ place: position[theme], button: PANEL_BUTTONS.findIndex((b) => b.symbol === THEME_SYMBOL[theme]) }))
    .sort((a, b) => a.place - b.place)
    .map((entry) => entry.button);
  return { position, presses };
}

// ---------------------------------------------------------------------------
// Puzzle 3 — the last party
// ---------------------------------------------------------------------------

export type FunFinalItem = "cake" | "gift" | "balloon";
export const P3_ITEMS: readonly FunFinalItem[] = ["cake", "gift", "balloon"];

// ---------------------------------------------------------------------------
// Region lookup
// ---------------------------------------------------------------------------

const regionGrid: (FunRect | null)[][] = Array.from({ length: FUN_GRID }, () => Array<FunRect | null>(FUN_GRID).fill(null));
for (const r of FUN_RECTS) {
  for (let x = r.x1; x <= r.x2; x++) for (let z = r.z1; z <= r.z2; z++) regionGrid[x][z] = r;
}

/** The rectangle a cell belongs to, or null for solid rock. */
export function funRegionAt(gx: number, gz: number): FunRect | null {
  return regionGrid[gx]?.[gz] ?? null;
}

export function funIsWalkable(gx: number, gz: number): boolean {
  return funRegionAt(gx, gz) !== null;
}

/** World-space (metres) centre of a cell. */
export function funCellCenter(gx: number, gz: number, cellSize = 4): [number, number] {
  return [gx * cellSize + cellSize / 2, gz * cellSize + cellSize / 2];
}

export function funGateAt(gx: number, gz: number): FunGate | undefined {
  return FUN_GATES.find((g) => g.gx === gx && g.gz === gz);
}
