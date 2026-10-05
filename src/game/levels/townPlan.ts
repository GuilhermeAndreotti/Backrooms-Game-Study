/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94's town drawn flat on a 2D canvas, from the layout alone (no
 * three.js): the plan the castle's model is painted with, the same plan the
 * assembly panel (TownModelModal) shows, and the landscape painting in the
 * castle's entrance that hints at where things stand.
 */

import {
  MODEL_PIECE_DATA, TOWER_PLAZA, TOWN_AREA, TOWN_CELL, TOWN_LOTS, TOWN_ROADS, TOWN_ROAD_HALF, TOWN_SPAWN, TOWN_TOWER,
  cellCenter, lotFloor,
} from "./townLayout";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Town metres -> canvas pixels for a canvas of size w x h showing the whole town area. */
export function planProjection(w: number, h: number) {
  const x0 = TOWN_AREA.x1 * TOWN_CELL, z0 = TOWN_AREA.z1 * TOWN_CELL;
  const sx = w / ((TOWN_AREA.x2 - TOWN_AREA.x1 + 1) * TOWN_CELL);
  const sz = h / ((TOWN_AREA.z2 - TOWN_AREA.z1 + 1) * TOWN_CELL);
  return { px: (x: number) => (x - x0) * sx, pz: (z: number) => (z - z0) * sz, sx, sz };
}

/** A lot's (or the tower square's) rectangle in canvas pixels. */
export function planRect(r: { x1: number; z1: number; x2: number; z2: number }, w: number, h: number) {
  const { px, pz } = planProjection(w, h);
  return { x: px(r.x1 * TOWN_CELL), y: pz(r.z1 * TOWN_CELL), w: px((r.x2 + 1) * TOWN_CELL) - px(r.x1 * TOWN_CELL), h: pz((r.z2 + 1) * TOWN_CELL) - pz(r.z1 * TOWN_CELL) };
}

const MISSING = new Set<string>(MODEL_PIECE_DATA.map((p) => p.id));

/**
 * The town from above: grass, hills as contour rings, the roads, and the
 * houses. `missing`: draw the five model buildings as empty dashed plots
 * (the model and its assembly panel) instead of as houses.
 */
export function drawTownPlan(c: CanvasRenderingContext2D, w: number, h: number, opts: { missing: boolean; houses: boolean }) {
  const { px, pz, sx } = planProjection(w, h);
  // Lawn, with the mowed stripes of a model railway's baseboard.
  for (let y = 0; y < h; y += 8) {
    c.fillStyle = Math.floor(y / 8) % 2 ? "#6a9c46" : "#73a64e";
    c.fillRect(0, y, w, 8);
  }
  // Hills: concentric rings, darker as they climb.
  const hills = [...TOWN_LOTS.map((l) => ({ r: l as { x1: number; z1: number; x2: number; z2: number }, floor: lotFloor(l) })), { r: TOWER_PLAZA, floor: lotFloor(TOWER_PLAZA) }];
  for (const hill of hills) {
    const cx = px((hill.r.x1 + hill.r.x2 + 1) * TOWN_CELL / 2), cz = pz((hill.r.z1 + hill.r.z2 + 1) * TOWN_CELL / 2);
    const base = (Math.max(hill.r.x2 - hill.r.x1, hill.r.z2 - hill.r.z1) + 1) * TOWN_CELL / 2;
    const rings = Math.max(1, Math.round(hill.floor / 2));
    for (let i = 0; i < rings; i++) {
      const k = i / rings;
      c.fillStyle = `rgba(40, 80, 25, ${0.12 + 0.04 * i})`;
      c.beginPath();
      c.ellipse(cx, cz, (base + (1 - k) * (6 + hill.floor * 1.4)) * sx, (base + (1 - k) * (6 + hill.floor * 1.4)) * sx, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  // Roads.
  const stroke = (width: number, style: string, dash: number[] = []) => {
    c.strokeStyle = style;
    c.lineWidth = width;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.setLineDash(dash);
    for (const road of TOWN_ROADS) {
      c.beginPath();
      road.forEach(([x, z], i) => {
        const X = px(cellCenter(x)), Z = pz(cellCenter(z));
        if (i === 0) c.moveTo(X, Z);
        else {
          // Round the corners a little, like the roads in town.
          const [qx, qz] = road[i - 1];
          const mx = (px(cellCenter(qx)) + X) / 2, mz = (pz(cellCenter(qz)) + Z) / 2;
          c.quadraticCurveTo(px(cellCenter(qx)), pz(cellCenter(qz)), mx, mz);
          if (i === road.length - 1) c.lineTo(X, Z);
        }
      });
      c.stroke();
    }
    c.setLineDash([]);
  };
  stroke(TOWN_ROAD_HALF * 2 * sx, "#5a5a5e");
  stroke(Math.max(1, 0.25 * sx), "#e8b830", [3 * sx, 3 * sx]);
  // The fence at the town's north edge, and the bus stop.
  c.strokeStyle = "#f6f3ea";
  c.lineWidth = Math.max(1, 0.5 * sx);
  c.beginPath(); c.moveTo(0, 1); c.lineTo(w, 1); c.stroke();
  c.fillStyle = "#2a4aa0";
  c.fillRect(px(cellCenter(TOWN_SPAWN.gx)) + 2 * sx, pz(cellCenter(TOWN_SPAWN.gz)) + 1 * sx, 1.4 * sx, 1.4 * sx);
  // Houses (and the tower), or empty plots where the model is missing them.
  const house = (r: { x1: number; z1: number; x2: number; z2: number }, wall: number, roof: number) => {
    const p = planRect(r, w, h);
    c.fillStyle = hex(wall);
    c.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    c.strokeStyle = hex(roof);
    c.lineWidth = Math.max(2, 0.8 * sx);
    c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  };
  const plot = (r: { x1: number; z1: number; x2: number; z2: number }) => {
    const p = planRect(r, w, h);
    c.fillStyle = "rgba(90, 60, 30, 0.55)";
    c.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    c.strokeStyle = "#f4efe2";
    c.lineWidth = Math.max(1.5, 0.4 * sx);
    c.setLineDash([4, 3]);
    c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    c.setLineDash([]);
  };
  for (const l of TOWN_LOTS) {
    if (opts.missing && MISSING.has(l.id)) plot(l);
    else if (opts.houses) house(l, l.wall, l.roof);
  }
  if (opts.missing) plot(TOWER_PLAZA);
  else if (opts.houses) {
    house(TOWER_PLAZA, 0xb8a890, 0x8a7a64);
    c.fillStyle = "#d8c8b0";
    const t = planRect({ x1: TOWN_TOWER.gx, z1: TOWN_TOWER.gz, x2: TOWN_TOWER.gx, z2: TOWN_TOWER.gz }, w, h);
    c.fillRect(t.x, t.y, t.w, t.h);
  }
}

/**
 * The entrance's painting: the town seen from the bus stop, every house on
 * its hill in its own colours, the tower on the highest one. Not a map, but
 * enough to tell which house stands where.
 */
export function drawTownView(c: CanvasRenderingContext2D, w: number, h: number) {
  const sky = c.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, "#5a8fd0");
  sky.addColorStop(1, "#d8ecf6");
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.fillStyle = "#ffffff";
  for (const [x, y, r] of [[0.15, 0.12, 0.05], [0.2, 0.1, 0.06], [0.72, 0.08, 0.05], [0.78, 0.1, 0.04]]) { c.beginPath(); c.arc(x * w, y * h, r * w, 0, Math.PI * 2); c.fill(); }
  const x0 = TOWN_AREA.x1 * TOWN_CELL, x1 = (TOWN_AREA.x2 + 1) * TOWN_CELL;
  const z0 = TOWN_AREA.z1 * TOWN_CELL, z1 = (TOWN_AREA.z2 + 1) * TOWN_CELL;
  // Far (north, low z) is high on the canvas and small; near is low and big.
  const depth = (z: number) => (z - z0) / (z1 - z0);
  const sy = (z: number, height: number) => h * (0.42 + 0.42 * depth(z)) - height * (4 + 6 * depth(z)) * (h / 300);
  const scale = (z: number) => 0.5 + 0.8 * depth(z);
  const sxp = (x: number, z: number) => w / 2 + (x - (x0 + x1) / 2) * (w / (x1 - x0)) * scale(z) * 0.9;
  c.fillStyle = "#6fa04a";
  c.fillRect(0, h * 0.42, w, h * 0.58);
  type Item = { z: number; draw: () => void };
  const items: Item[] = [];
  const lots = [...TOWN_LOTS.map((l) => ({ r: l as { x1: number; z1: number; x2: number; z2: number }, wall: l.wall, roof: l.roof, tower: false })), { r: TOWER_PLAZA, wall: 0xd8c8b0, roof: 0x2f5f4a, tower: true }];
  for (const l of lots) {
    const cx = (l.r.x1 + l.r.x2 + 1) * TOWN_CELL / 2, cz = (l.r.z1 + l.r.z2 + 1) * TOWN_CELL / 2;
    const floor = lotFloor(l.r);
    items.push({
      z: cz,
      draw: () => {
        const k = scale(cz);
        const X = sxp(cx, cz), Y = sy(cz, floor);
        const half = (l.r.x2 - l.r.x1 + 1) * TOWN_CELL * 0.5 * (w / (x1 - x0)) * k;
        // The hill under it.
        c.fillStyle = `rgb(${90 + depth(cz) * 20}, ${150 + depth(cz) * 20}, 70)`;
        c.beginPath();
        c.ellipse(X, sy(cz, 0) + 4, half * 2.6, Math.max(6, (sy(cz, 0) - Y) + 6), 0, Math.PI, 0);
        c.fill();
        if (l.tower) {
          const tw = 6 * k, th = 60 * k;
          c.fillStyle = hex(l.wall);
          c.fillRect(X - tw / 2, Y - th, tw, th);
          c.fillStyle = hex(l.roof);
          c.beginPath(); c.moveTo(X - tw, Y - th); c.lineTo(X, Y - th - 16 * k); c.lineTo(X + tw, Y - th); c.fill();
          c.fillStyle = "#f6efd8";
          c.beginPath(); c.arc(X, Y - th + 8 * k, 3 * k, 0, Math.PI * 2); c.fill();
          return;
        }
        const bh = 14 * k;
        c.fillStyle = hex(l.wall);
        c.fillRect(X - half, Y - bh, half * 2, bh);
        c.fillStyle = hex(l.roof);
        c.beginPath(); c.moveTo(X - half - 2, Y - bh); c.lineTo(X, Y - bh - 9 * k); c.lineTo(X + half + 2, Y - bh); c.fill();
        c.fillStyle = "rgba(40,50,70,0.8)";
        c.fillRect(X - half * 0.5, Y - bh * 0.7, half * 0.3, bh * 0.35);
        c.fillRect(X + half * 0.2, Y - bh * 0.7, half * 0.3, bh * 0.35);
      },
    });
  }
  items.sort((a, b) => a.z - b.z).forEach((i) => i.draw());
}
