/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

/**
 * The maze levels' wall, floor and ceiling textures, drawn once per level,
 * plus `weatherCanvas`, the shared grain/wear pass the other levels run over
 * their own procedural surfaces.
 *
 * Everything here is high-frequency detail that tiles seamlessly (paper
 * grain, carpet pile, acoustic pits, seams, rivets). Large stains, water
 * damage and corner shading are deliberately left out: those come from
 * SurfaceShading.ts in world space, so they never repeat with the texture.
 */

/** Periodic value noise: wraps every `period` (x) / `periodY` cells, so the canvas tiles. */
function periodicNoise(period: number, seed: number, periodY = period): (x: number, y: number) => number {
  const lattice = new Float32Array(period * periodY);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < lattice.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    lattice[i] = (s >>> 0) / 4294967296;
  }
  const at = (x: number, y: number) => lattice[((y % periodY) + periodY) % periodY * period + ((x % period) + period) % period];
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ux;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ux;
    return a + (b - a) * uy;
  };
}

function colorTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

interface GrainLayer {
  /** Noise cells across the canvas width (the height gets as many per pixel). */
  period: number;
  amp: number;
  seed: number;
  /** Stretches the noise vertically (fibres, streaks). */
  stretchY?: number;
}

/**
 * Per-pixel multiply by `1 + amp * (n - 0.5)` for a stack of periodic noises.
 * Works on any canvas size; each layer wraps on both edges.
 */
function grain(ctx: CanvasRenderingContext2D, size: number, layers: GrainLayer[], height = size) {
  const img = ctx.getImageData(0, 0, size, height);
  const d = img.data;
  const fields = layers.map((l) => {
    const py = Math.max(1, Math.round((l.period * height) / size / (l.stretchY ?? 1)));
    return { ...l, py, n: periodicNoise(l.period, l.seed, py) };
  });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      let k = 1;
      for (const f of fields) k *= 1 + f.amp * (f.n((x / size) * f.period, (y / height) * f.py) - 0.5);
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The mono-yellow wallpaper: two 0.5 m strips per 1 m tile, each printed with
 * a faint stripe-and-diamond pattern, with the overlap seam between strips.
 * 256 px per metre, tiled (4, 3) over a 4 m x 3 m wall panel.
 */
export function createLevel0WallpaperTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  ctx.fillStyle = "#cfc184";
  ctx.fillRect(0, 0, size, size);

  // Printed pattern: a darker stripe pair every 32 px with a column of small
  // diamonds between them (the classic Level 0 print, kept very low contrast).
  for (let x = 0; x < size; x += 32) {
    ctx.fillStyle = "rgba(120, 104, 52, 0.16)";
    ctx.fillRect(x + 2, 0, 2, size);
    ctx.fillRect(x + 7, 0, 1, size);
    ctx.fillStyle = "rgba(255, 246, 200, 0.12)";
    ctx.fillRect(x + 4, 0, 3, size);
    ctx.fillStyle = "rgba(128, 110, 56, 0.13)";
    for (let y = 0; y < size; y += 16) {
      const cx = x + 20, cy = y + 8;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 3); ctx.lineTo(cx + 2.5, cy); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx - 2.5, cy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Paper fibre: fine vertical streaks plus a soft blotchiness.
  grain(ctx, size, [
    { period: 64, amp: 0.07, seed: 11, stretchY: 6 },
    { period: 128, amp: 0.05, seed: 23 },
    { period: 8, amp: 0.05, seed: 37 },
  ]);

  // Strip seams every 0.5 m: a thin shadow line with the overlapping edge
  // catching the light beside it, and the paper a touch lighter near it
  // where it has started to lift.
  for (const sx of [0, size / 2]) {
    const lift = ctx.createLinearGradient(sx - 6, 0, sx + 6, 0);
    lift.addColorStop(0, "rgba(255, 248, 210, 0)");
    lift.addColorStop(0.5, "rgba(255, 248, 210, 0.08)");
    lift.addColorStop(1, "rgba(255, 248, 210, 0)");
    ctx.fillStyle = lift;
    ctx.fillRect(sx - 6, 0, 12, size);
    if (sx === 0) ctx.fillRect(size - 6, 0, 6, size);
    ctx.fillStyle = "rgba(70, 58, 26, 0.32)";
    ctx.fillRect(sx, 0, 1, size);
    ctx.fillStyle = "rgba(255, 250, 220, 0.18)";
    ctx.fillRect(sx + 1, 0, 1, size);
  }

  return colorTexture(canvas, 4, 3);
}

/**
 * Damp, low-pile commercial carpet: dense fibre noise with a faint woven
 * direction and tufts. 256 px per metre, tiled (4, 4) over a 4 m cell.
 */
export function createLevel0CarpetTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  ctx.fillStyle = "#8a7a4c";
  ctx.fillRect(0, 0, size, size);

  // Woven rows, then pile and tufts at three scales.
  ctx.fillStyle = "rgba(60, 50, 24, 0.10)";
  for (let y = 0; y < size; y += 4) ctx.fillRect(0, y, size, 1);
  grain(ctx, size, [
    { period: 128, amp: 0.34, seed: 5 },
    { period: 48, amp: 0.18, seed: 9 },
    { period: 16, amp: 0.12, seed: 13 },
  ]);

  // Individual fibres catching the light.
  const n = periodicNoise(256, 77);
  for (let i = 0; i < 2600; i++) {
    const x = n(i * 0.37, 1.3) * size;
    const y = n(5.1, i * 0.41) * size;
    const light = n(i * 0.13, i * 0.07) > 0.5;
    ctx.fillStyle = light ? "rgba(180, 164, 112, 0.22)" : "rgba(48, 40, 18, 0.26)";
    ctx.fillRect(x, y, 1, 1);
  }

  return colorTexture(canvas, 4, 4);
}

/**
 * Drop ceiling: mineral-fibre tiles in a white T-bar grid, two tiles per
 * side of the canvas. Each tile gets its own slight shade, the
 * way a real grid has a few replaced or yellowed ones.
 */
export function createLevel0CeilingTexture(cellSize: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  const half = size / 2;
  const tileShades = ["#d6d1bb", "#cfc9b0", "#d9d4c0", "#ccc4a8"];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = tileShades[i];
    ctx.fillRect((i % 2) * half, Math.floor(i / 2) * half, half, half);
  }

  // Fissured acoustic surface: blotchy pits at two scales.
  grain(ctx, size, [
    { period: 64, amp: 0.16, seed: 41 },
    { period: 24, amp: 0.1, seed: 43 },
  ]);
  const n = periodicNoise(256, 91);
  for (let i = 0; i < 1400; i++) {
    const x = n(i * 0.31, 2.7) * size;
    const y = n(8.3, i * 0.29) * size;
    const len = 1 + n(i * 0.11, i * 0.17) * 3;
    ctx.fillStyle = "rgba(70, 66, 52, 0.28)";
    if (n(i * 0.07, 0.3) > 0.5) ctx.fillRect(x, y, len, 1);
    else ctx.fillRect(x, y, 1, len);
  }

  // Each tile sits a little recessed: a soft shadow just inside the grid.
  for (let tx = 0; tx < 2; tx++) {
    for (let ty = 0; ty < 2; ty++) {
      ctx.strokeStyle = "rgba(60, 56, 40, 0.18)";
      ctx.lineWidth = 3;
      ctx.strokeRect(tx * half + 4.5, ty * half + 4.5, half - 9, half - 9);
    }
  }
  // The T-bar grid itself (centred on the canvas edges and middle so it tiles).
  ctx.fillStyle = "#e9e6da";
  for (const p of [0, half, size]) {
    ctx.fillRect(p - 3, 0, 6, size);
    ctx.fillRect(0, p - 3, size, 6);
  }
  ctx.fillStyle = "rgba(90, 86, 70, 0.35)";
  for (const p of [0, half, size]) {
    ctx.fillRect(p + 3, 0, 1, size);
    ctx.fillRect(0, p + 3, size, 1);
  }

  // Whole repeats per cell, or the grid would jump at every cell boundary
  // (each ceiling plane starts its UVs at 0): ~0.67 m tiles on a 4 m cell.
  const repeats = Math.max(1, Math.round(cellSize / 1.2));
  return colorTexture(canvas, repeats, repeats);
}

/** A canvas and its 2D context (null when canvas 2D is unavailable). */
function canvas2d(w: number, h = w): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") };
}

/** Small deterministic stream for per-brick/per-panel choices (textures stay identical across clients). */
function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * The shared wear pass for the levels' own procedural surfaces (hotel,
 * Poolrooms, FUN, station, town, lobby): fine grain plus soft, low-contrast
 * blotching, both wrapping at the canvas edges so tiled textures stay
 * seamless. Run it after drawing, before the CanvasTexture is created.
 */
export function weatherCanvas(ctx: CanvasRenderingContext2D, opts: { grain?: number; blotch?: number; seed?: number } = {}) {
  const { width, height } = ctx.canvas;
  if (width < 16 || height < 16) return;
  const seed = opts.seed ?? 71;
  const layers: GrainLayer[] = [];
  if (opts.blotch) layers.push({ period: 6, amp: opts.blotch, seed: seed + 1 }, { period: 14, amp: opts.blotch * 0.6, seed: seed + 2 });
  if (opts.grain) layers.push({ period: Math.max(8, Math.round(width / 4)), amp: opts.grain, seed: seed + 3 });
  if (layers.length) grain(ctx, width, layers, height);
}

/**
 * Board-formed concrete (Level 1): poured lifts with a horizontal cold
 * joint, panel joints, tie-rod holes and aggregate. 2 m x 1.5 m per repeat.
 */
export function createConcreteWallTexture(): THREE.Texture {
  const size = 512;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  ctx.fillStyle = "#979593";
  ctx.fillRect(0, 0, size, size);
  // Faint horizontal board marks from the formwork.
  for (let y = 0; y < size; y += 32) {
    ctx.fillStyle = "rgba(60, 58, 54, 0.07)";
    ctx.fillRect(0, y, size, 2);
    ctx.fillStyle = "rgba(255, 255, 250, 0.05)";
    ctx.fillRect(0, y + 2, size, 2);
  }
  grain(ctx, size, [
    { period: 8, amp: 0.16, seed: 101 },
    { period: 24, amp: 0.1, seed: 103 },
    { period: 128, amp: 0.12, seed: 107 },
  ]);
  // Aggregate pits.
  const r = stream(109);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = r() < 0.6 ? "rgba(45, 44, 42, 0.32)" : "rgba(220, 218, 210, 0.2)";
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 1.5);
  }
  // Joints: a cold joint across the middle, panel joints offset per lift.
  ctx.fillStyle = "rgba(30, 30, 30, 0.42)";
  ctx.fillRect(0, size / 2 - 2, size, 4);
  for (const [x, y0] of [[0, 0], [size / 2, size / 2]] as const) ctx.fillRect(x - 2, y0, 4, size / 2);
  ctx.fillStyle = "rgba(230, 228, 220, 0.12)";
  ctx.fillRect(0, size / 2 + 2, size, 2);
  // Tie-rod holes, a grid per panel, each with a slight rust weep.
  for (let ty = 64; ty < size; ty += 128) {
    for (let tx = 64; tx < size; tx += 128) {
      const weep = ctx.createLinearGradient(0, ty, 0, ty + 40);
      weep.addColorStop(0, "rgba(110, 70, 36, 0.22)");
      weep.addColorStop(1, "rgba(110, 70, 36, 0)");
      ctx.fillStyle = weep;
      ctx.fillRect(tx - 3, ty, 6, 40);
      ctx.fillStyle = "rgba(28, 27, 26, 0.7)";
      ctx.beginPath(); ctx.arc(tx, ty, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(200, 198, 190, 0.25)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(tx, ty, 7, 0, Math.PI * 2); ctx.stroke();
    }
  }
  return colorTexture(canvas, 2, 2);
}

/** Level 1's corrugated steel deck: ribs with a highlight and a shadow, rust in the troughs. */
export function createMetalCeilingTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  // One rib every 32 px, shaded as a rounded profile.
  for (let y = 0; y < size; y += 32) {
    const g = ctx.createLinearGradient(0, y, 0, y + 32);
    g.addColorStop(0, "#5f6466");
    g.addColorStop(0.3, "#9ca1a3");
    g.addColorStop(0.55, "#868b8d");
    g.addColorStop(0.8, "#4d5254");
    g.addColorStop(1, "#5f6466");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, size, 32);
    ctx.fillStyle = "rgba(120, 72, 34, 0.18)"; // rust collecting in the trough
    ctx.fillRect(0, y + 26, size, 4);
  }
  grain(ctx, size, [
    { period: 32, amp: 0.12, seed: 211, stretchY: 0.25 },
    { period: 96, amp: 0.08, seed: 213 },
  ]);
  return colorTexture(canvas, 4, 4);
}

/**
 * Electrical station brick: running bond with recessed mortar, every brick
 * its own fired shade, chipped corners and efflorescence low down.
 * 0.25 m x 0.075 m bricks; 1.33 m x 1.5 m per repeat on a 4 x 3 m wall.
 */
export function createBrickWallTexture(): THREE.Texture {
  const w = 512, h = 256;
  const { canvas, ctx } = canvas2d(w, h);
  if (!ctx) return new THREE.Texture();
  ctx.fillStyle = "#3a2a24"; // mortar
  ctx.fillRect(0, 0, w, h);
  const r = stream(307);
  const course = 16, brick = 64, joint = 3;
  for (let row = 0; row * course < h; row++) {
    const y = row * course;
    const offset = row % 2 ? brick / 2 : 0;
    for (let x = -offset; x < w; x += brick) {
      const shade = 0.82 + r() * 0.3;
      const red = Math.round(118 * shade), green = Math.round(64 * shade), blue = Math.round(50 * shade);
      ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      // Draw wrapped so the bond stays seamless across the canvas edge.
      for (const wx of [x, x + w]) {
        ctx.fillRect(wx + joint / 2, y + joint / 2, brick - joint, course - joint);
        ctx.fillStyle = "rgba(255, 220, 190, 0.1)"; // lit top arris
        ctx.fillRect(wx + joint / 2, y + joint / 2, brick - joint, 1);
        ctx.fillStyle = "rgba(20, 8, 6, 0.25)"; // shadowed bottom arris
        ctx.fillRect(wx + joint / 2, y + course - joint / 2 - 1, brick - joint, 1);
        ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      }
      if (r() < 0.25) { // a chipped corner
        ctx.fillStyle = "#3a2a24";
        ctx.beginPath();
        const cx = x + (r() < 0.5 ? joint : brick - joint), cy = y + (r() < 0.5 ? joint : course - joint);
        ctx.arc(((cx % w) + w) % w, cy, 2 + r() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  grain(ctx, w, [
    { period: 64, amp: 0.2, seed: 311 },
    { period: 16, amp: 0.1, seed: 313 },
  ], h);
  // Efflorescence: salt bloom along the lower courses.
  const bloom = ctx.createLinearGradient(0, h * 0.7, 0, h);
  bloom.addColorStop(0, "rgba(220, 210, 196, 0)");
  bloom.addColorStop(1, "rgba(220, 210, 196, 0.14)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  return colorTexture(canvas, 3, 2);
}

/** The red rooms' carpet: Level 0's pile, dyed a dark, damp crimson. */
export function createRedCarpetTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  ctx.fillStyle = "#5a1c1b";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(30, 4, 4, 0.12)";
  for (let y = 0; y < size; y += 4) ctx.fillRect(0, y, size, 1);
  grain(ctx, size, [
    { period: 128, amp: 0.4, seed: 401 },
    { period: 48, amp: 0.2, seed: 403 },
    { period: 16, amp: 0.12, seed: 405 },
  ]);
  return colorTexture(canvas, 4, 4);
}

/**
 * Pipe Dreams' walls: riveted steel sheets, rust bleeding down from every
 * rivet and seam, scale and pitting. 2 m x 1.5 m per repeat.
 */
export function createRustedMetalWallTexture(): THREE.Texture {
  const size = 512;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  ctx.fillStyle = "#3a281d";
  ctx.fillRect(0, 0, size, size);
  // Each sheet a slightly different temper.
  const r = stream(501);
  const half = size / 2;
  for (let i = 0; i < 4; i++) {
    const shade = 0.85 + r() * 0.3;
    ctx.fillStyle = `rgba(${Math.round(70 * shade)}, ${Math.round(48 * shade)}, ${Math.round(34 * shade)}, 0.6)`;
    ctx.fillRect((i % 2) * half, Math.floor(i / 2) * half, half, half);
  }
  grain(ctx, size, [
    { period: 96, amp: 0.45, seed: 503 },
    { period: 24, amp: 0.2, seed: 505 },
    { period: 128, amp: 0.12, seed: 507 },
  ]);
  // Seams: a dark gap with the lapped edge catching light.
  ctx.fillStyle = "rgba(12, 6, 3, 0.85)";
  for (const p of [0, half]) { ctx.fillRect(0, p - 2, size, 4); ctx.fillRect(p - 2, 0, 4, size); }
  ctx.fillStyle = "rgba(190, 150, 120, 0.12)";
  for (const p of [0, half]) { ctx.fillRect(0, p + 2, size, 2); ctx.fillRect(p + 2, 0, 2, size); }
  // Rivets along the seams, each weeping a rust streak downwards.
  for (const sy of [0, half]) {
    for (let x = 16; x < size; x += 32) {
      for (const ry of [sy + 12, sy + half - 12]) {
        const len = 30 + r() * 90;
        const streak = ctx.createLinearGradient(0, ry, 0, ry + len);
        streak.addColorStop(0, "rgba(140, 60, 18, 0.45)");
        streak.addColorStop(1, "rgba(140, 60, 18, 0)");
        ctx.fillStyle = streak;
        ctx.fillRect(x - 2.5, ry, 5, Math.min(len, size - ry));
        ctx.fillStyle = "#4e3426";
        ctx.beginPath(); ctx.arc(x, ry, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(220, 180, 150, 0.25)";
        ctx.beginPath(); ctx.arc(x - 1, ry - 1, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  return colorTexture(canvas, 2, 2);
}

/** Pipe Dreams' floor: rusted diamond tread plate, worn bright where people walk. 1 m per repeat. */
export function createRustedMetalFloorTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  ctx.fillStyle = "#2a1d14";
  ctx.fillRect(0, 0, size, size);
  // Raised lugs in alternating diagonals, lit on one flank.
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const cx = col * 16 + 8, cy = row * 16 + 8;
      const a = (row + col) % 2 ? Math.PI / 4 : -Math.PI / 4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = "rgba(10, 6, 3, 0.6)";
      ctx.fillRect(-6, 0, 12, 3);
      ctx.fillStyle = "rgba(150, 120, 96, 0.4)";
      ctx.fillRect(-6, -3, 12, 3);
      ctx.restore();
    }
  }
  grain(ctx, size, [
    { period: 64, amp: 0.5, seed: 601 },
    { period: 20, amp: 0.22, seed: 603 },
  ]);
  return colorTexture(canvas, 4, 4);
}

/** Pipe Dreams' ceiling: sooty corrugated sheet with rust in the troughs. */
export function createRustedMetalCeilingTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  for (let x = 0; x < size; x += 32) {
    const g = ctx.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, "#1c1410");
    g.addColorStop(0.35, "#3a2b22");
    g.addColorStop(0.6, "#2c2019");
    g.addColorStop(1, "#1c1410");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 32, size);
    ctx.fillStyle = "rgba(120, 52, 16, 0.22)";
    ctx.fillRect(x + 28, 0, 4, size);
  }
  grain(ctx, size, [
    { period: 48, amp: 0.4, seed: 701 },
    { period: 16, amp: 0.15, seed: 703, stretchY: 4 },
  ]);
  return colorTexture(canvas, 4, 4);
}

/**
 * Painted drywall for the offices: roller stipple, a scuffed band where
 * chairs hit it, and tape joints showing faintly through the paint.
 * 2 m x 3 m per repeat (the full wall height, so the band sits at one height).
 */
export function createOfficeWallTexture(): THREE.Texture {
  const w = 512, h = 768;
  const { canvas, ctx } = canvas2d(w, h);
  if (!ctx) return new THREE.Texture();
  ctx.fillStyle = "#b9beb2";
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, [
    { period: 128, amp: 0.05, seed: 801 },
    { period: 16, amp: 0.05, seed: 803 },
    { period: 4, amp: 0.06, seed: 805 },
  ], h);
  // Board joints every 1.2 m: the taped seam is a hair lighter and smoother.
  for (const x of [0, Math.round(w * 0.6)]) {
    ctx.fillStyle = "rgba(240, 242, 232, 0.12)";
    ctx.fillRect(x - 10, 0, 20, h);
  }
  // Chair scuffs around 0.75 m, then grime fading up from the skirting.
  const band = Math.round(h * (1 - 0.75 / 3));
  const r = stream(807);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = "rgba(70, 72, 66, 0.12)";
    ctx.fillRect(r() * w, band - 10 + r() * 20, 6 + r() * 30, 1 + r() * 2);
  }
  const grime = ctx.createLinearGradient(0, h * 0.86, 0, h);
  grime.addColorStop(0, "rgba(70, 68, 58, 0)");
  grime.addColorStop(1, "rgba(70, 68, 58, 0.22)");
  ctx.fillStyle = grime;
  ctx.fillRect(0, h * 0.86, w, h * 0.14);
  return colorTexture(canvas, 2, 1);
}

/**
 * Commercial carpet tiles (0.5 m), laid quarter-turned so neighbours catch
 * the light differently, with darker seams. 1 m (2 x 2 tiles) per repeat.
 */
export function createOfficeCarpetTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = canvas2d(size);
  if (!ctx) return new THREE.Texture();
  const half = size / 2;
  for (let i = 0; i < 4; i++) {
    const tx = (i % 2) * half, ty = Math.floor(i / 2) * half;
    ctx.fillStyle = (i === 0 || i === 3) ? "#4a5360" : "#465060";
    ctx.fillRect(tx, ty, half, half);
    // Loop-pile rows, running across or along depending on the tile's turn.
    ctx.fillStyle = "rgba(25, 28, 36, 0.14)";
    for (let k = 0; k < half; k += 3) {
      if (i === 0 || i === 3) ctx.fillRect(tx, ty + k, half, 1);
      else ctx.fillRect(tx + k, ty, 1, half);
    }
  }
  grain(ctx, size, [
    { period: 64, amp: 0.18, seed: 901 },
    { period: 16, amp: 0.12, seed: 903 },
  ]);
  ctx.fillStyle = "rgba(18, 20, 26, 0.4)";
  for (const p of [0, half]) { ctx.fillRect(p, 0, 1, size); ctx.fillRect(0, p, size, 1); }
  return colorTexture(canvas, 4, 4);
}
