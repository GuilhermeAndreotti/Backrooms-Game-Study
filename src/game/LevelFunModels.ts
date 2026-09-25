/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Models for Level FUN: an abandoned children's party venue that starts
 * cheerful and gets steadily more wrong. This module is ONLY geometry,
 * materials and canvas textures — no puzzle state, no triggers, no timers.
 * Everything a later puzzle/logic layer may want to animate or swap is
 * reachable by name (`object.getObjectByName("leaf")`, "flame", "tube", ...)
 * or through the `anchors` a piece reports, and the swappable material sets
 * (tubes, lamps) are exported so flicker/blackout code never has to mutate a
 * cached material shared by every instance.
 *
 * Conventions, matching LevelDecor.ts:
 * - floor is y = 0, +Y up, a cell is 4 m wide and walls are 3 m tall;
 * - wall-mounted pieces (doors, windows, drawings, posters, panels, symbols)
 *   are built in the wall plane z = 0, facing +Z — the caller moves them onto
 *   whichever wall they belong to;
 * - `funRoomDecor`/`funThemedRoomDecor` follow LevelDecor's cell frame
 *   instead: back wall is the plane z = -half;
 * - footprints are local (x, z, radius) collision circles;
 * - every random choice comes from the caller's Rng (never Math.random), so
 *   every client builds the identical level.
 *
 * `FunStage` drives the level's slide from festive (0) to uneasy (1) to
 * wrong (2): duller textures, stains, deflated balloons, knocked-over chairs.
 */

import * as THREE from "three";
import type { DecorKit, DecorPiece, Rng } from "./LevelDecor";
import { t } from "../i18n";

export type FunStage = 0 | 1 | 2;

export type PartyColor = "red" | "blue" | "yellow" | "green" | "pink" | "purple" | "orange" | "white";

export const PARTY_COLORS: Record<PartyColor, number> = {
  red: 0xe23b3b,
  blue: 0x3b72e2,
  yellow: 0xf2cc2e,
  green: 0x3fb85a,
  pink: 0xf07ab8,
  purple: 0x8e52d6,
  orange: 0xf08a2a,
  white: 0xf2efe6,
};

const CSS = (c: PartyColor) => `#${PARTY_COLORS[c].toString(16).padStart(6, "0")}`;
const FESTIVE: PartyColor[] = ["red", "blue", "yellow", "green", "pink", "purple", "orange"];

/** Things the party is made of — also the vocabulary of the crayon clue drawings. */
export type PartyItem = "tablecloth" | "plates" | "cups" | "hats" | "cake" | "candles" | "gift" | "balloons";

/** Painted wall symbols (puzzle 2 clues). Digits are drawn as numerals. */
export type PartySymbol =
  | "star" | "heart" | "circle" | "triangle" | "square" | "moon" | "smile"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** A spot a logic layer can place something at: local position + facing (yaw, rad). */
export interface FunAnchor { x: number; y: number; z: number; yaw: number }

export interface FunPiece extends DecorPiece {
  anchors?: Record<string, FunAnchor>;
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

const std = (kit: DecorKit, key: string, params: THREE.MeshStandardMaterialParameters) =>
  kit.mat(`fun_${key}`, () => new THREE.MeshStandardMaterial(params));

/** Party plastic: saturated, a touch of self-glow so colours still read in dim rooms. */
const plastic = (kit: DecorKit, c: PartyColor, gloss = 0.35) =>
  std(kit, `plastic_${c}_${gloss}`, { color: PARTY_COLORS[c], roughness: gloss, metalness: 0.02, emissive: PARTY_COLORS[c], emissiveIntensity: 0.06 });

function mesh(kit: DecorKit, key: string, build: () => THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(kit.geo(`fun_${key}`, build), mat);
  m.position.set(x, y, z);
  return m;
}

const box = (kit: DecorKit, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) =>
  mesh(kit, `box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d), mat, x, y, z);

const cyl = (kit: DecorKit, rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 14) =>
  mesh(kit, `cyl_${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);

const sphere = (kit: DecorKit, r: number, mat: THREE.Material, x: number, y: number, z: number, seg = 12) =>
  mesh(kit, `sph_${r}_${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), mat, x, y, z);

const plane = (kit: DecorKit, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number) =>
  mesh(kit, `plane_${w}_${h}`, () => new THREE.PlaneGeometry(w, h), mat, x, y, z);

/** Cylinder running from a to b (for limbs, table legs at an angle, sticks). */
function rod(kit: DecorKit, r: number, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, seg = 8): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(kit, `rod_${r}_${len.toFixed(3)}_${seg}`, () => new THREE.CylinderGeometry(r, r * 0.85, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function canvasTexture(kit: DecorKit, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4; }
  kit.track(map);
  return map;
}

/** Canvas-painted material. `cutout` keeps the canvas alpha (pennants, decals, paint on walls). */
function canvasMat(kit: DecorKit, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, opts: { cutout?: boolean; unlit?: boolean } = {}): THREE.Material {
  return kit.mat(`fun_canvas_${key}`, () => {
    const map = canvasTexture(kit, w, h, draw);
    const alpha = opts.cutout ? { transparent: true, alphaTest: 0.08, side: THREE.DoubleSide } : {};
    return opts.unlit
      ? new THREE.MeshBasicMaterial({ map, ...alpha })
      : new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...alpha });
  });
}

/** Tiny deterministic PRNG for canvas scribbles (visual only, never world state). */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let v = s;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function hashKey(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const KID_FONT = `"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive`;

// ---------------------------------------------------------------------------
// Crayon drawing primitives (shared by drawings, notes, symbols, messages)
// ---------------------------------------------------------------------------

/** A wobbly multi-pass crayon stroke through `pts`. */
function crayon(ctx: CanvasRenderingContext2D, r: () => number, pts: [number, number][], color: string, width: number, close = false) {
  ctx.strokeStyle = color;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let pass = 0; pass < 3; pass++) {
    ctx.globalAlpha = 0.55 + r() * 0.35;
    ctx.lineWidth = width * (0.6 + r() * 0.5);
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (r() - 0.5) * width * 0.8, jy = y + (r() - 0.5) * width * 0.8;
      if (i === 0) ctx.moveTo(jx, jy); else ctx.lineTo(jx, jy);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function crayonCircle(ctx: CanvasRenderingContext2D, r: () => number, cx: number, cy: number, rx: number, ry: number, color: string, width: number) {
  const pts: [number, number][] = [];
  const start = r() * Math.PI * 2;
  for (let i = 0; i <= 22; i++) {
    const a = start + (i / 20) * Math.PI * 2; // slight overshoot, like a kid closing the loop
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  crayon(ctx, r, pts, color, width);
}

/** Crayon scribble fill inside a rect (back-and-forth hatching). */
function crayonFill(ctx: CanvasRenderingContext2D, r: () => number, x: number, y: number, w: number, h: number, color: string) {
  const pts: [number, number][] = [];
  const step = 5 + r() * 3;
  for (let i = 0; i * step < w; i++) {
    pts.push([x + i * step, i % 2 ? y + h : y]);
  }
  crayon(ctx, r, pts, color, 4);
}

function crayonText(ctx: CanvasRenderingContext2D, r: () => number, text: string, x: number, y: number, size: number, color: string) {
  ctx.font = `bold ${size}px ${KID_FONT}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  let cx = x - ctx.measureText(text).width / 2;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    ctx.save();
    ctx.translate(cx + w / 2, y + (r() - 0.5) * size * 0.15);
    ctx.rotate((r() - 0.5) * 0.25);
    ctx.globalAlpha = 0.8 + r() * 0.2;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    cx += w;
  }
  ctx.globalAlpha = 1;
}

/** A small crayon icon for each party item, centred at (cx, cy) within size s. */
function drawPartyIcon(ctx: CanvasRenderingContext2D, r: () => number, item: PartyItem, cx: number, cy: number, s: number) {
  const h = s / 2;
  switch (item) {
    case "tablecloth": {
      crayon(ctx, r, [[cx - h, cy - h * 0.3], [cx + h, cy - h * 0.3], [cx + h * 0.8, cy + h * 0.6], [cx - h * 0.8, cy + h * 0.6]], "#d23a3a", 4, true);
      for (let i = -2; i <= 2; i++) crayon(ctx, r, [[cx + i * h * 0.35, cy - h * 0.3], [cx + i * h * 0.3, cy + h * 0.6]], "#d23a3a", 3);
      break;
    }
    case "plates":
      crayonCircle(ctx, r, cx, cy, h * 0.8, h * 0.45, "#3b72e2", 4);
      crayonCircle(ctx, r, cx, cy, h * 0.45, h * 0.25, "#3b72e2", 3);
      break;
    case "cups":
      for (const dx of [-h * 0.45, h * 0.45]) {
        crayon(ctx, r, [[cx + dx - h * 0.3, cy - h * 0.5], [cx + dx + h * 0.3, cy - h * 0.5], [cx + dx + h * 0.2, cy + h * 0.5], [cx + dx - h * 0.2, cy + h * 0.5]], "#3fb85a", 4, true);
      }
      break;
    case "hats":
      crayon(ctx, r, [[cx - h * 0.6, cy + h * 0.6], [cx, cy - h * 0.7], [cx + h * 0.6, cy + h * 0.6]], "#8e52d6", 4, true);
      crayon(ctx, r, [[cx - h * 0.3, cy], [cx + h * 0.3, cy + h * 0.2]], "#f2cc2e", 4);
      crayonCircle(ctx, r, cx, cy - h * 0.8, h * 0.12, h * 0.12, "#f07ab8", 4);
      break;
    case "cake":
      crayon(ctx, r, [[cx - h * 0.8, cy + h * 0.6], [cx + h * 0.8, cy + h * 0.6], [cx + h * 0.8, cy], [cx - h * 0.8, cy]], "#b06a3a", 4, true);
      crayon(ctx, r, [[cx - h * 0.5, cy], [cx - h * 0.5, cy - h * 0.45], [cx + h * 0.5, cy - h * 0.45], [cx + h * 0.5, cy]], "#f07ab8", 4);
      crayon(ctx, r, [[cx, cy - h * 0.45], [cx, cy - h * 0.8]], "#3b72e2", 3);
      break;
    case "candles":
      for (const dx of [-h * 0.4, 0, h * 0.4]) {
        crayon(ctx, r, [[cx + dx, cy + h * 0.6], [cx + dx, cy - h * 0.2]], "#3b72e2", 5);
        crayonCircle(ctx, r, cx + dx, cy - h * 0.4, h * 0.09, h * 0.16, "#f08a2a", 3);
      }
      break;
    case "gift":
      crayon(ctx, r, [[cx - h * 0.7, cy - h * 0.4], [cx + h * 0.7, cy - h * 0.4], [cx + h * 0.7, cy + h * 0.6], [cx - h * 0.7, cy + h * 0.6]], "#3fb85a", 4, true);
      crayon(ctx, r, [[cx, cy - h * 0.4], [cx, cy + h * 0.6]], "#e23b3b", 4);
      crayonCircle(ctx, r, cx - h * 0.2, cy - h * 0.55, h * 0.18, h * 0.12, "#e23b3b", 3);
      crayonCircle(ctx, r, cx + h * 0.2, cy - h * 0.55, h * 0.18, h * 0.12, "#e23b3b", 3);
      break;
    case "balloons":
      crayonCircle(ctx, r, cx - h * 0.3, cy - h * 0.3, h * 0.3, h * 0.38, "#e23b3b", 4);
      crayonCircle(ctx, r, cx + h * 0.3, cy - h * 0.35, h * 0.3, h * 0.38, "#f2cc2e", 4);
      crayon(ctx, r, [[cx - h * 0.3, cy + h * 0.08], [cx, cy + h * 0.7], [cx + h * 0.3, cy + h * 0.03]], "#333", 2);
      break;
  }
}

function drawSymbol(ctx: CanvasRenderingContext2D, r: () => number, symbol: PartySymbol, cx: number, cy: number, s: number, color: string, width: number) {
  const h = s / 2;
  switch (symbol) {
    case "star": {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? h * 0.42 : h;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      crayon(ctx, r, pts, color, width);
      break;
    }
    case "heart": {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        const x = 16 * Math.sin(a) ** 3;
        const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
        pts.push([cx + (x / 17) * h, cy + (y / 17) * h]);
      }
      crayon(ctx, r, pts, color, width);
      break;
    }
    case "circle": crayonCircle(ctx, r, cx, cy, h * 0.9, h * 0.9, color, width); break;
    case "triangle": crayon(ctx, r, [[cx, cy - h], [cx + h, cy + h * 0.8], [cx - h, cy + h * 0.8]], color, width, true); break;
    case "square": crayon(ctx, r, [[cx - h * 0.8, cy - h * 0.8], [cx + h * 0.8, cy - h * 0.8], [cx + h * 0.8, cy + h * 0.8], [cx - h * 0.8, cy + h * 0.8]], color, width, true); break;
    case "moon": {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 16; i++) { const a = Math.PI * 0.35 + (i / 16) * Math.PI * 1.3; pts.push([cx + Math.cos(a) * h, cy + Math.sin(a) * h]); }
      for (let i = 16; i >= 0; i--) { const a = Math.PI * 0.35 + (i / 16) * Math.PI * 1.3; pts.push([cx + h * 0.35 + Math.cos(a) * h * 0.7, cy + Math.sin(a) * h * 0.8]); }
      crayon(ctx, r, pts, color, width, true);
      break;
    }
    case "smile":
      // "=)" — the level's signature.
      crayon(ctx, r, [[cx - h * 0.9, cy - h * 0.25], [cx - h * 0.1, cy - h * 0.25]], color, width);
      crayon(ctx, r, [[cx - h * 0.9, cy + h * 0.25], [cx - h * 0.1, cy + h * 0.25]], color, width);
      crayon(ctx, r, [[cx + h * 0.3, cy - h * 0.8], [cx + h * 0.75, cy - h * 0.3], [cx + h * 0.8, cy + h * 0.3], [cx + h * 0.3, cy + h * 0.8]], color, width);
      break;
    default:
      crayonText(ctx, r, symbol, cx, cy + h * 0.08, s * 1.1, color);
  }
}

// ---------------------------------------------------------------------------
// Surfaces: wallpaper, carpet, ceiling
// ---------------------------------------------------------------------------

/**
 * Tiling yellow party wallpaper. Stage 0: clean with confetti dots and a
 * pastel dado stripe; 1: faded with water stains; 2: dim, peeling, smeared
 * with small "=)" scrawls. Texture repeats every metre (set `map.repeat`).
 * `theme` repaints the paper in that party colour (puzzle 2's rooms).
 */
export function funWallMaterial(kit: DecorKit, stage: FunStage, theme?: PartyColor): THREE.MeshStandardMaterial {
  return kit.mat(`fun_wall_${stage}_${theme ?? "yellow"}`, () => {
    const map = canvasTexture(kit, 256, 256, (ctx) => {
      const r = mulberry(4101 + stage);
      if (theme) {
        // A themed party room: the paper is the room's colour, washed out with the stage.
        const c = new THREE.Color(PARTY_COLORS[theme]).lerp(new THREE.Color(0xffffff), 0.18).lerp(new THREE.Color(0x5a5240), stage * 0.3);
        ctx.fillStyle = `#${c.getHexString()}`;
      } else {
        ctx.fillStyle = ["#efd35a", "#dcc15a", "#b9a14c"][stage];
      }
      ctx.fillRect(0, 0, 256, 256);
      // Faint vertical wallpaper bands.
      ctx.fillStyle = stage === 2 ? "rgba(70,55,20,0.08)" : "rgba(255,255,255,0.10)";
      for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 12, 256);
      // Confetti dots in party colours, fading out with stage.
      const alpha = [0.75, 0.45, 0.22][stage];
      for (let i = 0; i < 70; i++) {
        ctx.globalAlpha = alpha * (0.6 + r() * 0.4);
        ctx.fillStyle = CSS(FESTIVE[Math.floor(r() * FESTIVE.length)]);
        const x = r() * 256, y = r() * 256, s = 2 + r() * 3;
        if (r() < 0.5) ctx.fillRect(x, y, s * 1.6, s * 0.8);
        else { ctx.beginPath(); ctx.arc(x, y, s * 0.6, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      if (stage >= 1) {
        // Water stains bleeding down from the ceiling.
        for (let i = 0; i < 2 + stage * 2; i++) {
          const x = r() * 256, len = 60 + r() * 150;
          const grd = ctx.createLinearGradient(0, 0, 0, len);
          grd.addColorStop(0, "rgba(120,90,30,0.30)"); grd.addColorStop(1, "rgba(120,90,30,0)");
          ctx.fillStyle = grd;
          ctx.fillRect(x, 0, 6 + r() * 16, len);
        }
      }
      if (stage === 2) {
        // Grime, peeled patches and tiny scrawled faces.
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = `rgba(40,30,15,${0.08 + r() * 0.12})`;
          ctx.beginPath(); ctx.ellipse(r() * 256, r() * 256, 8 + r() * 26, 6 + r() * 18, r() * 3, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = 0; i < 2; i++) drawSymbol(ctx, r, "smile", 30 + r() * 196, 30 + r() * 196, 22, "rgba(90,20,20,0.55)", 2.5);
      }
    }, true);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.92 });
  });
}

/** Tiling kids' venue carpet: bright confetti shapes on teal, fading and staining with stage. */
export function funCarpetMaterial(kit: DecorKit, stage: FunStage): THREE.MeshStandardMaterial {
  return kit.mat(`fun_carpet_${stage}`, () => {
    const map = canvasTexture(kit, 256, 256, (ctx) => {
      const r = mulberry(7717 + stage);
      ctx.fillStyle = ["#2b7f86", "#2a6c70", "#23484a"][stage];
      ctx.fillRect(0, 0, 256, 256);
      // Fibre noise.
      for (let i = 0; i < 1600; i++) {
        ctx.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.06)";
        ctx.fillRect(r() * 256, r() * 256, 1, 1);
      }
      const alpha = [0.9, 0.6, 0.35][stage];
      for (let i = 0; i < 26; i++) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = CSS(FESTIVE[Math.floor(r() * FESTIVE.length)]);
        const x = r() * 256, y = r() * 256, s = 6 + r() * 9;
        ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI);
        const kind = Math.floor(r() * 3);
        if (kind === 0) { ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, s); ctx.lineTo(-s, s); ctx.fill(); }
        else if (kind === 1) { ctx.beginPath(); ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.lineWidth = 3; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s, s, 0); ctx.stroke(); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (stage >= 1) {
        for (let i = 0; i < stage * 3; i++) {
          ctx.fillStyle = `rgba(30,20,10,${0.18 + r() * 0.18})`;
          ctx.beginPath(); ctx.ellipse(r() * 256, r() * 256, 10 + r() * 30, 8 + r() * 20, r() * 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }, true);
    return new THREE.MeshStandardMaterial({ map, roughness: 1 });
  });
}

/** Tiling drop-ceiling tiles, slightly yellowed. */
export function funCeilingMaterial(kit: DecorKit): THREE.MeshStandardMaterial {
  return kit.mat("fun_ceiling", () => {
    const map = canvasTexture(kit, 128, 128, (ctx) => {
      const r = mulberry(99);
      ctx.fillStyle = "#e6dfc4"; ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 400; i++) { ctx.fillStyle = "rgba(90,80,50,0.12)"; ctx.fillRect(r() * 128, r() * 128, 1, 1); }
      ctx.strokeStyle = "#b5ab8a"; ctx.lineWidth = 3; ctx.strokeRect(1, 1, 126, 126);
    }, true);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  });
}

// ---------------------------------------------------------------------------
// Lighting fixtures (materials exported for flicker / blackout / colour shifts)
// ---------------------------------------------------------------------------

export interface FunTubeMaterials {
  on: THREE.MeshStandardMaterial;
  dim: THREE.MeshStandardMaterial;
  off: THREE.MeshStandardMaterial;
  /** Warm party tint for "the lights change" moments. */
  party: THREE.MeshStandardMaterial;
  /** Sickly red for the later stages. */
  wrong: THREE.MeshStandardMaterial;
}

export function funTubeMaterials(kit: DecorKit): FunTubeMaterials {
  const tube = (key: string, color: number, emissive: number, intensity: number) =>
    std(kit, `tube_${key}`, { color, emissive, emissiveIntensity: intensity, roughness: 0.3 });
  return {
    on: tube("on", 0xfffbe8, 0xfff4cf, 2.2),
    dim: tube("dim", 0xd8d2bc, 0xbfae78, 0.6),
    off: tube("off", 0x9c9888, 0x000000, 0),
    party: tube("party", 0xffd6f0, 0xff8fd0, 2.0),
    wrong: tube("wrong", 0xd09090, 0xb02020, 1.4),
  };
}

/**
 * Ceiling-hung fluorescent troffer. Origin on the floor below it; the tubes
 * are named "tube" so flicker code can swap in any `funTubeMaterials` entry.
 */
export function funFluorescent(kit: DecorKit, ceilingY = 3, state: keyof FunTubeMaterials = "on"): FunPiece {
  const g = new THREE.Group();
  const housing = std(kit, "fixture", { color: 0xd9d4c2, roughness: 0.6, metalness: 0.3 });
  const tubes = funTubeMaterials(kit);
  g.add(box(kit, 1.24, 0.06, 0.34, housing, 0, ceilingY - 0.03, 0));
  for (const dz of [-0.08, 0.08]) {
    const tb = cyl(kit, 0.022, 0.022, 1.16, tubes[state], 0, ceilingY - 0.08, dz, 8);
    tb.rotation.z = Math.PI / 2;
    tb.name = "tube";
    g.add(tb);
  }
  return { object: g, footprint: [], anchors: { light: { x: 0, y: ceilingY - 0.15, z: 0, yaw: 0 } } };
}

// ---------------------------------------------------------------------------
// Balloons
// ---------------------------------------------------------------------------

/** Teardrop balloon body, knot at y = 0, top at y ≈ 0.62. */
function balloonGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    pts.push(new THREE.Vector2(Math.max(0.004, 0.24 * Math.sin(Math.PI * Math.pow(s, 0.78))), s * 0.62));
  }
  return new THREE.LatheGeometry(pts, 16);
}

function stringLine(kit: DecorKit, length: number, sway: number): THREE.Line {
  const key = `string_${length.toFixed(2)}_${sway.toFixed(2)}`;
  const geo = kit.geo(`fun_${key}`, () => new THREE.BufferGeometry().setFromPoints(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(sway * 0.5, -length * 0.35, sway * 0.2),
      new THREE.Vector3(-sway * 0.3, -length * 0.7, -sway * 0.1),
      new THREE.Vector3(0, -length, 0),
    ]).getPoints(16),
  ));
  const mat = kit.mat("fun_string", () => new THREE.LineBasicMaterial({ color: 0xe8e4d8 }));
  return new THREE.Line(geo, mat);
}

/**
 * One helium balloon. Origin is where its string meets the floor/weight; the
 * floating part is the child named "balloon" (bob / drift it from there).
 * `deflated` lays a sagging, half-empty balloon on the floor instead.
 */
export function funBalloon(kit: DecorKit, color: PartyColor, opts: { height?: number; sway?: number; deflated?: boolean } = {}): FunPiece {
  const g = new THREE.Group();
  const mat = plastic(kit, color, 0.22);
  const body = new THREE.Group();
  body.name = "balloon";
  body.add(mesh(kit, "balloon", balloonGeo, mat));
  const knot = mesh(kit, "balloon_knot", () => new THREE.ConeGeometry(0.03, 0.05, 8), mat, 0, -0.02, 0);
  knot.rotation.x = Math.PI;
  body.add(knot);
  if (opts.deflated) {
    body.scale.set(1.15, 0.45, 0.9);
    body.rotation.set(Math.PI / 2 - 0.2, 0, 0.3);
    body.position.set(0, 0.1, 0);
    g.add(body);
    g.add(stringLine(kit, 0.4, 0.3).rotateZ(Math.PI / 2).translateY(0.02));
    return { object: g, footprint: [] };
  }
  const height = opts.height ?? 1.9;
  body.position.set(0, height, 0);
  body.add(stringLine(kit, height - 0.05, opts.sway ?? 0.08));
  g.add(body);
  g.add(cyl(kit, 0.05, 0.06, 0.06, std(kit, "weight", { color: 0x9a9aa2, roughness: 0.4, metalness: 0.6 }), 0, 0.03, 0, 10));
  return { object: g, footprint: [] };
}

/** A bunch of balloons tied to one weight, heights and colours from rng. */
export function funBalloonCluster(kit: DecorKit, rng: Rng, count = 5, colors: PartyColor[] = FESTIVE): FunPiece {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const b = funBalloon(kit, colors[rng.nextInt(0, colors.length)], { height: rng.nextRange(1.6, 2.4), sway: rng.nextRange(0.05, 0.25) });
    const body = b.object.getObjectByName("balloon");
    if (body) {
      const a = (i / count) * Math.PI * 2 + rng.nextRange(-0.3, 0.3);
      body.position.x += Math.cos(a) * 0.18;
      body.position.z += Math.sin(a) * 0.18;
      body.rotation.set(rng.nextRange(-0.15, 0.15), rng.nextRange(0, Math.PI), rng.nextRange(-0.15, 0.15));
    }
    g.add(b.object);
  }
  return { object: g, footprint: [[0, 0, 0.3]] };
}

/**
 * Puzzle 3's "special balloon": bigger, metallic gold foil with a painted
 * "=)" face and a faint glow so it reads as important. Node "balloon" floats.
 */
export function funSpecialBalloon(kit: DecorKit, height = 1.7): FunPiece {
  const g = new THREE.Group();
  const foil = std(kit, "special_foil", { color: 0xf3c440, roughness: 0.18, metalness: 0.75, emissive: 0x6a4a00, emissiveIntensity: 0.35 });
  const body = new THREE.Group();
  body.name = "balloon";
  const shell = mesh(kit, "balloon", balloonGeo, foil);
  shell.scale.setScalar(1.45);
  body.add(shell);
  const face = canvasMat(kit, "special_face", 128, 128, (ctx) => {
    const r = mulberry(5150);
    drawSymbol(ctx, r, "smile", 64, 64, 90, "#3a1a08", 7);
  }, { cutout: true });
  const decal = plane(kit, 0.34, 0.34, face, 0, 0.4, 0.35);
  decal.rotation.z = -Math.PI / 2; // "=)" reads as a sideways face
  body.add(decal);
  body.position.set(0, height, 0);
  body.add(stringLine(kit, height - 0.05, 0.1));
  g.add(body);
  g.add(cyl(kit, 0.06, 0.07, 0.07, std(kit, "weight", { color: 0x9a9aa2, roughness: 0.4, metalness: 0.6 }), 0, 0.035, 0, 10));
  g.name = "special_balloon";
  return { object: g, footprint: [] };
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** Small plastic kids' chair. `knocked` tips it onto its back. */
export function funKidChair(kit: DecorKit, color: PartyColor, knocked = false): FunPiece {
  const g = new THREE.Group();
  const seatMat = plastic(kit, color, 0.4);
  const leg = std(kit, "chair_leg", { color: 0xb8b8bc, roughness: 0.35, metalness: 0.7 });
  const chair = new THREE.Group();
  chair.add(box(kit, 0.36, 0.035, 0.34, seatMat, 0, 0.36, 0));
  chair.add(box(kit, 0.36, 0.3, 0.03, seatMat, 0, 0.56, -0.16));
  for (const sx of [-0.15, 0.15]) for (const sz of [-0.14, 0.14]) chair.add(cyl(kit, 0.012, 0.012, 0.36, leg, sx, 0.18, sz, 6));
  if (knocked) {
    chair.rotation.x = -Math.PI / 2;
    chair.position.set(0, 0.17, -0.2);
  }
  g.add(chair);
  return { object: g, footprint: [[0, knocked ? -0.35 : 0, 0.25]] };
}

/**
 * Folding party table with a tablecloth. Anchors: "center" on the top and
 * "place_i" settings spaced along both long edges (facing the diner).
 */
export function funPartyTable(kit: DecorKit, cloth: PartyColor, opts: { length?: number; depth?: number; places?: number; stage?: FunStage } = {}): FunPiece {
  const length = opts.length ?? 1.8, depth = opts.depth ?? 0.8, places = opts.places ?? 3, stage = opts.stage ?? 0;
  const top = 0.72;
  const g = new THREE.Group();
  const legMat = std(kit, "table_leg", { color: 0x8a8a8e, roughness: 0.4, metalness: 0.6 });
  const clothMat = kit.mat(`fun_cloth_${cloth}_${stage}`, () => {
    const base = new THREE.Color(PARTY_COLORS[cloth]).lerp(new THREE.Color(0x6a6250), stage * 0.25);
    const map = canvasTexture(kit, 128, 128, (ctx) => {
      const r = mulberry(hashKey(cloth) + stage);
      ctx.fillStyle = `#${base.getHexString()}`; ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      for (let i = 0; i < 128; i += 32) { ctx.fillRect(i, 0, 16, 128); ctx.fillRect(0, i, 128, 16); }
      for (let i = 0; i < stage * 4; i++) {
        ctx.fillStyle = `rgba(50,30,10,${0.15 + r() * 0.2})`;
        ctx.beginPath(); ctx.arc(r() * 128, r() * 128, 4 + r() * 12, 0, Math.PI * 2); ctx.fill();
      }
    }, true);
    map.repeat.set(2, 2);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  });
  g.add(box(kit, length + 0.1, 0.03, depth + 0.1, clothMat, 0, top, 0));
  // Cloth skirt hanging down every side.
  const drop = 0.28;
  g.add(box(kit, length + 0.1, drop, 0.01, clothMat, 0, top - drop / 2, depth / 2 + 0.05));
  g.add(box(kit, length + 0.1, drop, 0.01, clothMat, 0, top - drop / 2, -depth / 2 - 0.05));
  g.add(box(kit, 0.01, drop, depth + 0.1, clothMat, length / 2 + 0.05, top - drop / 2, 0));
  g.add(box(kit, 0.01, drop, depth + 0.1, clothMat, -length / 2 - 0.05, top - drop / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(kit, 0.02, 0.02, top, legMat, sx * (length / 2 - 0.08), top / 2, sz * (depth / 2 - 0.08), 6));

  const anchors: Record<string, FunAnchor> = { center: { x: 0, y: top + 0.015, z: 0, yaw: 0 } };
  let n = 0;
  for (const side of [1, -1]) {
    for (let i = 0; i < places; i++) {
      const x = (i - (places - 1) / 2) * (length / places);
      anchors[`place_${n}`] = { x, y: top + 0.015, z: side * (depth / 2 - 0.18), yaw: side > 0 ? 0 : Math.PI };
      anchors[`seat_${n}`] = { x, y: 0, z: side * (depth / 2 + 0.3), yaw: side > 0 ? Math.PI : 0 };
      n++;
    }
  }
  const footprint: [number, number, number][] = [];
  const circles = Math.max(1, Math.round(length / depth));
  for (let i = 0; i < circles; i++) footprint.push([(i - (circles - 1) / 2) * (length / circles), 0, depth / 2 + 0.1]);
  return { object: g, footprint, anchors };
}

/**
 * Puzzle 3's banquet: one very long table ringed by far too many kids'
 * chairs. Anchors "cake"/"gift"/"balloon" mark the three slots at the
 * middle of the top (each with a `funPlacementMarker` already painted on
 * the cloth), and "seat_i" every chair (for the crowd that fills them).
 */
export function funBanquet(kit: DecorKit, rng: Rng, opts: { length?: number; chairsPerSide?: number; stage?: FunStage } = {}): FunPiece {
  const length = opts.length ?? 7.2, per = opts.chairsPerSide ?? 12, stage = opts.stage ?? 2;
  const depth = 1.1;
  const table = funPartyTable(kit, "white", { length, depth, places: per, stage });
  const g = table.object;
  const anchors = table.anchors ?? {};
  const topY = anchors.center.y;
  for (const key of Object.keys(anchors)) if (key.startsWith("place_")) delete anchors[key];
  // Head chairs at both ends.
  anchors[`seat_${per * 2}`] = { x: length / 2 + 0.4, y: 0, z: 0, yaw: -Math.PI / 2 };
  anchors[`seat_${per * 2 + 1}`] = { x: -length / 2 - 0.4, y: 0, z: 0, yaw: Math.PI / 2 };
  for (const [key, a] of Object.entries(anchors)) {
    if (!key.startsWith("seat_")) continue;
    const chair = funKidChair(kit, FESTIVE[rng.nextInt(0, FESTIVE.length)], false).object;
    chair.position.set(a.x, 0, a.z);
    // Seat yaw is the sitter's facing (toward the table); a few chairs sit askew, as if just vacated.
    chair.rotation.y = a.yaw + rng.nextRange(-0.12, 0.12);
    g.add(chair);
    // Place settings in front of every seat, some knocked over.
    const pz = a.z - Math.sign(a.z || 0) * 0.55, px = a.z === 0 ? a.x - Math.sign(a.x) * 0.55 : a.x;
    const plate = funPlate(kit, "white").object;
    plate.position.set(px, topY, pz);
    g.add(plate);
    if (rng.next() < 0.7) {
      const cup = funCup(kit, FESTIVE[rng.nextInt(0, FESTIVE.length)], rng.next() < 0.2).object;
      cup.position.set(px + 0.16, topY, pz);
      g.add(cup);
    }
  }
  const slots: [string, PartyItem, number][] = [["cake", "cake", 0], ["gift", "gift", -1.1], ["balloon", "balloons", 1.1]];
  for (const [name, item, x] of slots) {
    anchors[name] = { x, y: topY, z: 0, yaw: 0 };
    const marker = funPlacementMarker(kit, item).object;
    marker.position.set(x, topY + 0.002, 0);
    marker.name = `marker_${name}`;
    g.add(marker);
  }
  const footprint = table.footprint.map(([x, z, r]): [number, number, number] => [x, z, r + 0.35]);
  return { object: g, footprint, anchors };
}

// ---------------------------------------------------------------------------
// Tableware and party objects (puzzle-1 pickups)
// ---------------------------------------------------------------------------

export function funPlate(kit: DecorKit, color: PartyColor): FunPiece {
  const g = new THREE.Group();
  const mat = plastic(kit, color, 0.5);
  g.add(cyl(kit, 0.12, 0.09, 0.015, mat, 0, 0.008, 0, 18));
  g.add(mesh(kit, "plate_rim", () => new THREE.TorusGeometry(0.115, 0.007, 4, 20).rotateX(Math.PI / 2), mat, 0, 0.016, 0));
  g.name = "plate";
  return { object: g, footprint: [] };
}

/** Paper cup. `tipped` lays it on its side (spilled). */
export function funCup(kit: DecorKit, color: PartyColor, tipped = false): FunPiece {
  const g = new THREE.Group();
  const c = mesh(kit, "cup", () => new THREE.CylinderGeometry(0.04, 0.03, 0.1, 12, 1, true), kit.mat(`fun_cup_${color}`, () =>
    new THREE.MeshStandardMaterial({ color: PARTY_COLORS[color], roughness: 0.7, side: THREE.DoubleSide })), 0, 0.05, 0);
  const bottom = cyl(kit, 0.03, 0.03, 0.004, plastic(kit, color, 0.7), 0, 0.002, 0, 12);
  const cup = new THREE.Group();
  cup.add(c, bottom);
  if (tipped) { cup.rotation.z = Math.PI / 2; cup.position.set(0.05, 0.035, 0); }
  g.add(cup);
  g.name = "cup";
  return { object: g, footprint: [] };
}

/** Striped cone party hat with a pompom. */
export function funPartyHat(kit: DecorKit, color: PartyColor): FunPiece {
  const g = new THREE.Group();
  const mat = kit.mat(`fun_hat_${color}`, () => {
    const map = canvasTexture(kit, 64, 64, (ctx) => {
      ctx.fillStyle = CSS(color); ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      for (let i = 0; i < 64; i += 16) { ctx.save(); ctx.translate(i, 0); ctx.transform(1, 0, 0.6, 1, 0, 0); ctx.fillRect(0, 0, 6, 64); ctx.restore(); }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.7 });
  });
  g.add(mesh(kit, "hat", () => new THREE.ConeGeometry(0.075, 0.2, 14, 1, true), mat, 0, 0.1, 0));
  g.add(sphere(kit, 0.025, plastic(kit, "white", 0.9), 0, 0.205, 0, 8));
  g.name = "party_hat";
  return { object: g, footprint: [] };
}

export function funCandle(kit: DecorKit, color: PartyColor, lit = true, height = 0.1): FunPiece {
  const g = new THREE.Group();
  g.add(cyl(kit, 0.008, 0.008, height, plastic(kit, color, 0.5), 0, height / 2, 0, 8));
  if (lit) {
    const flame = mesh(kit, "flame", () => new THREE.SphereGeometry(0.012, 8, 6).scale(1, 2, 1),
      std(kit, "flame", { color: 0xffd27a, emissive: 0xffa630, emissiveIntensity: 3 }), 0, height + 0.02, 0);
    flame.name = "flame";
    g.add(flame);
  }
  g.name = "candle";
  return { object: g, footprint: [] };
}

/** A holder with a row of spare candles — the "candles" pickup of puzzle 1. */
export function funCandleBox(kit: DecorKit, colors: PartyColor[] = ["blue", "pink", "yellow", "green"]): FunPiece {
  const g = new THREE.Group();
  g.add(box(kit, 0.2, 0.03, 0.08, plastic(kit, "white", 0.6), 0, 0.015, 0));
  colors.forEach((c, i) => {
    const cd = funCandle(kit, c, false, 0.09).object;
    cd.rotation.z = Math.PI / 2;
    cd.position.set(-0.05, 0.04, (i - (colors.length - 1) / 2) * 0.018);
    g.add(cd);
  });
  g.name = "candle_box";
  return { object: g, footprint: [] };
}

/** Wrapped present; the lid group is named "lid" so it can be lifted open. */
export function funGift(kit: DecorKit, wrap: PartyColor, ribbon: PartyColor, size = 0.35): FunPiece {
  const g = new THREE.Group();
  const s = +size.toFixed(2);
  const paper = kit.mat(`fun_wrap_${wrap}`, () => {
    const map = canvasTexture(kit, 64, 64, (ctx) => {
      ctx.fillStyle = CSS(wrap); ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let y = 8; y < 64; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < 64; x += 16) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.6 });
  });
  const rib = plastic(kit, ribbon, 0.3);
  const bh = s * 0.8;
  g.add(box(kit, s, bh, s, paper, 0, bh / 2, 0));
  g.add(box(kit, s + 0.004, bh, 0.04, rib, 0, bh / 2, 0));
  g.add(box(kit, 0.04, bh, s + 0.004, rib, 0, bh / 2, 0));
  const lid = new THREE.Group();
  lid.name = "lid";
  lid.position.set(0, bh, 0);
  lid.add(box(kit, s + 0.02, 0.06, s + 0.02, paper, 0, 0.02, 0));
  lid.add(box(kit, s + 0.024, 0.061, 0.04, rib, 0, 0.02, 0));
  lid.add(box(kit, 0.04, 0.061, s + 0.024, rib, 0, 0.02, 0));
  for (const a of [0.6, -0.6]) {
    const loop = mesh(kit, `bow_${s}`, () => new THREE.TorusGeometry(s * 0.14, 0.012, 6, 14), rib, a * s * 0.12, 0.05 + s * 0.1, 0);
    loop.rotation.set(0, Math.PI / 2, a);
    lid.add(loop);
  }
  g.add(lid);
  g.name = "gift";
  return { object: g, footprint: [[0, 0, s * 0.75]] };
}

/**
 * Two-tier birthday cake. Candles carry "flame" nodes. `rotten` greys the
 * icing, sinks the top tier and melts the candles (the late-stage version).
 */
export function funCake(kit: DecorKit, opts: { candles?: number; lit?: boolean; rotten?: boolean } = {}): FunPiece {
  const { candles = 6, lit = true, rotten = false } = opts;
  const g = new THREE.Group();
  const sponge = std(kit, rotten ? "cake_sponge_rot" : "cake_sponge", { color: rotten ? 0x5a4a30 : 0xc98b4a, roughness: 0.9 });
  const icing = std(kit, rotten ? "cake_icing_rot" : "cake_icing", rotten
    ? { color: 0xa9ad8c, roughness: 0.7 }
    : { color: 0xfbd7e8, roughness: 0.45, emissive: 0xf07ab8, emissiveIntensity: 0.05 });
  const plate = std(kit, "cake_board", { color: 0xe8e8ee, roughness: 0.3, metalness: 0.4 });
  g.add(cyl(kit, 0.24, 0.24, 0.015, plate, 0, 0.008, 0, 24));
  g.add(cyl(kit, 0.2, 0.2, 0.12, icing, 0, 0.075, 0, 24));
  const topTier = cyl(kit, 0.13, 0.13, 0.1, icing, 0, 0.185, 0, 22);
  if (rotten) { topTier.rotation.z = 0.12; topTier.position.y = 0.17; topTier.scale.set(1, 0.8, 1); }
  g.add(topTier);
  // Frosting rims and drips.
  g.add(mesh(kit, "cake_rim_lo", () => new THREE.TorusGeometry(0.2, 0.012, 6, 28).rotateX(Math.PI / 2), icing, 0, 0.135, 0));
  g.add(mesh(kit, "cake_rim_hi", () => new THREE.TorusGeometry(0.13, 0.01, 6, 24).rotateX(Math.PI / 2), icing, 0, 0.235, 0));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const drip = cyl(kit, 0.012, 0.008, 0.04 + (i % 3) * 0.015, icing, Math.cos(a) * 0.201, 0.12 - (i % 3) * 0.008, Math.sin(a) * 0.201, 6);
    g.add(drip);
  }
  // Sponge peeking at the base.
  g.add(cyl(kit, 0.201, 0.201, 0.02, sponge, 0, 0.025, 0, 24));
  const candleColors: PartyColor[] = ["blue", "pink", "yellow", "green", "purple", "red"];
  for (let i = 0; i < candles; i++) {
    const a = (i / candles) * Math.PI * 2;
    const c = funCandle(kit, candleColors[i % candleColors.length], lit && !rotten, rotten ? 0.05 : 0.09).object;
    c.position.set(Math.cos(a) * 0.08, rotten ? 0.215 : 0.235, Math.sin(a) * 0.08);
    if (rotten) c.rotation.set((i % 2 ? 0.4 : -0.3), 0, (i % 3) * 0.2);
    g.add(c);
  }
  g.name = "cake";
  return { object: g, footprint: [] };
}

/** Pastel cardboard box — the "decorations" pickup (paper garlands spilling out). */
export function funDecorationBox(kit: DecorKit): FunPiece {
  const g = new THREE.Group();
  const card = std(kit, "cardboard", { color: 0xc4a47a, roughness: 0.95 });
  g.add(box(kit, 0.4, 0.22, 0.3, card, 0, 0.11, 0));
  const flap = box(kit, 0.4, 0.01, 0.14, card, 0, 0.26, -0.2);
  flap.rotation.x = -0.8;
  g.add(flap);
  const spill = funGarland(kit, 0.6, 0.05, FESTIVE, 7).object;
  spill.position.set(0, 0.2, 0.05);
  spill.rotation.set(-0.9, 0.3, 0);
  spill.scale.setScalar(0.6);
  g.add(spill);
  g.name = "decoration_box";
  return { object: g, footprint: [[0, 0, 0.28]] };
}

// ---------------------------------------------------------------------------
// Hanging decorations
// ---------------------------------------------------------------------------

/** PlaneGeometry sagging like a string hung between two points. */
function saggingPlane(w: number, h: number, sag: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 24, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (w / 2);
    pos.setY(i, pos.getY(i) - sag * (1 - u * u));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Pennant bunting hung across a span (hanging from y = 0 at both ends). */
export function funGarland(kit: DecorKit, span: number, sag = 0.25, colors: PartyColor[] = FESTIVE, flags = 0): FunPiece {
  const count = flags || Math.max(4, Math.round(span / 0.28));
  const key = `garland_${colors.join("-")}_${count}`;
  const mat = canvasMat(kit, key, 64 * count, 96, (ctx) => {
    ctx.strokeStyle = "#e8e4d8"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(64 * count, 4); ctx.stroke();
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = CSS(colors[i % colors.length]);
      ctx.beginPath(); ctx.moveTo(i * 64 + 4, 5); ctx.lineTo(i * 64 + 60, 5); ctx.lineTo(i * 64 + 32, 92); ctx.fill();
    }
  }, { cutout: true });
  const g = new THREE.Group();
  const m = mesh(kit, `sag_${span.toFixed(2)}_${sag.toFixed(2)}`, () => saggingPlane(span, 0.3, sag), mat, 0, -0.15, 0);
  g.add(m);
  return { object: g, footprint: [] };
}

/**
 * "FELIZ ANIVERSÁRIO" letter-per-pennant banner (text from i18n unless
 * given). Baked at build time, like the other in-world signs.
 */
export function funBirthdayBanner(kit: DecorKit, span = 3.4, text = t("fun.banner")): FunPiece {
  const letters = [...text];
  const w = 72 * letters.length;
  const mat = canvasMat(kit, `banner_${text}`, w, 128, (ctx) => {
    const r = mulberry(hashKey(text));
    ctx.strokeStyle = "#e8e4d8"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(w, 5); ctx.stroke();
    letters.forEach((ch, i) => {
      if (ch === " ") return;
      const x = i * 72;
      ctx.fillStyle = CSS(FESTIVE[i % FESTIVE.length]);
      ctx.beginPath(); ctx.moveTo(x + 4, 6); ctx.lineTo(x + 68, 6); ctx.lineTo(x + 68, 96); ctx.lineTo(x + 36, 122); ctx.lineTo(x + 4, 96); ctx.fill();
      ctx.font = `bold 52px ${KID_FONT}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.save(); ctx.translate(x + 36, 54); ctx.rotate((r() - 0.5) * 0.15); ctx.fillText(ch, 0, 0); ctx.restore();
    });
  }, { cutout: true });
  const g = new THREE.Group();
  const h = (span / letters.length) * (128 / 72);
  g.add(mesh(kit, `sag_${span.toFixed(2)}_${h.toFixed(3)}_banner`, () => saggingPlane(span, h, 0.18), mat, 0, -h / 2, 0));
  return { object: g, footprint: [] };
}

/** Twisted crepe-paper streamer hanging from the ceiling (origin at the ceiling). */
export function funStreamer(kit: DecorKit, color: PartyColor, length = 1.2): FunPiece {
  const len = +length.toFixed(2);
  const geo = kit.geo(`fun_streamer_${len}`, () => {
    const gg = new THREE.PlaneGeometry(0.06, len, 1, 16);
    const pos = gg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = pos.getX(i);
      const a = ((y + len / 2) / len) * Math.PI * 3;
      pos.setXYZ(i, x * Math.cos(a), y - len / 2, x * Math.sin(a));
    }
    gg.computeVertexNormals();
    return gg;
  });
  const mat = kit.mat(`fun_streamer_${color}`, () => new THREE.MeshStandardMaterial({ color: PARTY_COLORS[color], roughness: 0.8, side: THREE.DoubleSide }));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  return { object: g, footprint: [] };
}

// ---------------------------------------------------------------------------
// Paper on the walls: drawings, posters, notes, painted symbols, messages
// ---------------------------------------------------------------------------

export type DrawingSpec =
  /** Puzzle 1 clue: numbered steps with arrows, e.g. tablecloth → plates → cake. */
  | { kind: "sequence"; steps: PartyItem[]; /** Number shown on the first step (default 1). */ start?: number }
  /** Puzzle 2 clue: a scene built around one symbol, drawn `count` times in `color`. */
  | { kind: "symbol"; symbol: PartySymbol; color: PartyColor; count: number }
  /** Stick-figure family at a party; `wrong` adds a tall, smiling extra figure with too many friends. */
  | { kind: "family"; figures: number; wrong?: boolean }
  /** Plain filler: house, sun, a balloon. */
  | { kind: "house" }
  /** A yellow figure with an enormous smile. */
  | { kind: "partygoer" };

function paper(ctx: CanvasRenderingContext2D, r: () => number, w: number, h: number) {
  ctx.fillStyle = "#f6f1e2"; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) { ctx.fillStyle = "rgba(120,100,60,0.06)"; ctx.fillRect(r() * w, r() * h, 2, 2); }
  // Tape at the top corners.
  ctx.fillStyle = "rgba(235,225,180,0.85)";
  ctx.save(); ctx.translate(18, 10); ctx.rotate(-0.4); ctx.fillRect(-18, -7, 36, 14); ctx.restore();
  ctx.save(); ctx.translate(w - 18, 10); ctx.rotate(0.4); ctx.fillRect(-18, -7, 36, 14); ctx.restore();
}

function stickFigure(ctx: CanvasRenderingContext2D, r: () => number, x: number, y: number, s: number, color: string, smile = false) {
  crayonCircle(ctx, r, x, y - s * 0.8, s * 0.18, s * 0.18, color, 3);
  crayon(ctx, r, [[x, y - s * 0.62], [x, y - s * 0.15]], color, 3);
  crayon(ctx, r, [[x - s * 0.25, y - s * 0.45], [x + s * 0.25, y - s * 0.45]], color, 3);
  crayon(ctx, r, [[x - s * 0.2, y + s * 0.1], [x, y - s * 0.15], [x + s * 0.2, y + s * 0.1]], color, 3);
  if (smile) crayon(ctx, r, [[x - s * 0.12, y - s * 0.78], [x, y - s * 0.7], [x + s * 0.12, y - s * 0.78]], "#111", 2);
}

/** Crayon drawing taped to the wall (0.5 × 0.38 m, in the plane z = 0 facing +Z). */
export function funDrawing(kit: DecorKit, spec: DrawingSpec, seed = 0): FunPiece {
  const key = `drawing_${JSON.stringify(spec)}_${seed}`;
  const mat = canvasMat(kit, key, 320, 240, (ctx) => {
    const r = mulberry(hashKey(key));
    paper(ctx, r, 320, 240);
    switch (spec.kind) {
      case "sequence": {
        const n = spec.steps.length;
        const cols = Math.min(n, 4), rows = Math.ceil(n / 4);
        const cw = 300 / cols, rh = 200 / rows;
        spec.steps.forEach((item, i) => {
          const cx = 10 + cw * ((i % 4) + 0.5), cy = 30 + rh * (Math.floor(i / 4) + 0.5);
          drawPartyIcon(ctx, r, item, cx, cy + 6, Math.min(cw, rh) * 0.6);
          crayonText(ctx, r, String(i + (spec.start ?? 1)), cx - cw * 0.34, cy - rh * 0.3, 22, "#222");
          if (i < n - 1 && (i % 4) < 3) crayon(ctx, r, [[cx + cw * 0.34, cy], [cx + cw * 0.5, cy], [cx + cw * 0.44, cy - 5], [cx + cw * 0.5, cy], [cx + cw * 0.44, cy + 5]], "#222", 2);
        });
        break;
      }
      case "symbol": {
        const col = CSS(spec.color);
        crayon(ctx, r, [[0, 205], [320, 200]], "#3fb85a", 6); // grass
        for (let i = 0; i < spec.count; i++) {
          const cx = 50 + ((i + 0.5) * 220) / spec.count + (r() - 0.5) * 12;
          const cy = 90 + (r() - 0.5) * 40;
          drawSymbol(ctx, r, spec.symbol, cx, cy, 44, col, 4);
          crayon(ctx, r, [[cx, cy + 24], [cx + (r() - 0.5) * 20, 200]], "#555", 1.5);
        }
        break;
      }
      case "family": {
        const cols = ["#e23b3b", "#3b72e2", "#3fb85a", "#8e52d6", "#f08a2a"];
        crayon(ctx, r, [[20, 210], [300, 205]], "#3fb85a", 6);
        crayon(ctx, r, [[40, 140], [280, 140]], "#b06a3a", 5); // table
        for (let i = 0; i < spec.figures; i++) {
          stickFigure(ctx, r, 50 + (i * 220) / Math.max(1, spec.figures - 1), 200, 90, cols[i % cols.length], true);
        }
        if (spec.wrong) {
          // One more guest nobody drew on purpose: tall, yellow, grinning.
          const x = 290;
          crayon(ctx, r, [[x, 200], [x, 60]], "#d9b21a", 5);
          crayonCircle(ctx, r, x, 42, 20, 22, "#d9b21a", 4);
          crayon(ctx, r, [[x - 14, 46], [x - 4, 54], [x + 6, 54], [x + 16, 44]], "#111", 3);
          crayon(ctx, r, [[x, 100], [x - 50, 130]], "#d9b21a", 4);
        }
        break;
      }
      case "house":
        crayon(ctx, r, [[80, 200], [80, 120], [160, 70], [240, 120], [240, 200]], "#e23b3b", 4, true);
        crayon(ctx, r, [[140, 200], [140, 150], [180, 150], [180, 200]], "#b06a3a", 4);
        crayonCircle(ctx, r, 270, 45, 24, 24, "#f2cc2e", 5);
        crayonCircle(ctx, r, 50, 80, 16, 20, "#f07ab8", 4);
        crayon(ctx, r, [[50, 100], [60, 200]], "#555", 1.5);
        break;
      case "partygoer": {
        crayonFill(ctx, r, 120, 90, 80, 110, "#e6c21c");
        crayonCircle(ctx, r, 160, 60, 42, 42, "#e6c21c", 6);
        crayonFill(ctx, r, 124, 26, 72, 68, "#e6c21c");
        crayon(ctx, r, [[128, 66], [140, 84], [160, 90], [180, 84], [192, 66]], "#111", 5);
        crayonCircle(ctx, r, 146, 48, 5, 6, "#111", 4);
        crayonCircle(ctx, r, 174, 48, 5, 6, "#111", 4);
        crayon(ctx, r, [[120, 110], [60, 170]], "#e6c21c", 5);
        crayon(ctx, r, [[200, 110], [260, 170]], "#e6c21c", 5);
        break;
      }
    }
  });
  const g = new THREE.Group();
  const p = plane(kit, 0.5, 0.375, mat, 0, 0, 0.004);
  p.rotation.z = ((seed % 7) - 3) * 0.02;
  g.add(p);
  return { object: g, footprint: [] };
}

/** Bright venue poster with a title and short lines (e.g. party rules). 0.6 × 0.84 m. */
export function funPoster(kit: DecorKit, title: string, lines: string[], accent: PartyColor = "pink"): FunPiece {
  const key = `poster_${title}_${lines.join("|")}_${accent}`;
  const mat = canvasMat(kit, key, 360, 504, (ctx) => {
    const r = mulberry(hashKey(key));
    ctx.fillStyle = "#fff8e8"; ctx.fillRect(0, 0, 360, 504);
    ctx.fillStyle = CSS(accent); ctx.fillRect(0, 0, 360, 90);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = CSS(FESTIVE[i % FESTIVE.length]); ctx.fillRect(r() * 360, 96 + r() * 400, 6, 3); }
    ctx.fillStyle = "#ffffff"; ctx.font = `bold 34px ${KID_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(title, 180, 46, 330);
    ctx.fillStyle = "#2a2230"; ctx.font = `24px ${KID_FONT}`; ctx.textAlign = "left";
    lines.forEach((line, i) => ctx.fillText(line, 28, 140 + i * 44, 310));
    ctx.strokeStyle = CSS(accent); ctx.lineWidth = 8; ctx.strokeRect(4, 4, 352, 496);
  });
  const g = new THREE.Group();
  g.add(plane(kit, 0.6, 0.84, mat, 0, 0, 0.004));
  return { object: g, footprint: [] };
}

/** Small torn note (handwritten lines). 0.2 × 0.26 m. */
export function funNote(kit: DecorKit, lines: string[], seed = 0): FunPiece {
  const key = `note_${lines.join("|")}_${seed}`;
  const mat = canvasMat(kit, key, 200, 260, (ctx) => {
    const r = mulberry(hashKey(key));
    ctx.fillStyle = "#fbf6e4";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(200, 0); ctx.lineTo(200, 240);
    for (let x = 200; x >= 0; x -= 10) ctx.lineTo(x, 240 + r() * 20);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(90,130,200,0.45)"; ctx.lineWidth = 1;
    for (let y = 40; y < 240; y += 22) { ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(190, y); ctx.stroke(); }
    ctx.fillStyle = "#2a2a55"; ctx.font = `18px ${KID_FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    lines.forEach((line, i) => ctx.fillText(line, 14, 36 + i * 22, 176));
  }, { cutout: true });
  const g = new THREE.Group();
  const p = plane(kit, 0.2, 0.26, mat, 0, 0, 0.004);
  p.rotation.z = ((seed % 5) - 2) * 0.04;
  g.add(p);
  return { object: g, footprint: [] };
}

/** A symbol or digit painted straight onto the wall, with a few drips. */
export function funWallSymbol(kit: DecorKit, symbol: PartySymbol, color: PartyColor, size = 0.5): FunPiece {
  const key = `wsym_${symbol}_${color}`;
  const mat = canvasMat(kit, key, 256, 256, (ctx) => {
    const r = mulberry(hashKey(key));
    drawSymbol(ctx, r, symbol, 128, 118, 170, CSS(color), 14);
    ctx.fillStyle = CSS(color);
    for (let i = 0; i < 4; i++) {
      const x = 60 + r() * 136, y = 150 + r() * 40, len = 20 + r() * 50;
      ctx.fillRect(x, y, 4, len);
      ctx.beginPath(); ctx.arc(x + 2, y + len, 4, 0, Math.PI * 2); ctx.fill();
    }
  }, { cutout: true });
  const g = new THREE.Group();
  g.add(plane(kit, size, size, mat, 0, 0, 0.003));
  return { object: g, footprint: [] };
}

/** Big uneven painted message across a wall (text from i18n unless given). */
export function funWallMessage(kit: DecorKit, width = 3.2, text = t("fun.wallMessage"), color = "#8a1414"): FunPiece {
  const key = `wmsg_${text}_${color}`;
  const mat = canvasMat(kit, key, 1024, 160, (ctx) => {
    const r = mulberry(hashKey(key));
    const size = Math.min(84, Math.floor(1800 / Math.max(1, text.length)));
    crayonText(ctx, r, text, 512, 70, size, color);
    ctx.fillStyle = color;
    for (let i = 0; i < 14; i++) {
      const x = 40 + r() * 944, y = 90 + r() * 10, len = 10 + r() * 55;
      ctx.globalAlpha = 0.8; ctx.fillRect(x, y, 3, len);
    }
    ctx.globalAlpha = 1;
  }, { cutout: true });
  const g = new THREE.Group();
  g.add(plane(kit, width, width * (160 / 1024), mat, 0, 0, 0.003));
  return { object: g, footprint: [] };
}

/**
 * Outline painted on a table top where an item belongs (puzzle 1/3 slots):
 * dashed ring with the item's crayon icon inside. Lies flat, facing up.
 */
export function funPlacementMarker(kit: DecorKit, item: PartyItem, size = 0.34): FunPiece {
  const mat = canvasMat(kit, `marker_${item}`, 128, 128, (ctx) => {
    const r = mulberry(hashKey(item));
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = "rgba(40,30,30,0.7)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.75;
    drawPartyIcon(ctx, r, item, 64, 64, 70);
    ctx.globalAlpha = 1;
  }, { cutout: true });
  const g = new THREE.Group();
  const p = plane(kit, size, size, mat, 0, 0.001, 0);
  p.rotation.x = -Math.PI / 2;
  g.add(p);
  g.name = "marker";
  return { object: g, footprint: [] };
}

// ---------------------------------------------------------------------------
// Doors, windows, the sequence panel
// ---------------------------------------------------------------------------

export type FunDoorVariant = "normal" | "blocked" | "exit";

/**
 * Party-room door in the wall plane z = 0, facing +Z, 1.1 × 2.2 m opening.
 * The leaf swings on the pivot named "leaf" (hinge at -x; rotate about y).
 * "blocked" adds crossed party tape ("barrier") and a padlock ("lock");
 * "exit" adds a lit sign above ("exit_sign").
 */
export function funDoor(kit: DecorKit, color: PartyColor, variant: FunDoorVariant = "normal"): FunPiece {
  const g = new THREE.Group();
  const W = 1.1, H = 2.2;
  const frame = std(kit, "door_frame", { color: 0xf2efe6, roughness: 0.6 });
  g.add(box(kit, 0.1, H + 0.1, 0.18, frame, -W / 2 - 0.05, (H + 0.1) / 2, 0));
  g.add(box(kit, 0.1, H + 0.1, 0.18, frame, W / 2 + 0.05, (H + 0.1) / 2, 0));
  g.add(box(kit, W + 0.2, 0.1, 0.18, frame, 0, H + 0.05, 0));

  const leafMat = kit.mat(`fun_door_${color}`, () => {
    const map = canvasTexture(kit, 128, 256, (ctx) => {
      const r = mulberry(hashKey(color) + 3);
      ctx.fillStyle = CSS(color); ctx.fillRect(0, 0, 128, 256);
      ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 4;
      ctx.strokeRect(14, 14, 100, 100); ctx.strokeRect(14, 134, 100, 108);
      // Kid stickers: stars and balloons.
      for (let i = 0; i < 5; i++) drawSymbol(ctx, r, i % 2 ? "star" : "heart", 20 + r() * 88, 20 + r() * 216, 16, "#ffffff", 3);
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.55 });
  });
  const leaf = new THREE.Group();
  leaf.name = "leaf";
  leaf.position.set(-W / 2, 0, 0);
  leaf.add(box(kit, W, H, 0.05, leafMat, W / 2, H / 2, 0));
  const knobMat = std(kit, "knob", { color: 0xd8c070, roughness: 0.25, metalness: 0.85 });
  leaf.add(sphere(kit, 0.035, knobMat, W - 0.1, 1.0, 0.05, 10));
  leaf.add(sphere(kit, 0.035, knobMat, W - 0.1, 1.0, -0.05, 10));
  g.add(leaf);

  if (variant === "blocked") {
    const tape = kit.mat("fun_party_tape", () => {
      const map = canvasTexture(kit, 256, 32, (ctx) => {
        for (let x = 0; x < 256; x += 32) { ctx.fillStyle = x % 64 ? "#f07ab8" : "#f2cc2e"; ctx.fillRect(x, 0, 32, 32); }
        ctx.fillStyle = "#ffffff"; ctx.font = `bold 20px ${KID_FONT}`; ctx.textBaseline = "middle";
        for (let x = 6; x < 256; x += 64) ctx.fillText("=)", x, 16);
      });
      map.wrapS = THREE.RepeatWrapping;
      return new THREE.MeshStandardMaterial({ map, roughness: 0.6 });
    });
    const barrier = new THREE.Group();
    barrier.name = "barrier";
    const diag = Math.hypot(W + 0.1, H * 0.7);
    for (const s of [1, -1]) {
      const strip = box(kit, diag, 0.1, 0.01, tape, 0, H * 0.5, 0.1);
      strip.rotation.z = s * Math.atan2(H * 0.7, W + 0.1);
      barrier.add(strip);
    }
    g.add(barrier);
    const lock = new THREE.Group();
    lock.name = "lock";
    const steel = std(kit, "lock_steel", { color: 0xa8a8b0, roughness: 0.3, metalness: 0.9 });
    lock.add(box(kit, 0.12, 0.1, 0.05, std(kit, "lock_body", { color: 0xd4a52a, roughness: 0.3, metalness: 0.8 }), 0, 0, 0));
    lock.add(mesh(kit, "lock_shackle", () => new THREE.TorusGeometry(0.04, 0.01, 6, 12, Math.PI), steel, 0, 0.05, 0));
    lock.position.set(W / 2 - 0.1, 0.95, 0.11);
    g.add(lock);
  }
  if (variant === "exit") {
    const sign = canvasMat(kit, `exit_${t("fun.exitSign")}`, 256, 64, (ctx) => {
      ctx.fillStyle = "#1a4a22"; ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = "#8dff9e"; ctx.font = `bold 34px ${KID_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(t("fun.exitSign"), 128, 34, 240);
    }, { unlit: true });
    const s = plane(kit, 0.6, 0.15, sign, 0, H + 0.28, 0.1);
    s.name = "exit_sign";
    g.add(s);
  }
  return { object: g, footprint: [], anchors: { handle: { x: W / 2 - 0.1, y: 1.0, z: 0.1, yaw: 0 } } };
}

/**
 * Interior window between party rooms (for figures glimpsed through glass).
 * Wall plane z = 0, sill at 0.9 m; glass named "glass", half-drawn blinds.
 */
export function funWindow(kit: DecorKit, width = 1.4, height = 1.0): FunPiece {
  const g = new THREE.Group();
  const frame = std(kit, "door_frame", { color: 0xf2efe6, roughness: 0.6 });
  const y0 = 0.9, cy = y0 + height / 2;
  g.add(box(kit, width + 0.12, 0.08, 0.2, frame, 0, y0 - 0.04, 0));
  g.add(box(kit, width + 0.12, 0.06, 0.16, frame, 0, y0 + height + 0.03, 0));
  g.add(box(kit, 0.06, height, 0.16, frame, -width / 2 - 0.03, cy, 0));
  g.add(box(kit, 0.06, height, 0.16, frame, width / 2 + 0.03, cy, 0));
  const glassMat = kit.mat("fun_glass", () => new THREE.MeshStandardMaterial({
    color: 0x2a3036, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false,
  }));
  const glass = plane(kit, width, height, glassMat, 0, cy, 0);
  glass.name = "glass";
  g.add(glass);
  const slat = std(kit, "blind", { color: 0xe8e2cc, roughness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const b = box(kit, width, 0.035, 0.005, slat, 0, y0 + height - 0.04 - i * 0.07, 0.05);
    b.rotation.x = 0.5;
    g.add(b);
  }
  return { object: g, footprint: [] };
}

export interface FunLampMaterials {
  off: THREE.MeshStandardMaterial;
  on: THREE.MeshStandardMaterial;
  wrong: THREE.MeshStandardMaterial;
}

export function funLampMaterials(kit: DecorKit): FunLampMaterials {
  return {
    off: std(kit, "lamp_off", { color: 0x3a3a3a, roughness: 0.4 }),
    on: std(kit, "lamp_on", { color: 0xfff2b0, emissive: 0xffd84a, emissiveIntensity: 2.4 }),
    wrong: std(kit, "lamp_wrong", { color: 0xff6060, emissive: 0xff1a1a, emissiveIntensity: 2.4 }),
  };
}

/**
 * Puzzle 2's lock beside the central door: four big colour buttons, each
 * with its own symbol ("button_<color>"), and a row of `slots` indicator
 * lamps ("lamp_0" …) above. Wall plane z = 0; panel centre at 1.35 m.
 */
export function funSequencePanel(kit: DecorKit, buttons: { color: PartyColor; symbol: PartySymbol }[], slots = 4): FunPiece {
  const g = new THREE.Group();
  const cy = 1.35;
  const board = canvasMat(kit, "seq_board", 256, 320, (ctx) => {
    const r = mulberry(8088);
    ctx.fillStyle = "#f6e9c8"; ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = "#e23b3b"; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 246, 310);
    for (let i = 0; i < 24; i++) { ctx.fillStyle = CSS(FESTIVE[i % FESTIVE.length]); ctx.beginPath(); ctx.arc(r() * 256, r() * 320, 3, 0, Math.PI * 2); ctx.fill(); }
  });
  g.add(box(kit, 0.52, 0.66, 0.05, board, 0, cy, 0.025));
  const lamps = funLampMaterials(kit);
  for (let i = 0; i < slots; i++) {
    const lamp = cyl(kit, 0.03, 0.03, 0.02, lamps.off, (i - (slots - 1) / 2) * 0.1, cy + 0.24, 0.06, 12);
    lamp.rotation.x = Math.PI / 2;
    lamp.name = `lamp_${i}`;
    g.add(lamp);
  }
  const anchors: Record<string, FunAnchor> = {};
  buttons.forEach((b, i) => {
    const bx = (i % 2 ? 0.11 : -0.11), by = cy + 0.06 - Math.floor(i / 2) * 0.22;
    const btn = new THREE.Group();
    btn.name = `button_${b.color}`;
    btn.position.set(bx, by, 0.05);
    const cap = cyl(kit, 0.075, 0.08, 0.04, plastic(kit, b.color, 0.3), 0, 0, 0.02, 20);
    cap.rotation.x = Math.PI / 2;
    btn.add(cap);
    const icon = canvasMat(kit, `seq_icon_${b.symbol}`, 96, 96, (ctx) => drawSymbol(ctx, mulberry(hashKey(b.symbol)), b.symbol, 48, 48, 60, "#ffffff", 7), { cutout: true });
    btn.add(plane(kit, 0.1, 0.1, icon, 0, 0, 0.042));
    g.add(btn);
    anchors[`button_${b.color}`] = { x: bx, y: by, z: 0.1, yaw: 0 };
  });
  return { object: g, footprint: [], anchors };
}

// ---------------------------------------------------------------------------
// Partygoers
// ---------------------------------------------------------------------------

export type PartygoerPose = "stand" | "sit" | "peek";

/**
 * A Partygoer: tall, smooth, balloon-yellow body, thin over-long limbs and
 * a head that's mostly smile. Static model (no AI, no rig) — it is meant to
 * be shown, hidden and moved by scripted events. `silhouette` renders it as
 * a flat black shape whose smile alone stays pale, for distant glimpses and
 * the blackout crowd. Faces +Z; "sit" expects a kids' chair seat at 0.36 m;
 * "peek" leans sideways out from behind a door edge at x = 0.
 * Named parts: "head", "armL", "armR".
 */
export function funPartygoer(kit: DecorKit, opts: { pose?: PartygoerPose; silhouette?: boolean; scale?: number } = {}): FunPiece {
  const pose = opts.pose ?? "stand", sil = opts.silhouette ?? false;
  const g = new THREE.Group();
  const body = sil
    ? kit.mat("fun_pg_sil", () => new THREE.MeshBasicMaterial({ color: 0x050505 }))
    : std(kit, "pg_skin", { color: 0xe9c326, roughness: 0.3, metalness: 0.05, emissive: 0x5a4200, emissiveIntensity: 0.18 });
  const face = canvasMat(kit, sil ? "pg_face_sil" : "pg_face", 256, 256, (ctx) => {
    const r = mulberry(sil ? 61 : 60);
    if (!sil) {
      ctx.fillStyle = "#0a0806";
      ctx.beginPath(); ctx.ellipse(88, 90, 16, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(168, 90, 16, 22, 0, 0, Math.PI * 2); ctx.fill();
    }
    // The grin: far too wide, lined with teeth.
    ctx.fillStyle = sil ? "#d8d2c0" : "#1a0a08";
    ctx.beginPath(); ctx.moveTo(28, 128); ctx.quadraticCurveTo(128, 250, 228, 128); ctx.quadraticCurveTo(128, 180, 28, 128); ctx.fill();
    if (!sil) {
      ctx.fillStyle = "#f4f0e2";
      for (let i = 0; i < 14; i++) {
        const u = (i + 0.5) / 14, x = 28 + u * 200;
        const top = 128 + Math.sin(u * Math.PI) * 26, bot = 128 + Math.sin(u * Math.PI) * 58;
        ctx.fillRect(x - 5, top, 9, (bot - top) * (0.45 + r() * 0.2));
      }
    }
  }, { cutout: true, unlit: sil });

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const sit = pose === "sit";
  const hipY = sit ? 0.42 : 1.05;
  // Torso: a slim, smooth capsule.
  const torso = mesh(kit, "pg_torso", () => new THREE.CapsuleGeometry(0.17, 0.5, 6, 14), body, 0, hipY + 0.38, 0);
  torso.scale.set(1, 1, 0.75);
  g.add(torso);
  const neckY = hipY + 0.72;
  g.add(rod(kit, 0.04, body, V(0, neckY, 0), V(0, neckY + 0.14, 0)));
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, neckY + 0.3, 0);
  const skull = sphere(kit, 0.2, body, 0, 0, 0, 18);
  skull.scale.set(1, 1.12, 0.95);
  head.add(skull);
  const f = plane(kit, 0.34, 0.34, face, 0, -0.02, 0.19);
  head.add(f);
  if (pose === "peek") head.rotation.z = -0.5;
  g.add(head);

  // Arms: long, hanging past the knees.
  for (const [side, name] of [[-1, "armL"], [1, "armR"]] as const) {
    const arm = new THREE.Group();
    arm.name = name;
    arm.position.set(side * 0.2, neckY - 0.06, 0);
    const hand = sit ? V(side * 0.12, -0.42, 0.34) : V(side * 0.1, -0.95, 0.04);
    const elbow = sit ? V(side * 0.1, -0.38, 0.05) : V(side * 0.08, -0.48, -0.03);
    arm.add(rod(kit, 0.035, body, V(0, 0, 0), elbow));
    arm.add(rod(kit, 0.03, body, elbow, hand));
    arm.add(sphere(kit, 0.045, body, hand.x, hand.y, hand.z, 8));
    g.add(arm);
  }
  // Legs.
  for (const side of [-1, 1]) {
    const hip = V(side * 0.1, hipY, 0);
    const knee = sit ? V(side * 0.12, hipY, 0.42) : V(side * 0.1, hipY * 0.5, 0.02);
    const foot = sit ? V(side * 0.12, 0.04, 0.46) : V(side * 0.1, 0.04, 0);
    g.add(rod(kit, 0.045, body, hip, knee));
    g.add(rod(kit, 0.04, body, knee, foot));
    g.add(sphere(kit, 0.05, body, foot.x, 0.04, foot.z + 0.04, 8));
  }
  if (pose === "peek") {
    // Lean out from behind a door edge at x = 0: only the head and one arm clear it.
    g.rotation.z = 0.28;
    g.position.x = -0.3;
  }
  const scale = opts.scale ?? 1;
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.scale.setScalar(scale);
  wrap.name = "partygoer";
  return { object: wrap, footprint: sit ? [] : [[0, 0, 0.3 * scale]] };
}

/**
 * The puzzle-3 blackout crowd: a silhouette in (almost) every banquet seat
 * plus figures standing packed around the room. `seats` are the banquet's
 * "seat_i" anchors (already in the same frame as `area`), `area` the room's
 * floor rectangle to scatter standing figures in.
 */
export function funPartygoerCrowd(kit: DecorKit, rng: Rng, seats: FunAnchor[], area: { minX: number; maxX: number; minZ: number; maxZ: number }, standing = 24): FunPiece {
  const g = new THREE.Group();
  for (const seat of seats) {
    if (rng.next() < 0.1) continue;
    const pg = funPartygoer(kit, { pose: "sit", silhouette: true, scale: rng.nextRange(0.95, 1.05) }).object;
    pg.position.set(seat.x, 0, seat.z);
    pg.rotation.y = seat.yaw;
    g.add(pg);
  }
  for (let i = 0; i < standing; i++) {
    const pg = funPartygoer(kit, { pose: "stand", silhouette: true, scale: rng.nextRange(0.9, 1.15) }).object;
    pg.position.set(rng.nextRange(area.minX, area.maxX), 0, rng.nextRange(area.minZ, area.maxZ));
    pg.rotation.y = rng.nextRange(-Math.PI, Math.PI);
    g.add(pg);
  }
  g.name = "partygoer_crowd";
  // Apparition only: nothing here blocks movement.
  return { object: g, footprint: [] };
}

// ---------------------------------------------------------------------------
// Puzzle set pieces: things to find, open and carry
// ---------------------------------------------------------------------------

/** Folded gingham tablecloth with a ribbon — puzzle 1's "tablecloth" pickup. */
export function funTableclothFolded(kit: DecorKit, color: PartyColor = "red"): FunPiece {
  const g = new THREE.Group();
  const cloth = kit.mat(`fun_cloth_folded_${color}`, () => {
    const map = canvasTexture(kit, 64, 64, (ctx) => {
      ctx.fillStyle = CSS(color); ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (let i = 0; i < 64; i += 16) { ctx.fillRect(i, 0, 8, 64); ctx.fillRect(0, i, 64, 8); }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  });
  for (let i = 0; i < 3; i++) g.add(box(kit, 0.42 - i * 0.02, 0.05, 0.3, cloth, 0, 0.03 + i * 0.05, 0));
  g.add(box(kit, 0.05, 0.16, 0.32, plastic(kit, "white", 0.6), 0, 0.09, 0));
  g.name = "tablecloth";
  return { object: g, footprint: [] };
}

/** A flat cloth patch lying on a table slot (the placed version of the tablecloth). */
export function funTableclothFlat(kit: DecorKit, color: PartyColor = "red", size = 0.5): FunPiece {
  const g = new THREE.Group();
  const mat = kit.mat(`fun_cloth_folded_${color}`, () => new THREE.MeshStandardMaterial({ color: PARTY_COLORS[color], roughness: 0.95 }));
  g.add(box(kit, size, 0.006, size, mat, 0, 0.004, 0));
  g.name = "tablecloth_flat";
  return { object: g, footprint: [] };
}

/** A big painted numeral on the table, marking slot `n` (1-based) of puzzle 1's place settings. */
export function funNumberMarker(kit: DecorKit, n: number, size = 0.5): FunPiece {
  const mat = canvasMat(kit, `numslot_${n}`, 128, 128, (ctx) => {
    const r = mulberry(9100 + n);
    ctx.setLineDash([9, 7]);
    ctx.strokeStyle = "rgba(30,20,20,0.7)"; ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 108, 108);
    ctx.setLineDash([]);
    crayonText(ctx, r, String(n), 64, 66, 84, "rgba(190,40,40,0.9)");
  }, { cutout: true });
  const g = new THREE.Group();
  const p = plane(kit, size, size, mat, 0, 0.002, 0);
  p.rotation.x = -Math.PI / 2;
  g.add(p);
  g.name = "slot_marker";
  return { object: g, footprint: [] };
}

/**
 * Wall cabinet (origin on the wall plane, opening towards +Z). The door is
 * the pivot named "door" (hinged at -x; rotate about y to open); the shelf
 * inside is the anchor "shelf".
 */
export function funCabinet(kit: DecorKit): FunPiece {
  const g = new THREE.Group();
  const wood = std(kit, "cabinet_wood", { color: 0xb8956a, roughness: 0.85 });
  const dark = std(kit, "cabinet_inner", { color: 0x5a4632, roughness: 0.95 });
  const W = 1.1, H = 1.0, D = 0.45, y0 = 0.85;
  g.add(box(kit, W, 0.03, D, wood, 0, y0, D / 2));
  g.add(box(kit, W, 0.03, D, wood, 0, y0 + H, D / 2));
  g.add(box(kit, 0.03, H, D, wood, -W / 2, y0 + H / 2, D / 2));
  g.add(box(kit, 0.03, H, D, wood, W / 2, y0 + H / 2, D / 2));
  g.add(box(kit, W, H, 0.02, dark, 0, y0 + H / 2, 0.01));
  g.add(box(kit, W - 0.04, 0.025, D - 0.04, wood, 0, y0 + 0.34, D / 2));
  const door = new THREE.Group();
  door.name = "door";
  door.position.set(-W / 2, y0, D);
  door.add(box(kit, W, H, 0.03, wood, W / 2, H / 2, 0.015));
  door.add(sphere(kit, 0.025, std(kit, "knob", { color: 0xd8c070, roughness: 0.25, metalness: 0.85 }), W - 0.1, H / 2, 0.05, 8));
  g.add(door);
  // Legs so it reads as furniture, not a floating box.
  g.add(box(kit, W, y0, D - 0.06, dark, 0, y0 / 2, D / 2));
  g.name = "cabinet";
  return {
    object: g,
    footprint: [[-0.3, D / 2, 0.3], [0.3, D / 2, 0.3]],
    anchors: { shelf: { x: 0, y: y0 + 0.36, z: D / 2, yaw: 0 } },
  };
}

/** Wooden toy chest, freestanding, front towards +Z. Lid pivot "lid" hinged at the back (rotate x to open); "inside" anchor. */
export function funToyChest(kit: DecorKit, color: PartyColor = "blue"): FunPiece {
  const g = new THREE.Group();
  const body = plastic(kit, color, 0.6);
  const trim = std(kit, "chest_trim", { color: 0xd8c070, roughness: 0.4, metalness: 0.7 });
  const W = 0.95, H = 0.5, D = 0.55;
  g.add(box(kit, W, H, D, body, 0, H / 2, 0));
  g.add(box(kit, W + 0.02, 0.05, 0.05, trim, 0, 0.32, D / 2 + 0.005));
  const lid = new THREE.Group();
  lid.name = "lid";
  lid.position.set(0, H, -D / 2);
  lid.add(box(kit, W + 0.04, 0.06, D + 0.04, body, 0, 0.03, D / 2));
  lid.add(box(kit, 0.12, 0.08, 0.03, trim, 0, 0.02, D + 0.03));
  g.add(lid);
  // Toys' stickers so it looks like a kids' chest.
  const sticker = canvasMat(kit, `chest_sticker_${color}`, 128, 128, (ctx) => {
    const r = mulberry(2024);
    drawSymbol(ctx, r, "star", 44, 44, 60, "#f2cc2e", 8);
    drawSymbol(ctx, r, "heart", 88, 86, 50, "#ffffff", 7);
  }, { cutout: true });
  g.add(plane(kit, 0.5, 0.5, sticker, 0, 0.25, D / 2 + 0.006));
  g.name = "toy_chest";
  return {
    object: g,
    footprint: [[0, 0, 0.55]],
    anchors: { inside: { x: 0, y: H - 0.02, z: 0, yaw: 0 } },
  };
}

// ---------------------------------------------------------------------------
// Scatter and debris
// ---------------------------------------------------------------------------

/** Confetti strewn on the floor within `radius` (one instanced draw call). */
export function funConfetti(kit: DecorKit, rng: Rng, radius = 1.5, count = 120, stage: FunStage = 0): THREE.Object3D {
  const geo = kit.geo("fun_confetti", () => new THREE.PlaneGeometry(0.025, 0.014).rotateX(-Math.PI / 2));
  const mat = kit.mat("fun_confetti", () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color(), grime = new THREE.Color(0x5a5040);
  for (let i = 0; i < count; i++) {
    const a = rng.nextRange(0, Math.PI * 2), d = Math.sqrt(rng.next()) * radius;
    p.set(Math.cos(a) * d, 0.004 + rng.next() * 0.002, Math.sin(a) * d);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.nextRange(0, Math.PI));
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
    c.setHex(PARTY_COLORS[FESTIVE[rng.nextInt(0, FESTIVE.length)]]).lerp(grime, stage * 0.3);
    inst.setColorAt(i, c);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}

/** Party leftovers on the floor: tipped cups, a dropped hat, a plate, crumbs of confetti. */
export function funPartyDebris(kit: DecorKit, rng: Rng, stage: FunStage = 1): FunPiece {
  const g = new THREE.Group();
  const pick = () => FESTIVE[rng.nextInt(0, FESTIVE.length)];
  const n = 2 + rng.nextInt(0, 2);
  for (let i = 0; i < n; i++) {
    const cup = funCup(kit, pick(), true).object;
    cup.position.set(rng.nextRange(-0.6, 0.6), 0, rng.nextRange(-0.6, 0.6));
    cup.rotation.y = rng.nextRange(0, Math.PI * 2);
    g.add(cup);
  }
  const hat = funPartyHat(kit, pick()).object;
  hat.rotation.set(Math.PI / 2 - 0.1, rng.nextRange(0, Math.PI * 2), 0);
  hat.position.set(rng.nextRange(-0.5, 0.5), 0.07, rng.nextRange(-0.5, 0.5));
  g.add(hat);
  if (rng.next() < 0.6) {
    const plate = funPlate(kit, "white").object;
    plate.position.set(rng.nextRange(-0.5, 0.5), 0, rng.nextRange(-0.5, 0.5));
    plate.rotation.z = 0.08;
    g.add(plate);
  }
  if (stage >= 1) {
    const b = funBalloon(kit, pick(), { deflated: true }).object;
    b.position.set(rng.nextRange(-0.7, 0.7), 0, rng.nextRange(-0.7, 0.7));
    b.rotation.y = rng.nextRange(0, Math.PI * 2);
    g.add(b);
  }
  g.add(funConfetti(kit, rng, 0.9, 50, stage));
  return { object: g, footprint: [] };
}

// ---------------------------------------------------------------------------
// Room dressers (LevelDecor frame: back wall at z = -half)
// ---------------------------------------------------------------------------

/** Anything built facing +Z in the wall plane, pushed onto the back wall. */
function onBackWall(piece: FunPiece, wz: number, x: number, y: number): THREE.Object3D {
  piece.object.position.set(x, y, wz);
  return piece.object;
}

/**
 * Generic dressing for one open party-venue cell against its back wall,
 * like LevelDecor's electricalStationDecor. Corridors only get wall-hung
 * things so they stay walkable. Stage shifts the mix from set-up party
 * (0) to abandoned (1) to wrong (2).
 */
export function funRoomDecor(kit: DecorKit, rng: Rng, half: number, corridor: boolean, stage: FunStage): FunPiece {
  const g = new THREE.Group();
  const footprint: [number, number, number][] = [];
  const wz = -half;
  const pick = () => FESTIVE[rng.nextInt(0, FESTIVE.length)];
  const add = (piece: FunPiece, x: number, z: number, yaw = 0) => {
    piece.object.position.set(x, piece.object.position.y, z);
    piece.object.rotation.y = yaw;
    g.add(piece.object);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [fx, fz, r] of piece.footprint) footprint.push([x + fx * c + fz * s, z - fx * s + fz * c, r]);
  };

  // Something on the wall almost always.
  const wallRoll = rng.next();
  if (wallRoll < 0.35) {
    const specs: DrawingSpec[] = stage === 2
      ? [{ kind: "partygoer" }, { kind: "family", figures: 3, wrong: true }]
      : [{ kind: "house" }, { kind: "family", figures: 3 + rng.nextInt(0, 2), wrong: stage === 1 && rng.next() < 0.3 }];
    const count = 1 + rng.nextInt(0, 2);
    for (let i = 0; i < count; i++) {
      g.add(onBackWall(funDrawing(kit, specs[rng.nextInt(0, specs.length)], rng.nextInt(0, 999)), wz, (i - (count - 1) / 2) * 0.62 + rng.nextRange(-0.1, 0.1), rng.nextRange(1.2, 1.6)));
    }
  } else if (wallRoll < 0.6) {
    const garland = funGarland(kit, half * 1.8, rng.nextRange(0.15, 0.35), stage === 2 ? ["white", "red"] : FESTIVE).object;
    garland.position.set(0, 2.85, wz + 0.04);
    g.add(garland);
  } else if (wallRoll < 0.72 && stage === 2) {
    g.add(onBackWall(funWallSymbol(kit, "smile", "red", 0.6), wz, rng.nextRange(-1, 1), rng.nextRange(1.3, 2.0)));
  }

  if (!corridor) {
    const roll = rng.next();
    if (roll < 0.3) {
      const table = funPartyTable(kit, pick(), { length: 1.6, places: 2, stage });
      add(table, rng.nextRange(-0.5, 0.5), wz + 1.2, 0);
      const t0 = table.anchors!;
      for (let i = 0; i < 4; i++) {
        const a = t0[`place_${i}`];
        if (!a || rng.next() < stage * 0.3) continue;
        const plate = funPlate(kit, pick()).object;
        plate.position.set(table.object.position.x + a.x, a.y, table.object.position.z + a.z);
        g.add(plate);
        const cup = funCup(kit, pick(), stage >= 1 && rng.next() < 0.4).object;
        cup.position.set(table.object.position.x + a.x + 0.16, a.y, table.object.position.z + a.z);
        g.add(cup);
      }
      for (let i = 0; i < 4; i++) {
        const s = t0[`seat_${i}`];
        if (!s || rng.next() < 0.25) continue;
        const knocked = stage >= 1 && rng.next() < 0.25 * stage;
        add(funKidChair(kit, pick(), knocked), table.object.position.x + s.x, table.object.position.z + s.z, s.yaw + rng.nextRange(-0.3, 0.3));
      }
    } else if (roll < 0.5) {
      add(funBalloonCluster(kit, rng, 3 + rng.nextInt(0, 3)), rng.nextRange(-1.2, 1.2), wz + 0.45);
    } else if (roll < 0.65) {
      // A pile of unopened presents against the wall.
      const n = 2 + rng.nextInt(0, 2);
      for (let i = 0; i < n; i++) add(funGift(kit, pick(), pick(), rng.nextRange(0.25, 0.45)), rng.nextRange(-1, 1), wz + 0.35 + rng.nextRange(0, 0.2), rng.nextRange(-0.4, 0.4));
    } else if (roll < 0.78) {
      // Chairs stacked in a corner, one left out.
      const x = rng.next() < 0.5 ? -half + 0.45 : half - 0.45, color = pick();
      for (let i = 0; i < 4; i++) {
        const c = funKidChair(kit, color).object;
        c.position.set(x, i * 0.06, wz + 0.4);
        g.add(c);
      }
      footprint.push([x, wz + 0.4, 0.3]);
      add(funKidChair(kit, pick(), stage >= 1 && rng.next() < 0.5), x + (x < 0 ? 0.8 : -0.8), wz + 0.9, rng.nextRange(-1, 1));
    } else if (roll < 0.9) {
      add(funPartyDebris(kit, rng, stage), rng.nextRange(-0.8, 0.8), rng.nextRange(-0.8, 0.8));
    }
    if (rng.next() < (stage === 0 ? 0.3 : 0.15)) {
      for (let i = 0; i < 3; i++) {
        const st = funStreamer(kit, pick(), rng.nextRange(0.7, 1.4)).object;
        st.position.set(rng.nextRange(-1.5, 1.5), 3, rng.nextRange(-1.5, 1.5));
        g.add(st);
      }
    }
    if (stage >= 1 && rng.next() < 0.5) add(funBalloon(kit, pick(), { deflated: true }), rng.nextRange(-1.5, 1.5), rng.nextRange(-1.5, 1.5), rng.nextRange(0, 6));
  } else if (rng.next() < 0.4) {
    // A lone balloon drifting at the end of a corridor.
    add(funBalloon(kit, pick(), { height: rng.nextRange(1.5, 2.3), deflated: stage === 2 && rng.next() < 0.5 }), rng.nextRange(-1, 1), wz + 0.3);
  }
  return { object: g, footprint };
}

export type FunRoomTheme = "red" | "blue" | "yellow" | "green";

/**
 * One of puzzle 2's four small themed party rooms: tinted wallpaper strip,
 * theme-coloured table, balloons and garland. The room is left without a
 * clue on purpose; anchors say where the logic layer can hang one:
 * "clue_wall" (back wall, eye height) and "clue_table" (on the table).
 */
export function funThemedRoomDecor(kit: DecorKit, rng: Rng, theme: FunRoomTheme, half: number, stage: FunStage = 1): FunPiece {
  const g = new THREE.Group();
  const wz = -half;
  const footprint: [number, number, number][] = [];
  // Painted dado band in the theme colour along the back wall.
  const band = std(kit, `band_${theme}`, { color: PARTY_COLORS[theme], roughness: 0.8 });
  g.add(box(kit, half * 2, 0.9, 0.01, band, 0, 0.45, wz + 0.006));
  g.add(box(kit, half * 2, 0.05, 0.03, std(kit, "band_trim", { color: 0xf2efe6, roughness: 0.6 }), 0, 0.92, wz + 0.015));

  const garland = funGarland(kit, half * 1.8, 0.25, [theme, "white"]).object;
  garland.position.set(0, 2.85, wz + 0.04);
  g.add(garland);

  const table = funPartyTable(kit, theme, { length: 1.4, depth: 0.8, places: 2, stage });
  table.object.position.set(0, 0, wz + 1.6);
  g.add(table.object);
  for (const [fx, fz, r] of table.footprint) footprint.push([fx, wz + 1.6 + fz, r]);
  for (let i = 0; i < 4; i++) {
    const s = table.anchors![`seat_${i}`];
    const chair = funKidChair(kit, theme, stage >= 1 && i === 3).object;
    chair.position.set(s.x, 0, wz + 1.6 + s.z);
    chair.rotation.y = s.yaw;
    g.add(chair);
  }
  for (const side of [-1, 1]) {
    const cluster = funBalloonCluster(kit, rng, 3, [theme, theme, "white"]);
    cluster.object.position.set(side * (half - 0.5), 0, wz + 0.5);
    g.add(cluster.object);
    footprint.push([side * (half - 0.5), wz + 0.5, 0.3]);
  }
  const gift = funGift(kit, theme, "white", 0.32);
  gift.object.position.set(half - 0.6, 0, wz + 1.6);
  g.add(gift.object);
  footprint.push([half - 0.6, wz + 1.6, 0.25]);
  g.add(funConfetti(kit, rng, 1.6, 80, stage));

  const center = table.anchors!.center;
  return {
    object: g,
    footprint,
    anchors: {
      clue_wall: { x: 0, y: 1.5, z: wz + 0.01, yaw: 0 },
      clue_table: { x: center.x, y: center.y, z: wz + 1.6 + center.z, yaw: 0 },
    },
  };
}
