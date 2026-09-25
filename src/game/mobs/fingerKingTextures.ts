/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural canvas textures for the Finger King (Level G) and the claw marks
 * it leaves on the office walls. Painted once, on first use, and shared by
 * every instance (same pattern as Water.ts's tile textures). Purely visual:
 * the tiny seeded RNG only keeps the look identical from run to run.
 */

import * as THREE from "three";

/** Small deterministic LCG so the textures look the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Grain: per-pixel brightness jitter over whatever is already painted. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, r: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color.replace("A", String(alpha)));
  g.addColorStop(0.6, color.replace("A", String(alpha * 0.55)));
  g.addColorStop(1, color.replace("A", "0"));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * (0.6 + 0.5 * Math.abs(Math.sin(x * 0.13 + y))), (x + y) * 0.01, 0, Math.PI * 2);
  ctx.fill();
}

let suitTex: THREE.CanvasTexture | null = null;
/** Faded office-grey pinstripe, damp stains, dried blood pooled toward the hems. */
export function kingSuitTexture(): THREE.CanvasTexture {
  if (suitTex) return suitTex;
  const W = 256, H = 256;
  const [c, ctx] = canvas(W, H);
  const r = rng(71);
  ctx.fillStyle = "#34363a";
  ctx.fillRect(0, 0, W, H);
  // Pinstripes, a little wobbly: the fabric has sagged.
  ctx.strokeStyle = "rgba(150,150,145,0.22)";
  ctx.lineWidth = 1;
  for (let x = 4; x < W; x += 11) {
    ctx.beginPath();
    for (let y = 0; y <= H; y += 16) ctx.lineTo(x + Math.sin(y * 0.05 + x) * 0.8, y);
    ctx.stroke();
  }
  // Damp mould stains
  for (let i = 0; i < 14; i++) blot(ctx, r() * W, r() * H, 10 + r() * 34, "rgba(18,20,14,A)", 0.55);
  // Dried blood: heavier near the bottom (cuffs, hems)
  for (let i = 0; i < 18; i++) {
    const y = H * (0.45 + 0.55 * Math.sqrt(r()));
    blot(ctx, r() * W, y, 5 + r() * 22, "rgba(58,6,6,A)", 0.7);
  }
  // Drips running down from a few of them
  ctx.strokeStyle = "rgba(48,4,4,0.75)";
  for (let i = 0; i < 12; i++) {
    const x = r() * W, y = H * (0.3 + r() * 0.5);
    ctx.lineWidth = 1 + r() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y + 15 + r() * 50);
    ctx.stroke();
  }
  // Frayed threads
  ctx.strokeStyle = "rgba(20,20,20,0.5)";
  for (let i = 0; i < 60; i++) {
    const x = r() * W, y = r() * H;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 8, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  grain(ctx, W, H, 26, r);
  suitTex = finish(c, true);
  return suitTex;
}

let skinTex: THREE.CanvasTexture | null = null;
/** Waxy dead-white skin: mottling, blue-violet veins, yellow-green bruises. */
export function kingSkinTexture(): THREE.CanvasTexture {
  if (skinTex) return skinTex;
  const W = 256, H = 256;
  const [c, ctx] = canvas(W, H);
  const r = rng(1337);
  ctx.fillStyle = "#d6cfc0";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) blot(ctx, r() * W, r() * H, 8 + r() * 26, "rgba(170,150,140,A)", 0.25);
  // Bruises
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = r() * H, rad = 10 + r() * 22;
    blot(ctx, x, y, rad, "rgba(96,70,110,A)", 0.45);
    blot(ctx, x + 4, y + 3, rad * 1.3, "rgba(150,150,70,A)", 0.25);
  }
  // Veins: branching random walks
  const vein = (x: number, y: number, len: number, width: number, depth: number) => {
    let a = r() * Math.PI * 2;
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(70,60,${120 + Math.floor(r() * 40)},${0.35 + r() * 0.25})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      a += (r() - 0.5) * 0.8;
      x += Math.cos(a) * 3;
      y += Math.sin(a) * 3;
      ctx.lineTo(x, y);
      if (depth > 0 && r() < 0.06) {
        ctx.stroke();
        vein(x, y, len * 0.5, width * 0.6, depth - 1);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  };
  for (let i = 0; i < 14; i++) vein(r() * W, r() * H, 20 + r() * 30, 1 + r() * 1.2, 2);
  // Knuckle creases
  ctx.strokeStyle = "rgba(90,70,60,0.35)";
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = r() * H;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, 3 + r() * 5, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  }
  grain(ctx, W, H, 18, r);
  skinTex = finish(c, true);
  return skinTex;
}

let nailTex: THREE.CanvasTexture | null = null;
/** Yellowed, cracked nails; some torn with a raw red bed. */
export function kingNailTexture(): THREE.CanvasTexture {
  if (nailTex) return nailTex;
  const W = 64, H = 64;
  const [c, ctx] = canvas(W, H);
  const r = rng(9);
  ctx.fillStyle = "#cdbf8f";
  ctx.fillRect(0, 0, W, H);
  blot(ctx, 20, 40, 20, "rgba(120,20,16,A)", 0.7);
  ctx.strokeStyle = "rgba(60,45,20,0.8)";
  for (let i = 0; i < 8; i++) {
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    let x = r() * W, y = r() * H;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 14; y += r() * 10; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  grain(ctx, W, H, 30, r);
  nailTex = finish(c, true);
  return nailTex;
}

let badgeTex: THREE.CanvasTexture | null = null;
/** A company ID badge with the photo scratched out. */
export function kingBadgeTexture(): THREE.CanvasTexture {
  if (badgeTex) return badgeTex;
  const W = 128, H = 176;
  const [c, ctx] = canvas(W, H);
  const r = rng(404);
  ctx.fillStyle = "#e9e4d6";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#6b1d1d";
  ctx.fillRect(0, 0, W, 30);
  ctx.fillStyle = "#f3eee0";
  ctx.font = "bold 18px Courier New, monospace";
  ctx.textAlign = "center";
  ctx.fillText("M.E.G.", W / 2, 22);
  // Photo, then scribbled over hard enough to tear the laminate
  ctx.fillStyle = "#8d8a80";
  ctx.fillRect(24, 40, 80, 88);
  ctx.fillStyle = "#b7b2a5";
  ctx.beginPath();
  ctx.ellipse(64, 78, 20, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(10,10,10,0.92)";
  for (let i = 0; i < 70; i++) {
    ctx.lineWidth = 1.5 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(30 + r() * 68, 50 + r() * 60);
    ctx.lineTo(30 + r() * 68, 50 + r() * 60);
    ctx.stroke();
  }
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 13px Courier New, monospace";
  ctx.fillText("Nº 0000", W / 2, 148);
  ctx.fillStyle = "#3a0606";
  ctx.fillRect(22, 156, 84, 6);
  for (let i = 0; i < 6; i++) blot(ctx, r() * W, H * (0.5 + r() * 0.5), 6 + r() * 10, "rgba(70,8,8,A)", 0.6);
  grain(ctx, W, H, 22, r);
  badgeTex = finish(c);
  return badgeTex;
}

let clawTex: THREE.CanvasTexture | null = null;
/** Four parallel finger gouges dragged down a wall, with a rust-red smear. Transparent background. */
export function kingClawTexture(): THREE.CanvasTexture {
  if (clawTex) return clawTex;
  const W = 128, H = 256;
  const [c, ctx] = canvas(W, H);
  const r = rng(23);
  ctx.clearRect(0, 0, W, H);
  for (let f = 0; f < 5; f++) {
    const x0 = 22 + f * 20 + (r() - 0.5) * 6;
    const y0 = 12 + r() * 30;
    const len = 150 + r() * 80;
    // Deep dark groove, then a pale scraped edge beside it
    for (const [style, width, dx] of [["rgba(20,14,10,0.85)", 4.5, 0], ["rgba(210,200,170,0.35)", 1.5, 3]] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0 + dx, y0);
      for (let y = 0; y < len; y += 8) ctx.lineTo(x0 + dx + Math.sin(y * 0.05 + f) * 3 + (r() - 0.5) * 1.5, y0 + y);
      ctx.stroke();
    }
    // Blood left by the torn nail
    if (r() < 0.6) {
      ctx.strokeStyle = "rgba(90,10,8,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0 - 2, y0 + len * 0.6);
      ctx.lineTo(x0 - 1, y0 + len * 0.6 + 30 + r() * 30);
      ctx.stroke();
    }
  }
  clawTex = new THREE.CanvasTexture(c);
  clawTex.colorSpace = THREE.SRGBColorSpace;
  return clawTex;
}
