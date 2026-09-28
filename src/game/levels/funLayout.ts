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
  rect("hallA", "hall", 2, 2, 8, 7),
  rect("roomA2", "room", 2, 9, 5, 11),
  rect("roomA3", "room", 7, 9, 10, 11),
  rect("corrA2", "corridor", 4, 8, 4, 8),
  rect("corrA3", "corridor", 8, 8, 8, 8),
  rect("corrA23", "corridor", 6, 10, 6, 10),
  rect("corrG1", "corridor", 9, 4, 10, 4),

  // --- Puzzle 2 --------------------------------------------------------
  rect("corrHubIn", "corridor", 11, 4, 11, 4),
  rect("hub", "hall", 12, 2, 27, 6),
  rect("red", "room", 12, 8, 14, 10),
  rect("blue", "room", 16, 8, 18, 10),
  rect("yellow", "room", 20, 8, 22, 10),
  rect("green", "room", 24, 8, 26, 10),
  rect("corrRed", "corridor", 13, 7, 13, 7),
  rect("corrBlue", "corridor", 17, 7, 17, 7),
  rect("corrYellow", "corridor", 21, 7, 21, 7),
  rect("corrGreen", "corridor", 25, 7, 25, 7),
  // Gate g2 sits at x=29, the MIDDLE cell of this straight run — both its
  // neighbours here are corridor, not a turn, so the door actually blocks
  // the only way through instead of standing beside an open bend.
  rect("corrG2", "corridor", 28, 4, 30, 4),

  // --- Puzzle 3 --------------------------------------------------------
  // Column x=30, not 29: the turn south happens one cell past the gate,
  // never on the gate's own cell.
  rect("corrLong", "corridor", 30, 5, 30, 16),
  rect("depot", "room", 25, 13, 27, 15),
  rect("corrDepot", "corridor", 28, 14, 29, 14),
  rect("hallLast", "hall", 24, 17, 33, 24),
  // Kept one column clear of corrExit's x=26 so the party room never touches
  // the gated exit column directly (that would let players sidestep g3).
  rect("kitchen", "room", 28, 26, 31, 27),
  rect("corrKitchen", "corridor", 28, 25, 28, 25),
  rect("playroom", "room", 18, 20, 20, 22),
  rect("corrPlay", "corridor", 21, 21, 23, 21),
  // Single-file, gated at its mouth (g3): the only way out of hallLast is
  // straight through this column, never alongside it.
  rect("corrExit", "corridor", 26, 25, 26, 27),
];

export const FUN_SPAWN = { gx: 3, gz: 4 };
export const FUN_EXIT = { gx: 26, gz: 27 };

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
  { id: "g1", gx: 10, gz: 4, axis: "x", color: "yellow", variant: "blocked", closed: true },
  { id: "g2", gx: 29, gz: 4, axis: "x", color: "purple", variant: "blocked", closed: true },
  { id: "g3", gx: 26, gz: 25, axis: "z", color: "green", variant: "exit", closed: true },
  // The themed rooms' own doors: open, apart from the odd scripted slam.
  { id: "doorRed", gx: 13, gz: 7, axis: "z", color: "red", variant: "normal", closed: false },
  { id: "doorBlue", gx: 17, gz: 7, axis: "z", color: "blue", variant: "normal", closed: false },
  { id: "doorYellow", gx: 21, gz: 7, axis: "z", color: "yellow", variant: "normal", closed: false },
  { id: "doorGreen", gx: 25, gz: 7, axis: "z", color: "green", variant: "normal", closed: false },
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
