/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Set dressing for Level 3 ("The Electrical Station"), Level 4 ("Abandoned
 * Office") and the Poolrooms, after their wiki descriptions: transformers,
 * fans, hot pipes and cryptic signs; vending machines, filing cabinets and
 * rain-streaked windows; ladders, tiled stairs into the water and pillars.
 *
 * Every piece is built in a local frame whose back wall is the plane
 * z = -half (north) and whose floor is y = 0; ProceduralMap rotates it onto
 * whichever wall the cell actually has. Footprints are local (x, z, radius)
 * collision circles. Choices come from the caller's SeededRandom, so every
 * client dresses the level identically.
 */

import * as THREE from "three";
import { POOL_FLOOR_Y } from "./Water";

export interface DecorKit {
  geo<T extends THREE.BufferGeometry>(key: string, build: () => T): T;
  mat<T extends THREE.Material>(key: string, build: () => T): T;
  /** Material for the Poolrooms' cream wall tiles. */
  wallTile: THREE.Material;
  /** Registers a texture to be disposed with the map. */
  track(texture: THREE.Texture): void;
}

export interface Rng {
  next(): number;
  nextRange(min: number, max: number): number;
  nextInt(min: number, max: number): number;
}

export interface DecorPiece {
  object: THREE.Object3D;
  /** Local collision circles: [x, z, radius]. */
  footprint: [number, number, number][];
  /** Meshes that spin like fan blades (about their local z). */
  fans?: THREE.Object3D[];
}

const std = (kit: DecorKit, key: string, params: THREE.MeshStandardMaterialParameters) =>
  kit.mat(`decor_${key}`, () => new THREE.MeshStandardMaterial(params));

function box(kit: DecorKit, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(kit.geo(`decor_box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(kit: DecorKit, r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(kit.geo(`decor_cyl_${r}_${h}_${seg}`, () => new THREE.CylinderGeometry(r, r, h, seg)), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function canvasMat(kit: DecorKit, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, emissive = false): THREE.Material {
  return kit.mat(`decor_canvas_${key}`, () => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    kit.track(map);
    return emissive
      ? new THREE.MeshBasicMaterial({ map })
      : new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
  });
}

function plane(kit: DecorKit, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(kit.geo(`decor_plane_${w}_${h}`, () => new THREE.PlaneGeometry(w, h)), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// ---------------------------------------------------------------------------
// Level 3 — The Electrical Station
// ---------------------------------------------------------------------------

/** Jumbled text and a number, like the signs posted beside every electrical room. */
function stationSign(kit: DecorKit, rng: Rng, wz: number, x: number, y: number): THREE.Mesh {
  const variant = rng.nextInt(0, 6);
  const mat = canvasMat(kit, `l3_sign_${variant}`, 256, 128, (ctx) => {
    const r = mulberry(variant * 977 + 13);
    ctx.fillStyle = "#d9c86a"; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = "#1c1a12"; ctx.fillRect(6, 6, 244, 116);
    ctx.fillStyle = "#d9c86a"; ctx.fillRect(10, 10, 236, 108);
    ctx.fillStyle = "#1c1a12"; ctx.font = "bold 22px monospace";
    const letters = "ABCDEFGHIJKLMNOPRSTUVXZ";
    for (let line = 0; line < 2; line++) {
      let text = "";
      for (let i = 0; i < 12; i++) text += r() < 0.18 ? " " : letters[Math.floor(r() * letters.length)];
      ctx.fillText(text, 20, 40 + line * 28);
    }
    if (variant === 0) { ctx.fillStyle = "#1c1a12"; ctx.fillText("CONTRIVANCE", 20, 40); }
    ctx.font = "bold 30px monospace";
    ctx.fillText(String(Math.floor(100 + r() * 900)), 20, 108);
    ctx.fillStyle = "#c21f12"; ctx.beginPath(); ctx.moveTo(210, 72); ctx.lineTo(190, 110); ctx.lineTo(230, 110); ctx.fill();
  });
  return plane(kit, 0.62, 0.31, mat, x, y, wz + 0.02);
}

function transformer(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const body = std(kit, "l3_transformer", { color: 0x56645a, roughness: 0.55, metalness: 0.6 });
  const dark = std(kit, "l3_vent", { color: 0x1b1f1d, roughness: 0.7, metalness: 0.5 });
  const hazard = std(kit, "l3_hazard", { color: 0xe0b422, roughness: 0.6 });
  const d = 0.8, z = wz + d / 2;
  g.add(box(kit, 1.3, 2.0, d, body, 0, 1.0, z));
  g.add(box(kit, 1.34, 0.12, d + 0.04, hazard, 0, 1.62, z));
  for (let i = 0; i < 4; i++) g.add(box(kit, 0.9, 0.05, 0.02, dark, 0, 0.35 + i * 0.12, wz + d + 0.01));
  // Cooling fins down both sides.
  for (let i = 0; i < 5; i++) {
    g.add(box(kit, 0.06, 1.5, 0.5, body, -0.7, 0.95, wz + 0.15 + i * 0.12 - 0.12));
    g.add(box(kit, 0.06, 1.5, 0.5, body, 0.7, 0.95, wz + 0.15 + i * 0.12 - 0.12));
  }
  const on = rng.next() < 0.7;
  const led = std(kit, on ? "l3_led_on" : "l3_led_off", on
    ? { color: 0x39ff88, emissive: 0x16c060, emissiveIntensity: 2.5 }
    : { color: 0xff3b18, emissive: 0xff2200, emissiveIntensity: 2.5 });
  g.add(box(kit, 0.08, 0.08, 0.03, led, 0.45, 1.35, wz + d + 0.01));
  // Heavy cables rising from the top into the ceiling.
  const cable = std(kit, "l3_cable", { color: 0x121212, roughness: 0.9 });
  for (const cx of [-0.35, 0, 0.35]) g.add(cyl(kit, 0.045, 1.0, cable, cx, 2.5, wz + 0.25, 6));
  g.add(stationSign(kit, rng, wz, rng.next() < 0.5 ? -1.2 : 1.2, 1.7));
  return { object: g, footprint: [[-0.4, z, 0.5], [0.4, z, 0.5]] };
}

function industrialFan(kit: DecorKit, _rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const frame = std(kit, "l3_fan_frame", { color: 0x3c4448, roughness: 0.5, metalness: 0.75 });
  const blade = std(kit, "l3_fan_blade", { color: 0x8a9296, roughness: 0.4, metalness: 0.7 });
  const z = wz + 0.55;
  g.add(box(kit, 0.9, 0.08, 0.6, frame, 0, 0.04, z));
  g.add(box(kit, 0.1, 0.9, 0.1, frame, -0.55, 0.5, z));
  g.add(box(kit, 0.1, 0.9, 0.1, frame, 0.55, 0.5, z));
  const ring = new THREE.Mesh(kit.geo("l3_fan_ring", () => new THREE.TorusGeometry(0.58, 0.06, 8, 24)), frame);
  ring.position.set(0, 1.05, z); g.add(ring);
  // Guard grille bars.
  for (let i = -2; i <= 2; i++) g.add(box(kit, 0.02, 1.1, 0.02, frame, i * 0.22, 1.05, z + 0.1));
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.05, z);
  rotor.add(cyl(kit, 0.1, 0.18, frame, 0, 0, 0, 10).rotateX(Math.PI / 2));
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(kit.geo("l3_fan_blade", () => new THREE.BoxGeometry(0.16, 0.5, 0.02).translate(0, 0.28, 0)), blade);
    b.rotation.set(0.35, 0, (i * Math.PI) / 2);
    rotor.add(b);
  }
  g.add(rotor);
  return { object: g, footprint: [[0, z, 0.6]], fans: [rotor] };
}

function breakerWall(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const grey = std(kit, "l3_panel", { color: 0x7d8580, roughness: 0.5, metalness: 0.55 });
  const dark = std(kit, "l3_vent", { color: 0x1b1f1d, roughness: 0.7, metalness: 0.5 });
  const count = 2 + rng.nextInt(0, 2);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.85;
    g.add(box(kit, 0.72, 1.0, 0.2, grey, x, 1.45, wz + 0.1));
    g.add(box(kit, 0.06, 0.24, 0.06, dark, x + 0.24, 1.45, wz + 0.23));
    const conduit = cyl(kit, 0.05, 1.05, grey, x, 2.47, wz + 0.08, 8);
    g.add(conduit);
  }
  g.add(stationSign(kit, rng, wz, 0, 0.75));
  return { object: g, footprint: [] };
}

function hotPipes(kit: DecorKit, rng: Rng, wz: number, cell: number): DecorPiece {
  const g = new THREE.Group();
  const copper = std(kit, "l3_copper", { color: 0x9c5a32, roughness: 0.35, metalness: 0.85, emissive: 0x2a0800, emissiveIntensity: 0.4 });
  const wheel = std(kit, "l3_valve", { color: 0xb3211a, roughness: 0.4, metalness: 0.6 });
  for (const [y, r] of [[2.35, 0.09], [2.62, 0.07]] as const) {
    const p = cyl(kit, r, cell, copper, 0, y, wz + 0.16, 10);
    p.rotation.z = Math.PI / 2; g.add(p);
  }
  const dropX = rng.nextRange(-1.2, 1.2);
  g.add(cyl(kit, 0.07, 2.2, copper, dropX, 1.25, wz + 0.16, 10));
  const w = new THREE.Mesh(kit.geo("l3_valve_wheel", () => new THREE.TorusGeometry(0.16, 0.03, 6, 14)), wheel);
  w.position.set(dropX, 1.2, wz + 0.3); g.add(w);
  return { object: g, footprint: [] };
}

function cableSpool(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const wood = std(kit, "l3_spool", { color: 0x7a5a36, roughness: 0.9 });
  const cable = std(kit, "l3_cable", { color: 0x121212, roughness: 0.9 });
  const x = rng.nextRange(-0.6, 0.6), z = wz + 0.75;
  const spool = new THREE.Group();
  spool.add(cyl(kit, 0.55, 0.06, wood, 0, -0.3, 0, 16));
  spool.add(cyl(kit, 0.55, 0.06, wood, 0, 0.3, 0, 16));
  spool.add(cyl(kit, 0.38, 0.56, cable, 0, 0, 0, 16));
  spool.rotation.x = Math.PI / 2;
  spool.position.set(x, 0.55, z);
  g.add(spool);
  // Loose cable snaking across the floor to the wall.
  const tube = new THREE.Mesh(kit.geo("l3_floor_cable", () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.04, 0), new THREE.Vector3(0.5, 0.04, -0.3), new THREE.Vector3(0.2, 0.04, -0.7), new THREE.Vector3(0.6, 0.04, -1.0), new THREE.Vector3(0.6, 0.6, -1.12),
  ]), 24, 0.035, 6)), cable);
  tube.position.set(x + 0.2, 0, z + 0.35);
  g.add(tube);
  return { object: g, footprint: [[x, z, 0.6]] };
}

export function electricalStationDecor(kit: DecorKit, rng: Rng, half: number, corridor: boolean): DecorPiece {
  const wz = -half;
  const roll = rng.next();
  // Corridors keep to wall-mounted fittings so they never get pinched.
  if (corridor) return roll < 0.55 ? hotPipes(kit, rng, wz, half * 2) : breakerWall(kit, rng, wz);
  if (roll < 0.3) return transformer(kit, rng, wz);
  if (roll < 0.5) return industrialFan(kit, rng, wz);
  if (roll < 0.68) return breakerWall(kit, rng, wz);
  if (roll < 0.84) return hotPipes(kit, rng, wz, half * 2);
  return cableSpool(kit, rng, wz);
}

// ---------------------------------------------------------------------------
// Level 4 — Abandoned Office
// ---------------------------------------------------------------------------

function vendingMachine(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const shell = std(kit, rng.next() < 0.5 ? "l4_vend_red" : "l4_vend_blue", rng.next() < 0.5
    ? { color: 0x8c1d1d, roughness: 0.4, metalness: 0.4 }
    : { color: 0x1f3f7a, roughness: 0.4, metalness: 0.4 });
  const front = canvasMat(kit, "l4_vend_front", 128, 256, (ctx) => {
    ctx.fillStyle = "#cfe8f0"; ctx.fillRect(0, 0, 128, 256);
    for (let row = 0; row < 5; row++) {
      ctx.fillStyle = "#6f7c80"; ctx.fillRect(0, 44 + row * 44, 128, 4);
      for (let col = 0; col < 5; col++) {
        const almond = (row + col) % 3 !== 0;
        ctx.fillStyle = almond ? "#f1ead2" : "#d8a22c";
        ctx.fillRect(8 + col * 24, 14 + row * 44, 14, 28);
        ctx.fillStyle = "#3a6ea5"; ctx.fillRect(8 + col * 24, 24 + row * 44, 14, 7);
      }
    }
  }, true);
  const d = 0.8, z = wz + d / 2;
  g.add(box(kit, 1.0, 1.95, d, shell, 0, 0.975, z));
  g.add(plane(kit, 0.62, 1.3, front, -0.12, 1.2, wz + d + 0.005));
  const dark = std(kit, "l4_vend_slot", { color: 0x111111, roughness: 0.6 });
  g.add(box(kit, 0.62, 0.18, 0.02, dark, -0.12, 0.3, wz + d + 0.01));
  g.add(box(kit, 0.16, 0.5, 0.02, dark, 0.36, 1.25, wz + d + 0.01));
  return { object: g, footprint: [[-0.25, z, 0.45], [0.25, z, 0.45]] };
}

function waterCooler(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const white = std(kit, "l4_cooler", { color: 0xe4e6e2, roughness: 0.5 });
  const jug = kit.mat("decor_l4_jug", () => new THREE.MeshStandardMaterial({ color: 0x6fb6e8, roughness: 0.1, transparent: true, opacity: 0.6 }));
  const x = rng.nextRange(-1, 1), z = wz + 0.3;
  g.add(box(kit, 0.34, 1.0, 0.34, white, x, 0.5, z));
  g.add(cyl(kit, 0.15, 0.45, jug, x, 1.24, z));
  return { object: g, footprint: [[x, z, 0.3]] };
}

function filingCabinets(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const grey = std(kit, "l4_cabinet", { color: 0x8d9296, roughness: 0.45, metalness: 0.55 });
  const handle = std(kit, "l4_handle", { color: 0x2b2d2f, roughness: 0.4, metalness: 0.8 });
  const count = 2 + rng.nextInt(0, 2);
  const d = 0.62;
  const footprint: [number, number, number][] = [];
  const open = rng.nextInt(0, count * 4);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.52;
    g.add(box(kit, 0.5, 1.32, d, grey, x, 0.66, wz + d / 2));
    for (let k = 0; k < 4; k++) {
      const pull = i * 4 + k === open ? 0.3 : 0;
      if (pull) g.add(box(kit, 0.44, 0.28, 0.3, grey, x, 0.2 + k * 0.31, wz + d + 0.14));
      g.add(box(kit, 0.16, 0.03, 0.03, handle, x, 0.24 + k * 0.31, wz + d + 0.02 + pull));
    }
    footprint.push([x, wz + d / 2, 0.36]);
  }
  return { object: g, footprint };
}

function deadPlant(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const pot = std(kit, "l4_pot", { color: 0x5e5048, roughness: 0.8 });
  const dry = std(kit, "l4_dry", { color: 0x6a5a34, roughness: 0.9 });
  const x = rng.next() < 0.5 ? -1.4 : 1.4, z = wz + 0.4;
  const potMesh = new THREE.Mesh(kit.geo("l4_pot", () => new THREE.CylinderGeometry(0.24, 0.18, 0.5, 12)), pot);
  potMesh.position.set(x, 0.25, z); g.add(potMesh);
  for (let i = 0; i < 5; i++) {
    const stalk = new THREE.Mesh(kit.geo("l4_stalk", () => new THREE.ConeGeometry(0.03, 0.8, 4)), dry);
    const a = (i / 5) * Math.PI * 2;
    stalk.position.set(x + Math.cos(a) * 0.08, 0.85, z + Math.sin(a) * 0.08);
    stalk.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4 - (i === 2 ? 0.9 : 0));
    g.add(stalk);
  }
  return { object: g, footprint: [[x, z, 0.3]] };
}

function photocopier(kit: DecorKit, _rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const shell = std(kit, "l4_copier", { color: 0xcfcfc8, roughness: 0.55 });
  const dark = std(kit, "l4_copier_top", { color: 0x3a3c3e, roughness: 0.5 });
  const paper = std(kit, "l4_paper", { color: 0xf2f2ee, roughness: 0.95 });
  const z = wz + 0.4;
  g.add(box(kit, 0.95, 0.95, 0.7, shell, 0, 0.475, z));
  g.add(box(kit, 0.95, 0.06, 0.7, dark, 0, 0.98, z));
  g.add(box(kit, 0.4, 0.05, 0.3, paper, 0.62, 0.7, z));
  g.add(box(kit, 0.3, 0.04, 0.2, paper, 0.1, 0.03, z + 0.55).rotateY(0.4));
  return { object: g, footprint: [[0, z, 0.55]] };
}

function rainWindow(kit: DecorKit, _rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  // Wiki: the "sky" outside is artificial and never changes — just rain on glass.
  const glass = canvasMat(kit, "l4_window", 256, 160, (ctx) => {
    const r = mulberry(4242);
    const grad = ctx.createLinearGradient(0, 0, 0, 160);
    grad.addColorStop(0, "#7d8790"); grad.addColorStop(1, "#aeb5b8");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = "rgba(90,98,105,0.55)";
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(r() * 256, r() * 70, 50 + r() * 50, 14 + r() * 10, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = "rgba(230,236,240,0.35)"; ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) { const x = r() * 256, y = r() * 160; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 8 + r() * 14); ctx.stroke(); }
  }, true);
  const frame = std(kit, "l4_window_frame", { color: 0x55595c, roughness: 0.5, metalness: 0.5 });
  g.add(plane(kit, 1.9, 1.2, glass, 0, 1.6, wz + 0.02));
  g.add(box(kit, 2.0, 0.07, 0.1, frame, 0, 2.23, wz + 0.05));
  g.add(box(kit, 2.0, 0.1, 0.2, frame, 0, 0.98, wz + 0.1));
  g.add(box(kit, 0.07, 1.3, 0.1, frame, -0.98, 1.6, wz + 0.05));
  g.add(box(kit, 0.07, 1.3, 0.1, frame, 0.98, 1.6, wz + 0.05));
  g.add(box(kit, 0.05, 1.2, 0.08, frame, 0, 1.6, wz + 0.05));
  return { object: g, footprint: [] };
}

function whiteboard(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const variant = rng.nextInt(0, 3);
  const mat = canvasMat(kit, `l4_board_${variant}`, 256, 144, (ctx) => {
    const r = mulberry(variant * 311 + 7);
    ctx.fillStyle = "#eef0ee"; ctx.fillRect(0, 0, 256, 144);
    ctx.strokeStyle = "rgba(40,70,140,0.35)"; ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(20 + r() * 40, 20 + i * 20);
      for (let k = 0; k < 6; k++) ctx.lineTo(40 + k * 30 + r() * 20, 20 + i * 20 + (r() - 0.5) * 6);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(170,40,40,0.4)"; ctx.strokeRect(150, 70, 80, 50);
  });
  const frame = std(kit, "l4_board_frame", { color: 0xa9adb0, roughness: 0.4, metalness: 0.6 });
  g.add(box(kit, 1.7, 1.0, 0.04, frame, 0, 1.55, wz + 0.02));
  g.add(plane(kit, 1.6, 0.9, mat, 0, 1.55, wz + 0.045));
  return { object: g, footprint: [] };
}

function stackedChairs(kit: DecorKit, rng: Rng, wz: number): DecorPiece {
  const g = new THREE.Group();
  const seat = std(kit, "l4_chair", { color: 0x2d3a46, roughness: 0.75 });
  const leg = std(kit, "l4_chair_leg", { color: 0x9aa0a4, roughness: 0.4, metalness: 0.8 });
  const x = rng.nextRange(-1, 1), z = wz + 0.45;
  const n = 3 + rng.nextInt(0, 3);
  for (let i = 0; i < n; i++) {
    const c = new THREE.Group();
    c.add(box(kit, 0.46, 0.05, 0.46, seat, 0, 0.46, 0));
    c.add(box(kit, 0.46, 0.4, 0.05, seat, 0, 0.7, -0.21));
    for (const lx of [-0.2, 0.2]) for (const lz of [-0.2, 0.2]) c.add(box(kit, 0.03, 0.46, 0.03, leg, lx, 0.23, lz));
    c.position.set(x, i * 0.09, z);
    c.rotation.y = (rng.next() - 0.5) * 0.12;
    g.add(c);
  }
  return { object: g, footprint: [[x, z, 0.4]] };
}

export function abandonedOfficeDecor(kit: DecorKit, rng: Rng, half: number, corridor: boolean): DecorPiece {
  const wz = -half;
  const roll = rng.next();
  if (corridor) return roll < 0.45 ? rainWindow(kit, rng, wz) : roll < 0.7 ? waterCooler(kit, rng, wz) : roll < 0.85 ? deadPlant(kit, rng, wz) : whiteboard(kit, rng, wz);
  if (roll < 0.14) return vendingMachine(kit, rng, wz);
  if (roll < 0.34) return rainWindow(kit, rng, wz);
  if (roll < 0.5) return filingCabinets(kit, rng, wz);
  if (roll < 0.6) return photocopier(kit, rng, wz);
  if (roll < 0.7) return waterCooler(kit, rng, wz);
  if (roll < 0.8) return deadPlant(kit, rng, wz);
  if (roll < 0.9) return whiteboard(kit, rng, wz);
  return stackedChairs(kit, rng, wz);
}

/** Pressed-in carpet marks where desks once stood (wiki: "indents throughout the carpeting"). */
export function carpetIndents(kit: DecorKit, rng: Rng): THREE.Object3D {
  const g = new THREE.Group();
  const mat = kit.mat("decor_l4_indent", () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
  const geo = kit.geo("decor_l4_indent", () => new THREE.PlaneGeometry(0.1, 0.1).rotateX(-Math.PI / 2));
  const w = rng.nextRange(1.2, 1.7), d = rng.nextRange(0.6, 0.8);
  const ox = rng.nextRange(-0.6, 0.6), oz = rng.nextRange(-0.6, 0.6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(ox + (sx * w) / 2, 0.006, oz + (sz * d) / 2);
    g.add(m);
  }
  g.rotation.y = rng.nextRange(-0.2, 0.2);
  return g;
}

// ---------------------------------------------------------------------------
// Poolrooms (Level 37)
// ---------------------------------------------------------------------------

function chrome(kit: DecorKit) {
  return std(kit, "pool_chrome", { color: 0xdfe6e8, roughness: 0.15, metalness: 1.0 });
}

/** A chrome pool ladder climbing out onto a dry deck (the deck is on the local -z side). */
export function poolLadder(kit: DecorKit, rng: Rng, half: number): DecorPiece {
  const g = new THREE.Group();
  const m = chrome(kit);
  const edge = -half, x = rng.nextRange(-1, 1), top = 0.9;
  const inLen = top - POOL_FLOOR_Y;
  for (const sx of [-0.25, 0.25]) {
    g.add(cyl(kit, 0.03, inLen, m, x + sx, POOL_FLOOR_Y + inLen / 2, edge + 0.2, 8));
    const over = cyl(kit, 0.03, 0.5, m, x + sx, top, edge - 0.05, 8);
    over.rotation.x = Math.PI / 2; g.add(over);
    g.add(cyl(kit, 0.03, top, m, x + sx, top / 2, edge - 0.3, 8));
  }
  for (let i = 0; i < 3; i++) g.add(box(kit, 0.5, 0.03, 0.08, m, x, POOL_FLOOR_Y + 0.2 + i * 0.25, edge + 0.2));
  return { object: g, footprint: [[x - 0.25, edge + 0.2, 0.08], [x + 0.25, edge + 0.2, 0.08]] };
}

/** Tiled steps rising out of the water to the wall, with a chrome handrail (both reference images). */
export function poolStairs(kit: DecorKit, _rng: Rng, half: number): DecorPiece {
  const g = new THREE.Group();
  const wz = -half, steps = 6, run = 0.36, rise = 0.3, width = 2.4;
  for (let i = 0; i < steps; i++) {
    const top = POOL_FLOOR_Y + (steps - i) * rise;
    const h = top - POOL_FLOOR_Y;
    const step = box(kit, width, h, run, kit.wallTile, 0, POOL_FLOOR_Y + h / 2, wz + run * (i + 0.5));
    g.add(step);
  }
  const m = chrome(kit);
  const railX = width / 2 - 0.1;
  const railLen = Math.hypot(steps * run, steps * rise);
  const rail = cyl(kit, 0.025, railLen, m, railX, POOL_FLOOR_Y + (steps * rise) / 2 + 0.9, wz + (steps * run) / 2, 8);
  rail.rotation.x = -Math.atan2(steps * run, steps * rise); // high end at the wall
  g.add(rail);
  g.add(cyl(kit, 0.025, 0.9, m, railX, POOL_FLOOR_Y + rise + 0.45, wz + steps * run - 0.1, 8));
  const footprint: [number, number, number][] = [];
  for (const sx of [-0.7, 0, 0.7]) for (const sz of [0.4, 1.3]) footprint.push([sx, wz + sz, 0.5]);
  return { object: g, footprint };
}

/** A tiled round pillar standing in open water. */
export function poolPillar(kit: DecorKit, height: number): DecorPiece {
  const g = new THREE.Group();
  const h = height - POOL_FLOOR_Y;
  const mesh = new THREE.Mesh(kit.geo(`pool_pillar_${h}`, () => {
    const geo = new THREE.CylinderGeometry(0.55, 0.55, h, 24, 1, true);
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    // Circumference ~3.5 m, height h: keep the 25 cm tiles square against the 4 m/4-repeat texture.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (3.46 / 4), uv.getY(i) * (h / 4));
    return geo;
  }), kit.wallTile);
  mesh.position.set(0, POOL_FLOOR_Y + h / 2, 0);
  g.add(mesh);
  return { object: g, footprint: [[0, 0, 0.62]] };
}

/** Slatted inlet grate on the wall, right at the waterline. */
export function poolWallVent(kit: DecorKit, rng: Rng, half: number): DecorPiece {
  const g = new THREE.Group();
  const dark = std(kit, "pool_vent", { color: 0x1f2a2a, roughness: 0.6, metalness: 0.4 });
  const m = chrome(kit);
  const wz = -half, x = rng.nextRange(-1.2, 1.2), y = rng.nextRange(-0.2, 0.35);
  g.add(box(kit, 0.7, 0.45, 0.03, dark, x, y, wz + 0.015));
  for (let i = 0; i < 5; i++) g.add(box(kit, 0.66, 0.03, 0.05, m, x, y - 0.18 + i * 0.09, wz + 0.04));
  return { object: g, footprint: [] };
}

/** Round drain grate on the pool floor. */
export function poolDrain(kit: DecorKit, rng: Rng): DecorPiece {
  const g = new THREE.Group();
  const mat = canvasMat(kit, "pool_drain", 64, 64, (ctx) => {
    ctx.fillStyle = "#1d2b2b"; ctx.beginPath(); ctx.arc(32, 32, 31, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#b9c4c4"; ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(6 + i * 10, 8); ctx.lineTo(6 + i * 10, 56); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(32, 32, 29, 0, Math.PI * 2); ctx.stroke();
  });
  (mat as THREE.MeshStandardMaterial).transparent = true;
  const d = plane(kit, 0.6, 0.6, mat, rng.nextRange(-1, 1), POOL_FLOOR_Y + 0.01, rng.nextRange(-1, 1));
  d.rotation.x = -Math.PI / 2;
  g.add(d);
  return { object: g, footprint: [] };
}

/** A faint slanted shaft of daylight falling through the missing ceiling. */
export function poolLightShaft(kit: DecorKit, rng: Rng): DecorPiece {
  const g = new THREE.Group();
  const mat = kit.mat("decor_pool_shaft", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, "rgba(255,250,225,0.0)");
      grad.addColorStop(0.25, "rgba(255,250,225,0.9)");
      grad.addColorStop(1, "rgba(255,250,225,0.0)");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 16, 128);
    }
    const map = new THREE.CanvasTexture(canvas);
    kit.track(map);
    return new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  });
  for (let i = 0; i < 2; i++) {
    const shaft = plane(kit, 1.1, 4.2, mat, rng.nextRange(-0.8, 0.8), 1.5, rng.nextRange(-0.8, 0.8));
    shaft.rotation.set(0, rng.nextRange(0, Math.PI), -0.45);
    g.add(shaft);
  }
  return { object: g, footprint: [] };
}

/** Tiny deterministic PRNG for canvas scribbles (visual only, never world state). */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
