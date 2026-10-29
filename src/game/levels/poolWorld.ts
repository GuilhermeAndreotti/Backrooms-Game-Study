/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Geometry of the Poolrooms' Parts 2 and 3 (see poolLayout.ts for the plan).
 * ProceduralMap hands every authored cell to {@link PoolWorld.createCell},
 * which builds it whole: the tiled floor or pool bottom at its height, the
 * faces down to lower neighbours and up the walls, a roof dipping under the
 * water where the plan says so, the water surface, and the cell's fittings —
 * ladders, lane ropes, levers, lamps, painted warnings, the gate out of Part
 * 1, the door down to Part 3, and the exit landing's shutters and doors.
 * Over Part 3's drowned corridors it also lays the hall floor on their roof.
 *
 * Cells are built once and kept; what moves later (the gate, the door, the
 * shutters, the levers, failing lamps) is animated by {@link PoolWorld.update}.
 */

import * as THREE from "three";
import type { DecorKit } from "../LevelDecor";
import type { DynamicLightSource } from "../LightPool";
import { t } from "../../i18n";
import { createPoolTileMaterial, createWallTileMaterial, createWaterMaterial, POOL_FLOOR_Y } from "../Water";
import {
  POOL_CELL, POOL_DEEP_DOOR, POOL_GATE, POOL_LADDERS, POOL_LAMPS, POOL_LEVERS, POOL_SHUTTER_WHEEL, POOL_SIGNS, POOL_STATION_EXIT, POOL_TOWN_EXIT,
  PoolCell, PoolLampKind,
  poolCellAt, poolPartAt,
} from "./poolLayout";

const CELL = POOL_CELL;
const WALL_TOP = 24;
/** Where Part 2's slide ends: just above its water. */
const P2_SLIDE_END = -0.1;

export interface PoolBuildEnv {
  kit: DecorKit;
  seed: number;
  registerLight(gx: number, gz: number, x: number, y: number, z: number, color: number, intensity: number, distance: number, decay?: number): DynamicLightSource;
  /** Part 1's cells: solid, or the height of their floor. */
  part1Floor(gx: number, gz: number): number | null;
  /** Level 79's white station door, local to a cell centre (door on the north edge, floor at y = 0). */
  stationDoor(): THREE.Group;
  /** Level 94's door onto daylight, in the north wall of (gx, gz), on a floor at `floorY`. */
  townDoor(group: THREE.Group, gx: number, gz: number, posX: number, floorY: number): void;
}

/** What lies across one edge of a cell (`floor`/`ceil` are meaningless for a wall). */
interface Side { wall: boolean; floor: number; ceil: number }
const WALL: Side = { wall: true, floor: 0, ceil: Infinity };

const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

const LAMPS: Record<PoolLampKind, { color: number; intensity: number; distance: number; drop: number }> = {
  // Part 2's high hall lamps: few, cold, far apart.
  hall: { color: 0xcfe7dc, intensity: 1.7, distance: 30, drop: 9.5 },
  gallery: { color: 0xe2f0e4, intensity: 1.0, distance: 15, drop: 3.1 },
  deck: { color: 0x96d2c9, intensity: 0.85, distance: 13, drop: 2.7 },
  under: { color: 0x2fd0c0, intensity: 1.5, distance: 12, drop: 0.25 },
  pocket: { color: 0xa8d4ff, intensity: 0.8, distance: 9, drop: 3 },
  emergency: { color: 0xff3a22, intensity: 0.75, distance: 10, drop: 2.6 },
};

interface Mover { object: THREE.Object3D; closedY: number; openY: number; open: number; want: () => boolean }

export class PoolWorld {
  private readonly env: PoolBuildEnv;
  private readonly kit: DecorKit;
  private readonly tile: Record<2 | 3, THREE.MeshStandardMaterial>;
  private readonly wall: Record<2 | 3, THREE.MeshStandardMaterial>;
  private readonly water: Record<2 | 3, THREE.Material>;
  private readonly coping: THREE.MeshStandardMaterial;
  private readonly hazard: THREE.MeshStandardMaterial;
  private readonly metal: THREE.MeshStandardMaterial;
  private readonly rust: THREE.MeshStandardMaterial;
  private readonly glow = new Map<number, THREE.MeshBasicMaterial>();
  private readonly movers: Mover[] = [];
  /** Each lever's arm (pulled: swung down) and its lamp. */
  private readonly levers = new Map<number, { arm: THREE.Object3D; lamp: THREE.MeshBasicMaterial }>();
  private pulled: ReadonlySet<number> = new Set();
  private readonly flicker: { src: DynamicLightSource; base: number; next: number; off: boolean }[] = [];
  private clock = 0;
  private gateOpen = false;
  private exitOpen = false;

  constructor(env: PoolBuildEnv) {
    this.env = env;
    this.kit = env.kit;
    const k = this.kit;
    this.tile = {
      // As bright and clean as Part 1's halls.
      2: k.mat("pw_tile_2", () => createPoolTileMaterial(false)),
      3: k.mat("pw_tile_3", () => createPoolTileMaterial(false, 0xb3e2d6)),
    };
    this.wall = {
      2: k.mat("pw_wall_2", () => createWallTileMaterial()),
      3: k.mat("pw_wall_3", () => createWallTileMaterial(0.4)),
    };
    this.water = {
      2: k.mat("pw_water_2", () => createWaterMaterial("shallow")),
      3: k.mat("pw_water_3", () => createWaterMaterial("deep")),
    };
    this.coping = k.mat("pw_coping", () => new THREE.MeshStandardMaterial({ color: 0xd8d6c6, roughness: 0.55 }));
    this.hazard = k.mat("pw_hazard", () => {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 8;
      const g = c.getContext("2d")!;
      g.fillStyle = "#1a1a16"; g.fillRect(0, 0, 64, 8);
      g.fillStyle = "#c9a227";
      for (let x = -8; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x + 8, 0); g.lineTo(x + 16, 0); g.lineTo(x + 8, 8); g.fill(); }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(6, 1);
      tex.colorSpace = THREE.SRGBColorSpace;
      k.track(tex);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    });
    this.metal = k.mat("pw_metal", () => new THREE.MeshStandardMaterial({ color: 0x9aa3a6, metalness: 0.7, roughness: 0.35 }));
    this.rust = k.mat("pw_rust", () => new THREE.MeshStandardMaterial({ color: 0x4f3a2c, metalness: 0.5, roughness: 0.75 }));
  }

  setGateOpen(open: boolean) { this.gateOpen = open; }
  setLevers(pulled: ReadonlySet<number>) {
    this.pulled = pulled;
    for (const [i, l] of this.levers) l.lamp.color.setHex(pulled.has(i) ? 0x3dff8a : 0xff3a22);
  }
  setExitOpen(open: boolean) { this.exitOpen = open; }

  // ---------------------------------------------------------------------
  // Cells
  // ---------------------------------------------------------------------

  createCell(gx: number, gz: number): THREE.Group {
    const group = new THREE.Group();
    const cell = poolCellAt(gx, gz);
    if (!cell) return group;
    const part = cell.part;
    const x = gx * CELL + CELL / 2, z = gz * CELL + CELL / 2;
    let lowest = cell.water !== null ? Math.min(cell.floor, cell.water) : cell.floor;

    // Floor: the stair's steps, or one tiled plane at the cell's height.
    if (cell.stair) {
      this.buildStair(group, cell, x, z);
    } else {
      const floor = new THREE.Mesh(this.kit.geo("pw_floor", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2)), this.tile[part]);
      floor.position.set(x, cell.floor, z);
      floor.receiveShadow = true;
      group.add(floor);
    }

    // Edges: walls up to the haze, faces down to lower neighbours, the roof's sides.
    const floorAtEdge = cell.stair ? Math.min(cell.stair.from, cell.stair.to) : cell.floor;
    for (const [dx, dz] of DIRS) {
      const side = this.side(gx + dx, gz + dz, -dx, -dz);
      if (side.wall) {
        const top = Number.isFinite(cell.ceil) ? cell.ceil : WALL_TOP;
        this.face(group, x, z, dx, dz, floorAtEdge, top, this.surfaceFor(part, floorAtEdge, top), true);
        continue;
      }
      lowest = Math.min(lowest, side.floor);
      if (side.floor < floorAtEdge - 0.02 && !cell.stair) {
        this.face(group, x, z, dx, dz, side.floor, cell.floor, this.tile[part], false);
        if (cell.water === null && cell.floor - side.floor > 0.25) this.edgeTrim(group, x, z, dx, dz, cell);
      }
      if (Number.isFinite(cell.ceil) && side.ceil > cell.ceil + 0.01 && side.floor < (cell.deck ?? Infinity) - 0.01) {
        // The block over a drowned corridor, seen from the open water beside it (up to the hall's floor, if any).
        this.face(group, x, z, dx, dz, cell.ceil, Math.min(side.ceil, cell.deck ?? WALL_TOP), this.wall[part], false);
      }
    }

    if (cell.deck !== undefined) {
      // The hall over a drowned corridor: its floor, and the walls rising from it.
      const top = new THREE.Mesh(this.kit.geo("pw_floor", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2)), this.tile[part]);
      top.position.set(x, cell.deck, z);
      group.add(top);
      for (const [dx, dz] of DIRS) {
        if (this.side(gx + dx, gz + dz, -dx, -dz).wall) this.face(group, x, z, dx, dz, cell.deck, WALL_TOP, this.wall[part], true);
      }
    }

    if (Number.isFinite(cell.ceil)) {
      const roof = new THREE.Mesh(this.kit.geo("pw_roof", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2)), this.tile[part]);
      roof.position.set(x, cell.ceil, z);
      group.add(roof);
    }

    if (cell.water !== null) {
      const surface = new THREE.Mesh(this.kit.geo("pw_water", () => new THREE.PlaneGeometry(CELL, CELL, 8, 8).rotateX(-Math.PI / 2)), this.water[part]);
      surface.position.set(x, cell.water, z);
      surface.renderOrder = 1;
      group.add(surface);
    }

    this.dress(group, gx, gz, cell, x, z);

    group.userData.aabb = new THREE.Box3(
      new THREE.Vector3(gx * CELL, lowest - 0.5, gz * CELL),
      new THREE.Vector3((gx + 1) * CELL, WALL_TOP + 0.5, (gz + 1) * CELL),
    );
    return group;
  }

  /**
   * The neighbour across an edge, as seen from the cell on its other side
   * (`bx`, `bz` point back at that cell — a stair's height depends on which
   * edge you meet it at).
   */
  private side(gx: number, gz: number, bx: number, bz: number): Side {
    const n = poolCellAt(gx, gz);
    if (n) {
      let floor = n.floor;
      if (n.stair) {
        const along = n.stair.dx * bx + n.stair.dz * bz;
        floor = along > 0 ? n.stair.to : along < 0 ? n.stair.from : Math.min(n.stair.from, n.stair.to);
      }
      return { wall: false, floor, ceil: n.ceil };
    }
    if (poolPartAt(gx, gz) === 1) {
      const floor = this.env.part1Floor(gx, gz);
      if (floor !== null) return { wall: false, floor, ceil: Infinity };
    }
    return WALL;
  }

  /** Below the waterline the walls are pool tile; above it, the tall cream wall tile. */
  private surfaceFor(part: 2 | 3, from: number, to: number): THREE.Material {
    return to - from > 3 ? this.wall[part] : this.tile[part];
  }

  /**
   * A tiled face on the edge (dx, dz) of the cell centred at (x, z), from
   * `y0` to `y1`. `inward` faces it into this cell (a wall), otherwise out
   * toward the neighbour (the side of a raised block).
   */
  private face(group: THREE.Group, x: number, z: number, dx: number, dz: number, y0: number, y1: number, mat: THREE.Material, inward: boolean) {
    const h = Math.round((y1 - y0) * 20) / 20;
    if (h <= 0.01) return;
    const geo = this.kit.geo(`pw_face_${h}`, () => {
      const g = new THREE.PlaneGeometry(CELL, h);
      // Keep the tiles square: the textures repeat 4x over a full 4 m side.
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (h / CELL));
      return g;
    });
    const mesh = new THREE.Mesh(geo, mat);
    const s = inward ? -1 : 1;
    mesh.position.set(x + (dx * CELL) / 2, y0 + h / 2, z + (dz * CELL) / 2);
    mesh.rotation.y = Math.atan2(dx * s, dz * s);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /** The rounded coping along a raised edge — with a hazard stripe on a catwalk's. */
  private edgeTrim(group: THREE.Group, x: number, z: number, dx: number, dz: number, cell: PoolCell) {
    const along = dx === 0;
    const lip = new THREE.Mesh(
      this.kit.geo(`pw_lip_${along ? "x" : "z"}`, () => along ? new THREE.BoxGeometry(CELL, 0.07, 0.22) : new THREE.BoxGeometry(0.22, 0.07, CELL)),
      cell.floor >= 2 ? this.hazard : this.coping,
    );
    lip.position.set(x + dx * (CELL / 2 - 0.11), cell.floor + 0.035, z + dz * (CELL / 2 - 0.11));
    group.add(lip);
  }

  private buildStair(group: THREE.Group, cell: PoolCell, x: number, z: number) {
    const s = cell.stair!;
    const steps = 5;
    const run = CELL / steps;
    const base = Math.min(s.from, s.to) - 0.6;
    const alongX = s.dx !== 0;
    for (let k = 1; k <= steps; k++) {
      const top = s.from + ((s.to - s.from) * k) / steps;
      const h = Math.round((top - base) * 100) / 100;
      const geo = this.kit.geo(`pw_step_${alongX ? "x" : "z"}_${h}`, () => alongX ? new THREE.BoxGeometry(run, h, CELL) : new THREE.BoxGeometry(CELL, h, run));
      const step = new THREE.Mesh(geo, this.tile[cell.part]);
      const off = -CELL / 2 + run * (k - 0.5);
      step.position.set(x + s.dx * off, base + h / 2, z + s.dz * off);
      step.receiveShadow = true;
      group.add(step);
      const nose = new THREE.Mesh(this.kit.geo(`pw_nose_${alongX ? "x" : "z"}`, () => alongX ? new THREE.BoxGeometry(0.05, 0.04, CELL) : new THREE.BoxGeometry(CELL, 0.04, 0.05)), this.hazard);
      nose.position.set(x + s.dx * (off - run / 2 * Math.sign(s.to - s.from || 1)), top + 0.02, z + s.dz * (off - run / 2 * Math.sign(s.to - s.from || 1)));
      group.add(nose);
    }
  }

  // ---------------------------------------------------------------------
  // Fittings
  // ---------------------------------------------------------------------

  private dress(group: THREE.Group, gx: number, gz: number, cell: PoolCell, x: number, z: number) {
    for (const l of POOL_LADDERS) if (l.x === gx && l.z === gz) this.buildLadder(group, x, z, l.dx, l.dz, cell.floor, l.top);
    for (const [lx, lz, kind] of POOL_LAMPS) if (lx === gx && lz === gz) this.buildLamp(group, gx, gz, cell, x, z, kind);
    for (const [sx, sz, side, key] of POOL_SIGNS) if (sx === gx && sz === gz) this.buildSign(group, x, z, cell.floor, side, t(key));

    if (cell.kind === "block" && cell.floor >= 2.5 && cell.floor < 2.9) this.buildLifeguardChair(group, x, z, cell.floor);
    if (cell.part === 2 && cell.kind === "floor" && gz >= 14 && gz <= 24 && gz % 2 === 1) this.buildLaneRope(group, x, z, cell.water!);
    if (cell.part === 2 && cell.kind === "block" && gx === 42 && cell.floor < 0.5) this.buildStartingBlock(group, x, z, cell.floor, gz);
    if (gx === 66 && gz === 28) this.buildSlide(group, x, z, cell.floor);
    if (gx === 58 && gz === 57) this.buildSunkenChair(group, x, z, cell.floor);
    if (cell.part === 3 && cell.kind === "deck" && poolCellAt(gx, gz - 1) === undefined && poolPartAt(gx, gz - 1) !== 1) this.buildWallPipe(group, x, z, cell.floor);
    POOL_LEVERS.forEach(([lx, lz], i) => { if (lx === gx && lz === gz) this.buildLever(group, i, x, z, cell.floor); });
    if (gx === POOL_DEEP_DOOR.x && gz === POOL_DEEP_DOOR.z) this.buildDeepDoor(group, x, z, cell.floor);
    if (gx === POOL_GATE.x && gz === POOL_GATE.z) this.buildGate(group, x, z);
    if (gx === POOL_STATION_EXIT.x && gz === POOL_STATION_EXIT.z) {
      const door = this.env.stationDoor();
      door.position.set(x, cell.floor, z);
      group.add(door);
      this.buildShutter(group, x, z, cell.floor);
    }
    if (gx === POOL_TOWN_EXIT.x && gz === POOL_TOWN_EXIT.z) {
      this.env.townDoor(group, gx, gz, x, cell.floor);
      this.buildShutter(group, x, z, cell.floor);
    }
    if (gx === POOL_SHUTTER_WHEEL.x && gz === POOL_SHUTTER_WHEEL.z) this.buildShutterWheel(group, x, z, cell.floor);
    // Drains in the floor of the hall, here and there.
    if ((cell.kind === "floor" || cell.kind === "deep") && ((gx * 7 + gz * 13 + this.env.seed) % 11 === 0)) this.buildDrain(group, x, z, cell.floor);
  }

  private buildLadder(group: THREE.Group, x: number, z: number, dx: number, dz: number, from: number, top: number) {
    const ex = x + dx * (CELL / 2 - 0.08), ez = z + dz * (CELL / 2 - 0.08);
    const height = top + 1.0 - from;
    const railGeo = this.kit.geo(`pw_ladder_rail_${height.toFixed(2)}`, () => new THREE.CylinderGeometry(0.035, 0.035, height, 8));
    const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
    for (const s of [-0.38, 0.38]) {
      const rail = new THREE.Mesh(railGeo, this.metal);
      rail.position.set(ex + px * s, from + height / 2, ez + pz * s);
      group.add(rail);
    }
    const rungGeo = this.kit.geo(`pw_rung_${dx !== 0 ? "z" : "x"}`, () => dx !== 0 ? new THREE.BoxGeometry(0.05, 0.04, 0.76) : new THREE.BoxGeometry(0.76, 0.04, 0.05));
    for (let y = from + 0.3; y < top; y += 0.32) {
      const rung = new THREE.Mesh(rungGeo, this.metal);
      rung.position.set(ex, y, ez);
      group.add(rung);
    }
  }

  private lampGlow(color: number): THREE.MeshBasicMaterial {
    let m = this.glow.get(color);
    if (!m) {
      m = this.kit.mat(`pw_glow_${color}`, () => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      this.glow.set(color, m);
    }
    return m;
  }

  private buildLamp(group: THREE.Group, gx: number, gz: number, cell: PoolCell, x: number, z: number, kind: PoolLampKind) {
    const spec = LAMPS[kind];
    const base = kind === "under" ? cell.floor : kind === "pocket" ? (cell.water ?? cell.floor) : cell.floor;
    const y = base + spec.drop;
    const src = this.env.registerLight(gx, gz, x, y, z, spec.color, spec.intensity, spec.distance, 1);
    const glass = this.lampGlow(spec.color);
    if (kind === "under") {
      const housing = new THREE.Mesh(this.kit.geo("pw_under_housing", () => new THREE.CylinderGeometry(0.32, 0.36, 0.12, 16)), this.metal);
      housing.position.set(x, cell.floor + 0.06, z);
      const lens = new THREE.Mesh(this.kit.geo("pw_under_lens", () => new THREE.CircleGeometry(0.26, 16).rotateX(-Math.PI / 2)), glass);
      lens.position.set(x, cell.floor + 0.125, z);
      group.add(housing, lens);
    } else {
      const shade = new THREE.Mesh(this.kit.geo("pw_shade", () => new THREE.CylinderGeometry(0.18, 0.55, 0.35, 14, 1, true)), this.rust);
      shade.position.set(x, y + 0.2, z);
      const bulb = new THREE.Mesh(this.kit.geo("pw_bulb", () => new THREE.SphereGeometry(0.13, 10, 8)), glass);
      bulb.position.set(x, y + 0.05, z);
      const cable = new THREE.Mesh(this.kit.geo("pw_cable", () => new THREE.CylinderGeometry(0.012, 0.012, 1, 4)), this.rust);
      const len = WALL_TOP - (y + 0.35);
      cable.scale.y = len;
      cable.position.set(x, y + 0.35 + len / 2, z);
      group.add(shade, bulb, cable);
    }
    // Some of the hall's lamps are dying: they gutter out and come back.
    if ((kind === "hall" || kind === "deck" || kind === "emergency") && (gx * 31 + gz * 17) % 3 === 0) {
      this.flicker.push({ src, base: spec.intensity, next: 2 + ((gx * 13 + gz) % 7), off: false });
    }
  }

  private buildSign(group: THREE.Group, x: number, z: number, floor: number, side: "N" | "S" | "E" | "W", text: string) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 160;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 512, 160);
    // Painted by hand, in a hurry, with whatever was red.
    g.fillStyle = "rgba(120, 18, 12, 0.88)";
    g.font = "bold 58px 'Courier New', monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if (g.measureText(`${line} ${w}`).width > 480 && line) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    lines.push(line);
    lines.forEach((l, i) => {
      g.save();
      g.translate(256, 80 + (i - (lines.length - 1) / 2) * 60);
      g.rotate((i % 2 ? 1 : -1) * 0.025);
      g.fillText(l, 0, 0);
      g.restore();
    });
    for (let i = 0; i < 40; i++) g.fillRect(140 + ((i * 37) % 240), 110 + ((i * 53) % 40), 2, 6 + (i % 5) * 3); // drips
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.kit.track(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false });
    const sign = new THREE.Mesh(this.kit.geo("pw_sign", () => new THREE.PlaneGeometry(3.2, 1)), mat);
    const [dx, dz] = side === "N" ? [0, -1] : side === "S" ? [0, 1] : side === "W" ? [-1, 0] : [1, 0];
    sign.position.set(x + dx * (CELL / 2 - 0.02), floor + 1.9, z + dz * (CELL / 2 - 0.02));
    sign.rotation.y = Math.atan2(-dx, -dz);
    group.add(sign);
  }

  private buildLifeguardChair(group: THREE.Group, x: number, z: number, top: number) {
    const white = this.coping;
    const post = this.kit.geo("pw_chair_post", () => new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8));
    for (const [px, pz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const p = new THREE.Mesh(post, white);
      p.position.set(x + px, top + 0.5, z + pz);
      group.add(p);
    }
    const seat = new THREE.Mesh(this.kit.geo("pw_chair_seat", () => new THREE.BoxGeometry(1.2, 0.08, 0.8)), white);
    seat.position.set(x, top + 0.55, z);
    const back = new THREE.Mesh(this.kit.geo("pw_chair_back", () => new THREE.BoxGeometry(1.2, 0.9, 0.08)), white);
    back.position.set(x, top + 1.0, z - 0.4);
    const pole = new THREE.Mesh(this.kit.geo("pw_umbrella_pole", () => new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6)), this.metal);
    pole.position.set(x + 0.7, top + 1.2, z - 0.5);
    const canopy = new THREE.Mesh(
      this.kit.geo("pw_umbrella", () => new THREE.ConeGeometry(1.3, 0.5, 10, 1, true)),
      this.kit.mat("pw_umbrella_mat", () => new THREE.MeshStandardMaterial({ color: 0x8a3a30, roughness: 0.9, side: THREE.DoubleSide })),
    );
    canopy.position.set(x + 0.7, top + 2.5, z - 0.5);
    canopy.rotation.z = 0.25; // broken, hanging off its pole
    group.add(seat, back, pole, canopy);
  }

  private buildLaneRope(group: THREE.Group, x: number, z: number, water: number) {
    const rope = new THREE.Mesh(this.kit.geo("pw_rope", () => new THREE.CylinderGeometry(0.02, 0.02, CELL, 5).rotateZ(Math.PI / 2)), this.metal);
    rope.position.set(x, water + 0.02, z);
    group.add(rope);
    const floatGeo = this.kit.geo("pw_float", () => new THREE.CylinderGeometry(0.07, 0.07, 0.28, 8).rotateZ(Math.PI / 2));
    const floatMat = this.kit.mat("pw_float_mat", () => new THREE.MeshStandardMaterial({ color: 0x8c2a24, roughness: 0.6 }));
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(floatGeo, i % 2 ? floatMat : this.coping);
      f.position.set(x - CELL / 2 + 0.34 + i * 0.66, water + 0.03, z);
      group.add(f);
    }
  }

  private buildStartingBlock(group: THREE.Group, x: number, z: number, top: number, gz: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d8d6c6"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#1d3c4a"; g.font = "bold 46px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String((gz - 13) >> 1 || 1), 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.kit.track(tex);
    const plate = new THREE.Mesh(this.kit.geo("pw_lane_plate", () => new THREE.PlaneGeometry(0.5, 0.5)), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    plate.position.set(x + CELL / 2 + 0.01, top - 0.35, z);
    plate.rotation.y = Math.PI / 2;
    group.add(plate);
  }

  private buildSlide(group: THREE.Group, x: number, z: number, top: number) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x + 1.6, top + 0.4, z - 1.6),
      new THREE.Vector3(x + 3.8, top - 0.6, z - 3.4),
      new THREE.Vector3(x + 5.5, top - 2.0, z - 2.2),
      new THREE.Vector3(x + 6.2, top - 3.0, z - 4.6),
      new THREE.Vector3(x + 5.0, P2_SLIDE_END, z - 6.5),
    ]);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.55, 12, false),
      this.kit.mat("pw_slide", () => new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.4, side: THREE.DoubleSide })),
    );
    group.add(tube);
  }

  private buildSunkenChair(group: THREE.Group, x: number, z: number, floor: number) {
    const frame = new THREE.Group();
    const post = this.kit.geo("pw_sunk_post", () => new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6));
    for (const [px, pz] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]]) {
      const p = new THREE.Mesh(post, this.rust);
      p.position.set(px, 1.1, pz);
      frame.add(p);
    }
    const seat = new THREE.Mesh(this.kit.geo("pw_chair_seat", () => new THREE.BoxGeometry(1.2, 0.08, 0.8)), this.rust);
    seat.position.y = 2.2;
    frame.add(seat);
    frame.position.set(x + 0.4, floor, z - 0.3);
    frame.rotation.set(0.35, 0.6, 0.2); // keeled over on the platform
    group.add(frame);
  }

  private buildWallPipe(group: THREE.Group, x: number, z: number, floor: number) {
    const pipe = new THREE.Mesh(this.kit.geo("pw_pipe", () => new THREE.CylinderGeometry(0.3, 0.3, CELL, 12).rotateZ(Math.PI / 2)), this.rust);
    pipe.position.set(x, floor + 2.4, z - CELL / 2 + 0.4);
    const band = new THREE.Mesh(this.kit.geo("pw_pipe_band", () => new THREE.CylinderGeometry(0.33, 0.33, 0.12, 12).rotateZ(Math.PI / 2)), this.metal);
    band.position.set(x - 1.2, floor + 2.4, z - CELL / 2 + 0.4);
    group.add(pipe, band);
  }

  private buildDrain(group: THREE.Group, x: number, z: number, floor: number) {
    const drain = new THREE.Mesh(
      this.kit.geo("pw_drain", () => new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2)),
      this.kit.mat("pw_drain_mat", () => new THREE.MeshStandardMaterial({ color: 0x15191a, metalness: 0.6, roughness: 0.6 })),
    );
    drain.position.set(x + 0.7, floor + 0.01, z - 0.4);
    group.add(drain);
  }

  /** A pump-control post with a long lever; its lamp goes from red to green once pulled. */
  private buildLever(group: THREE.Group, index: number, x: number, z: number, floor: number) {
    const post = new THREE.Mesh(this.kit.geo("pw_lever_post", () => new THREE.BoxGeometry(0.5, 1.3, 0.4)), this.kit.mat("pw_lever_post", () => new THREE.MeshStandardMaterial({ color: 0x3b5a63, metalness: 0.5, roughness: 0.5 })));
    post.position.set(x, floor + 0.65, z);
    const pivot = new THREE.Group();
    pivot.position.set(x, floor + 1.1, z + 0.22);
    const arm = new THREE.Mesh(this.kit.geo("pw_lever_arm", () => new THREE.CylinderGeometry(0.04, 0.04, 0.9, 8).translate(0, 0.45, 0)), this.metal);
    const grip = new THREE.Mesh(this.kit.geo("pw_lever_grip", () => new THREE.SphereGeometry(0.08, 10, 8).translate(0, 0.9, 0)), this.kit.mat("pw_lever_grip", () => new THREE.MeshStandardMaterial({ color: 0xc23a22, roughness: 0.4 })));
    pivot.add(arm, grip);
    pivot.rotation.x = this.pulled.has(index) ? 1.9 : 0.35;
    const lamp = this.kit.mat(`pw_lever_lamp_${index}`, () => new THREE.MeshBasicMaterial({ color: 0xff3a22, toneMapped: false }));
    lamp.color.setHex(this.pulled.has(index) ? 0x3dff8a : 0xff3a22);
    const bulb = new THREE.Mesh(this.kit.geo("pw_lever_lamp", () => new THREE.SphereGeometry(0.07, 8, 6)), lamp);
    bulb.position.set(x, floor + 1.38, z);
    group.add(post, pivot, bulb);
    this.levers.set(index, { arm: pivot, lamp });
  }

  /** A heavy steel door across the high corridor down to Part 3; it rises once all three levers are pulled. */
  private buildDeepDoor(group: THREE.Group, x: number, z: number, floor: number) {
    const door = new THREE.Group();
    const slab = new THREE.Mesh(this.kit.geo("pw_deep_door", () => new THREE.BoxGeometry(CELL - 0.1, 3.4, 0.25)), this.kit.mat("pw_deep_door", () => new THREE.MeshStandardMaterial({ color: 0x55616a, metalness: 0.6, roughness: 0.45 })));
    slab.position.y = 1.7;
    door.add(slab);
    for (const y of [0.6, 1.7, 2.8]) {
      const rib = new THREE.Mesh(this.kit.geo("pw_deep_rib", () => new THREE.BoxGeometry(CELL - 0.2, 0.12, 0.32)), this.hazard);
      rib.position.y = y;
      door.add(rib);
    }
    door.position.set(x, floor, z - CELL / 2 + 0.2);
    group.add(door);
    this.movers.push({ object: door, closedY: floor, openY: floor + 3.3, open: this.pulled.size >= POOL_LEVERS.length ? 1 : 0, want: () => this.pulled.size >= POOL_LEVERS.length });
  }

  /** Part 1's drained gate: a heavy grate that lifts once the halls are drained. */
  private buildGate(group: THREE.Group, x: number, z: number) {
    const grate = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const bar = new THREE.Mesh(this.kit.geo("pw_gate_bar", () => new THREE.BoxGeometry(0.08, 3.6, 0.08)), this.rust);
      bar.position.set(-CELL / 2 + 0.06, 1.8, -CELL / 2 + 0.2 + i * 0.33);
      grate.add(bar);
    }
    for (const y of [0.3, 1.8, 3.4]) {
      const beam = new THREE.Mesh(this.kit.geo("pw_gate_beam", () => new THREE.BoxGeometry(0.12, 0.14, CELL)), this.rust);
      beam.position.set(-CELL / 2 + 0.06, y, 0);
      grate.add(beam);
    }
    grate.position.set(x, POOL_FLOOR_Y, z);
    group.add(grate);
    this.movers.push({ object: grate, closedY: POOL_FLOOR_Y, openY: POOL_FLOOR_Y + 3.4, open: this.gateOpen ? 1 : 0, want: () => this.gateOpen });
  }

  /** A corrugated shutter across the nook's mouth (its south edge), rolled up when the exit opens. */
  private buildShutter(group: THREE.Group, x: number, z: number, floor: number) {
    const shutter = new THREE.Group();
    const slat = this.kit.geo("pw_slat", () => new THREE.BoxGeometry(CELL - 0.1, 0.18, 0.06));
    const mat = this.kit.mat("pw_shutter", () => new THREE.MeshStandardMaterial({ color: 0x6f7a7c, metalness: 0.6, roughness: 0.5 }));
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Mesh(slat, mat);
      s.position.set(0, 0.1 + i * 0.19, 0);
      s.rotation.x = i % 2 ? 0.08 : -0.08;
      shutter.add(s);
    }
    shutter.position.set(x, floor, z + CELL / 2 - 0.05);
    group.add(shutter);
    this.movers.push({ object: shutter, closedY: floor, openY: floor + 2.9, open: this.exitOpen ? 1 : 0, want: () => this.exitOpen });
  }

  /** The big wheel that rolls the landing's shutters up. */
  private buildShutterWheel(group: THREE.Group, x: number, z: number, floor: number) {
    const wheel = new THREE.Mesh(this.kit.geo("pw_wheel", () => new THREE.TorusGeometry(0.42, 0.06, 8, 20)), this.kit.mat("pw_wheel_mat", () => new THREE.MeshStandardMaterial({ color: 0xc23a22, metalness: 0.5, roughness: 0.4 })));
    wheel.position.set(x - CELL / 2 + 0.2, floor + 1.3, z);
    wheel.rotation.y = Math.PI / 2;
    const hub = new THREE.Mesh(this.kit.geo("pw_wheel_hub", () => new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8).rotateZ(Math.PI / 2)), this.metal);
    hub.position.set(x - CELL / 2 + 0.1, floor + 1.3, z);
    group.add(wheel, hub);
    this.wheel = wheel;
  }
  private wheel: THREE.Mesh | null = null;

  // ---------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------

  /** Gate, door, shutters, levers, failing lamps. */
  update(delta: number) {
    this.clock += delta;
    for (const m of this.movers) this.slide(m, m.want(), delta, 0.45);
    if (this.wheel && this.exitOpen) this.wheel.rotation.x = Math.min(this.wheel.rotation.x + delta * 3, Math.PI * 4);
    for (const [i, l] of this.levers) {
      const want = this.pulled.has(i) ? 1.9 : 0.35;
      l.arm.rotation.x += (want - l.arm.rotation.x) * Math.min(1, delta * 6);
    }
    for (const f of this.flicker) {
      f.next -= delta;
      if (f.next > 0) continue;
      f.off = !f.off;
      f.src.intensity = f.off ? f.base * 0.05 : f.base;
      f.next = f.off ? 0.05 + Math.random() * 0.4 : 3 + Math.random() * 9;
    }
  }

  private slide(m: Mover, open: boolean, delta: number, rate: number) {
    const target = open ? 1 : 0;
    if (m.open === target) return;
    m.open = open ? Math.min(1, m.open + delta * rate) : Math.max(0, m.open - delta * rate);
    const k = m.open * m.open * (3 - 2 * m.open);
    m.object.position.y = m.closedY + (m.openY - m.closedY) * k;
  }
}
