/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

/**
 * Level 0's wallpaper, carpet and drop-ceiling tiles, drawn once per level.
 *
 * Everything here is high-frequency detail that tiles seamlessly (paper
 * grain, carpet pile, acoustic pits, seams). Large stains, water damage and
 * corner shading are deliberately left out: those come from
 * SurfaceShading.ts in world space, so they never repeat with the texture.
 */

/** Periodic value noise: wraps every `period` cells, so the canvas tiles. */
function periodicNoise(period: number, seed: number): (x: number, y: number) => number {
  const lattice = new Float32Array(period * period);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < lattice.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    lattice[i] = (s >>> 0) / 4294967296;
  }
  const at = (x: number, y: number) => lattice[((y % period) + period) % period * period + ((x % period) + period) % period];
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

/** Per-pixel multiply by `1 + amp * (n - 0.5)` for a stack of periodic noises. */
function grain(ctx: CanvasRenderingContext2D, size: number, layers: { period: number; amp: number; seed: number; stretchY?: number }[]) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const fields = layers.map((l) => ({ ...l, n: periodicNoise(l.period, l.seed) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let k = 1;
      for (const f of fields) k *= 1 + f.amp * (f.n((x / size) * f.period, (y / size) * f.period / (f.stretchY ?? 1)) - 0.5);
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
