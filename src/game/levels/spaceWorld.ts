/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 79's geometry. ProceduralMap hands every walkable cell of the station
 * grid to {@link SpaceWorld.createCell}, which builds it whole: deck plating,
 * wall panels (or glass, where spaceLayout says so), ceiling LED panels, the
 * automatic doors, and the hand-placed props of each room.
 *
 * Outer walls are double-sided on purpose. Through a window you can see other
 * modules of the station from outside, and they have to read as hull, not as
 * the inside of a room with its back walls culled away.
 *
 * What the director needs to touch later is exposed directly: terminal
 * screens by id (redrawn canvases), the station's mood lighting, and the sky
 * (see spaceSky.ts, owned by the director since it lives in the scene rather
 * than in a cell). Cells are built once, up front, and deterministically.
 */

import * as THREE from "three";
import type { DecorKit } from "../LevelDecor";
import type { DynamicLightSource } from "../LightPool";
import type { LightFixture } from "../ProceduralMap";
import { t } from "../../i18n";
import {
  ROOM_LABEL_KEY, SPACE_GRID, SPACE_SIGNS, SPACE_TERMINALS, SPACE_WALL_H, SpaceDoor, SpaceSide,
  SpaceTerminal, SpaceTerminalId, spaceDoorAt, spaceRegionAt, spaceRng, spaceWindowAt,
} from "./spaceLayout";

const CELL = 4;
const H = SPACE_WALL_H;
const BASE_LIGHT = 0xe4eeff;

export interface SpaceBuildEnv {
  kit: DecorKit;
  seed: number;
  registerLight(gx: number, gz: number, x: number, y: number, z: number, color: number, intensity: number, distance: number, decay?: number): DynamicLightSource;
  addObstacle(gx: number, gz: number, x: number, z: number, radius: number): void;
  pushFixture(fixture: LightFixture): void;
  /** The map's shared tube materials, so its flicker code and ours agree. */
  glassOn: THREE.MeshBasicMaterial;
  glassOff: THREE.Material;
}

export type ScreenTone = "idle" | "ok" | "warn" | "alert" | "dim";

export interface ScreenPage {
  title: string;
  lines: string[];
  tone: ScreenTone;
}

interface Piece { object: THREE.Object3D; footprint: [number, number, number][] }

interface PropSpec { x: number; z: number; yaw: number; y?: number; make: () => Piece; solid?: boolean }

interface DoorRt { door: SpaceDoor; x: number; z: number; leaves: THREE.Object3D[]; lamp: THREE.Mesh | null; open: number; wantOpen: boolean }

const SIDES: Record<SpaceSide, { dx: number; dz: number; yaw: number }> = {
  N: { dx: 0, dz: -1, yaw: 0 },
  S: { dx: 0, dz: 1, yaw: Math.PI },
  W: { dx: -1, dz: 0, yaw: Math.PI / 2 },
  E: { dx: 1, dz: 0, yaw: -Math.PI / 2 },
};

const TONES: Record<ScreenTone, { bg: string; fg: string; accent: string }> = {
  idle: { bg: "#03121a", fg: "#a8ecff", accent: "#3fb6d9" },
  ok: { bg: "#021407", fg: "#8dffab", accent: "#2fd35d" },
  warn: { bg: "#171002", fg: "#ffd98a", accent: "#e0a526" },
  alert: { bg: "#1a0303", fg: "#ff8a7a", accent: "#ff3b2a" },
  dim: { bg: "#010406", fg: "#2f4a57", accent: "#1d3642" },
};

class Screen {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private last = "";

  constructor(kit: DecorKit, id: string) {
    this.canvas.width = 512;
    this.canvas.height = 320;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    kit.track(this.texture);
    this.material = kit.mat(`sp_screen_${id}`, () => new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
  }

  draw(page: ScreenPage) {
    const key = `${page.tone}|${page.title}|${page.lines.join("\n")}`;
    if (key === this.last) return;
    this.last = key;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const c = TONES[page.tone];
    const { width: w, height: h } = this.canvas;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.accent;
    ctx.fillRect(0, 0, w, 42);
    ctx.fillStyle = c.bg;
    ctx.font = "bold 24px monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(page.title, 14, 22);
    ctx.fillStyle = c.fg;
    // Shrink the type until every line fits under the title bar.
    const size = Math.max(12, Math.min(24, Math.floor((h - 60) / Math.max(1, page.lines.length)) - 4));
    ctx.font = `${size}px monospace`;
    ctx.textBaseline = "top";
    page.lines.forEach((line, i) => ctx.fillText(line, 16, 52 + i * (size + 4)));
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    this.texture.needsUpdate = true;
  }
}

const cc = (gx: number, gz: number): [number, number] => [gx * CELL + CELL / 2, gz * CELL + CELL / 2];

export class SpaceWorld {
  private readonly env: SpaceBuildEnv;
  private readonly kit: DecorKit;
  private readonly wallMat: THREE.MeshStandardMaterial;
  private readonly floorMat: THREE.MeshStandardMaterial;
  private readonly ceilMat: THREE.MeshStandardMaterial;
  private readonly trimMat: THREE.MeshStandardMaterial;
  private readonly darkMat: THREE.MeshStandardMaterial;
  private readonly glassMat: THREE.MeshBasicMaterial;
  private readonly specsByCell = new Map<string, PropSpec[]>();
  private readonly screens = new Map<string, Screen>();
  private readonly doors: DoorRt[] = [];
  private readonly lights: { src: DynamicLightSource; color: number; fixture: LightFixture | null }[] = [];
  private readonly faulty: LightFixture[] = [];
  private readonly blinkers: { mesh: THREE.Mesh; next: number }[] = [];
  private readonly pulsers: THREE.MeshStandardMaterial[] = [];
  private mood = { color: BASE_LIGHT, scale: 1 };
  private clock = 0;

  /** The room seed (the wiring panel's order comes from it). */
  readonly seed: number;

  constructor(env: SpaceBuildEnv) {
    this.env = env;
    this.seed = env.seed;
    this.kit = env.kit;
    const kit = this.kit;
    const wallTex = this.panelTexture("wall", "#b7bec6", "#8d959e", 4, 2);
    this.wallMat = kit.mat("sp_wall", () => new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }));
    const floorTex = this.panelTexture("floor", "#40464e", "#23272c", 4, 4, true);
    this.floorMat = kit.mat("sp_floor", () => new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7, metalness: 0.5 }));
    const ceilTex = this.panelTexture("ceil", "#8f969f", "#6c737b", 3, 3);
    this.ceilMat = kit.mat("sp_ceil", () => new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.8, metalness: 0.2 }));
    this.trimMat = kit.mat("sp_trim", () => new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.5, metalness: 0.6 }));
    this.darkMat = kit.mat("sp_dark", () => new THREE.MeshStandardMaterial({ color: 0x181c20, roughness: 0.6, metalness: 0.4 }));
    this.glassMat = kit.mat("sp_glass", () => new THREE.MeshBasicMaterial({ color: 0x9ec9ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));

    const specs: PropSpec[] = [];
    this.authorProps(specs);
    for (const spec of specs) {
      const key = `${Math.floor(spec.x / CELL)},${Math.floor(spec.z / CELL)}`;
      const list = this.specsByCell.get(key) ?? [];
      list.push(spec);
      this.specsByCell.set(key, list);
    }
  }

  // -------------------------------------------------------------------------
  // What the director uses
  // -------------------------------------------------------------------------

  /** A terminal's (or the Navigation Room display's) screen; drawing is cheap when nothing changed. */
  screen(id: SpaceTerminalId | "navDisplay"): Screen {
    let s = this.screens.get(id);
    if (!s) {
      s = new Screen(this.kit, id);
      this.screens.set(id, s);
    }
    return s;
  }

  drawScreen(id: SpaceTerminalId | "navDisplay", page: ScreenPage) {
    this.screen(id).draw(page);
  }

  /** Tints (and scales) every station light, tube material included. `null` colour restores the cold white. */
  setMood(color: number | null, scale = 1) {
    const c = color ?? BASE_LIGHT;
    if (c === this.mood.color && scale === this.mood.scale) return;
    this.mood = { color: c, scale };
    for (const l of this.lights) this.applyMood(l);
    this.env.glassOn.color.setHex(color === null ? 0xfffef0 : c);
  }

  private applyMood(l: { src: DynamicLightSource; color: number; fixture: LightFixture | null }) {
    l.src.color = this.mood.color === BASE_LIGHT ? l.color : this.mood.color;
    const intensity = l.src.baseIntensity * this.mood.scale;
    if (l.fixture) l.fixture.intensity = intensity;
    l.src.intensity = intensity;
  }

  /** Starts a short flicker on some fixtures near (x, z) — or anywhere, with no position. */
  flickerBurst(chance: number) {
    for (const l of this.lights) {
      if (l.fixture && Math.random() < chance) l.fixture.flickerTimer = 0.15 + Math.random() * 0.6;
    }
  }

  update(delta: number, px: number, pz: number, onDoor: (x: number, z: number, opening: boolean) => void) {
    this.clock += delta;
    for (const d of this.doors) {
      const want = Math.hypot(px - d.x, pz - d.z) < 3.6;
      if (want !== d.wantOpen) {
        d.wantOpen = want;
        onDoor(d.x, d.z, want);
      }
      const target = want ? 1 : 0;
      if (Math.abs(d.open - target) > 0.001) {
        d.open += (target - d.open) * Math.min(1, delta * (want ? 6 : 3.5));
        d.leaves.forEach((leaf, i) => { leaf.position.x = (i === 0 ? -1 : 1) * (0.46 + 0.9 * d.open); });
        if (d.lamp) d.lamp.material = this.kit.mat(d.open > 0.5 ? "sp_led_green" : "sp_led_red", () => new THREE.MeshBasicMaterial({ color: d.open > 0.5 ? 0x3dff7a : 0xff3b2a }));
      }
    }
    // A handful of tired panels: cosmetic, local, never synced.
    for (const f of this.faulty) {
      if (f.flickerTimer <= 0 && Math.random() < delta * 0.12) f.flickerTimer = 0.2 + Math.random() * 0.9;
    }
    for (const b of this.blinkers) {
      if (this.clock < b.next) continue;
      b.next = this.clock + 0.3 + Math.random() * 2.4;
      b.mesh.visible = !b.mesh.visible;
    }
    const pulse = 1.4 + Math.sin(this.clock * 1.7) * 0.6;
    for (const m of this.pulsers) m.emissiveIntensity = pulse;
  }

  // -------------------------------------------------------------------------
  // Cells
  // -------------------------------------------------------------------------

  createCell(gx: number, gz: number): THREE.Group {
    const group = new THREE.Group();
    const key = `${gx},${gz}`;
    group.userData.aabb = new THREE.Box3(
      new THREE.Vector3(gx * CELL - 2.5, -0.5, gz * CELL - 2.5),
      new THREE.Vector3((gx + 1) * CELL + 2.5, H + 0.6, (gz + 1) * CELL + 2.5),
    );
    const region = spaceRegionAt(gx, gz);
    if (!region) return group;
    const kit = this.kit;
    const [px, pz] = cc(gx, gz);

    const floor = new THREE.Mesh(kit.geo("sp_floor", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2)), this.floorMat);
    floor.position.set(px, 0, pz);
    floor.receiveShadow = true;
    group.add(floor);
    const ceil = new THREE.Mesh(kit.geo("sp_ceil", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2)), this.ceilMat);
    ceil.position.set(px, H, pz);
    group.add(ceil);

    const solid = (x: number, z: number) => x < 0 || z < 0 || x >= SPACE_GRID || z >= SPACE_GRID || !spaceRegionAt(x, z);
    for (const side of ["N", "S", "W", "E"] as SpaceSide[]) {
      const s = SIDES[side];
      if (!solid(gx + s.dx, gz + s.dz)) continue;
      const holder = new THREE.Group();
      holder.position.set(px + s.dx * (CELL / 2), 0, pz + s.dz * (CELL / 2));
      holder.rotation.y = s.yaw;
      if (spaceWindowAt(gx, gz, side)) this.buildWindow(holder, region.id === "deck");
      else this.buildWall(holder, region.kind === "corridor");
      group.add(holder);
    }

    this.buildFixture(group, gx, gz, px, pz, region.id, region.kind === "corridor");
    const door = spaceDoorAt(gx, gz);
    if (door) this.buildDoor(group, door, px, pz);
    if (region.kind === "corridor" && !door) this.buildCorridorDressing(group, gx, gz, px, pz);
    for (const sign of SPACE_SIGNS) {
      if (sign.gx !== gx || sign.gz !== gz) continue;
      const text = sign.single
        ? `${t(ROOM_LABEL_KEY[sign.single])} ►`
        : `◄ ${t(ROOM_LABEL_KEY[sign.left!])}      ${t(ROOM_LABEL_KEY[sign.right!])} ►`;
      this.buildWallSign(group, px, pz, sign.side, text);
    }
    for (const spec of this.specsByCell.get(key) ?? []) this.buildSpec(group, spec);
    return group;
  }

  private buildSpec(group: THREE.Group, spec: PropSpec) {
    const piece = spec.make();
    const obj = piece.object;
    obj.position.set(spec.x, spec.y ?? 0, spec.z);
    obj.rotation.y = spec.yaw;
    group.add(obj);
    if (spec.solid === false) return;
    const c = Math.cos(spec.yaw), s = Math.sin(spec.yaw);
    for (const [lx, lz, r] of piece.footprint) {
      const ox = spec.x + lx * c + lz * s, oz = spec.z - lx * s + lz * c;
      this.env.addObstacle(Math.floor(ox / CELL), Math.floor(oz / CELL), ox, oz, r);
    }
  }

  /** A plane of wall texture `w` x `h` metres, with UVs scaled so panels keep their size. */
  private panel(w: number, h: number): THREE.PlaneGeometry {
    return this.kit.geo(`sp_panel_${w}_${h}`, () => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / CELL), uv.getY(i) * (h / H));
      return g;
    });
  }

  private box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.kit.geo(`sp_box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    parent.add(m);
    return m;
  }

  private buildWall(holder: THREE.Group, corridor: boolean) {
    const wall = new THREE.Mesh(this.panel(CELL, H), this.wallMat);
    wall.position.y = H / 2;
    holder.add(wall);
    this.box(holder, CELL, 0.14, 0.05, this.trimMat, 0, 0.07, 0.025);
    // A handrail/utility strip at hip height in corridors, a cable tray up top in rooms.
    if (corridor) this.box(holder, CELL, 0.06, 0.08, this.trimMat, 0, 1.0, 0.07);
    else this.box(holder, CELL, 0.05, 0.12, this.darkMat, 0, H - 0.25, 0.06);
  }

  private buildWindow(holder: THREE.Group, tall: boolean) {
    const sill = tall ? 0.3 : 0.85;
    const top = tall ? 3.1 : 2.75;
    const lower = new THREE.Mesh(this.panel(CELL, sill), this.wallMat);
    lower.position.y = sill / 2;
    holder.add(lower);
    const upper = new THREE.Mesh(this.panel(CELL, H - top), this.wallMat);
    upper.position.y = (top + H) / 2;
    holder.add(upper);
    const glass = new THREE.Mesh(this.kit.geo(`sp_glass_${top - sill}`, () => new THREE.PlaneGeometry(CELL, top - sill)), this.glassMat);
    glass.position.y = (sill + top) / 2;
    glass.renderOrder = 1;
    holder.add(glass);
    const span = top - sill;
    for (const x of [-1.95, 0, 1.95]) this.box(holder, 0.12, span, 0.16, this.trimMat, x, sill + span / 2, 0.02);
    this.box(holder, CELL, 0.07, 0.3, this.trimMat, 0, sill, 0.12);
    this.box(holder, CELL, 0.1, 0.16, this.trimMat, 0, top, 0.02);
  }

  private buildFixture(group: THREE.Group, gx: number, gz: number, px: number, pz: number, regionId: string, corridor: boolean) {
    const rng = spaceRng(this.env.seed + gx * 7919 + gz * 104729);
    const deck = regionId === "deck";
    const intensity = deck ? 1.0 : regionId === "nav" ? 1.5 : corridor ? 1.5 : 1.8;
    const fx = new THREE.Group();
    this.box(fx, corridor ? 0.5 : 1.3, 0.05, corridor ? 2.6 : 0.7, this.trimMat, 0, H - 0.025, 0);
    const tube = this.box(fx, corridor ? 0.34 : 1.14, 0.02, corridor ? 2.4 : 0.54, this.env.glassOn, 0, H - 0.06, 0);
    tube.name = "tube";
    fx.position.set(px, 0, pz);
    if (corridor) {
      const alongX = !!spaceRegionAt(gx - 1, gz) || !!spaceRegionAt(gx + 1, gz);
      if (alongX) fx.rotation.y = Math.PI / 2;
    }
    group.add(fx);
    const color = regionId === "eng" ? 0xdfe7ff : BASE_LIGHT;
    const light = this.env.registerLight(gx, gz, px, H - 0.25, pz, color, intensity, deck ? 8 : 10, 1.0);
    const fixture: LightFixture = { mesh: tube, light, intensity, flickerTimer: 0, gridX: gx, gridZ: gz };
    this.env.pushFixture(fixture);
    const entry = { src: light, color, fixture };
    this.lights.push(entry);
    this.applyMood(entry);
    if (rng() < (corridor ? 0.16 : 0.1)) this.faulty.push(fixture);
  }

  private buildCorridorDressing(group: THREE.Group, gx: number, gz: number, px: number, pz: number) {
    const alongX = !!spaceRegionAt(gx - 1, gz) || !!spaceRegionAt(gx + 1, gz);
    const across = !!spaceRegionAt(gx, gz - 1) || !!spaceRegionAt(gx, gz + 1);
    if (alongX && across) return; // a junction or a turn: keep it clear
    const d = new THREE.Group();
    d.position.set(px, 0, pz);
    if (!alongX) d.rotation.y = Math.PI / 2;
    const pipeMat = this.kit.mat("sp_pipe", () => new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.4, metalness: 0.7 }));
    const pipe = this.kit.geo("sp_pipe_run", () => new THREE.CylinderGeometry(0.07, 0.07, CELL, 10).rotateZ(Math.PI / 2));
    for (const [z, y] of [[-1.82, H - 0.32], [-1.82, H - 0.52], [1.84, H - 0.4]] as [number, number][]) {
      const p = new THREE.Mesh(pipe, pipeMat);
      p.position.set(0, y, z);
      d.add(p);
    }
    // Floor guide strips: the only colour in the corridors.
    const strip = this.kit.mat("sp_strip", () => new THREE.MeshBasicMaterial({ color: 0x4fb8e0 }));
    for (const z of [-1.55, 1.55]) this.box(d, CELL * 0.9, 0.01, 0.04, strip, 0, 0.006, z);
    group.add(d);
  }

  private label(text: string, w: number, h: number, fg = "#e8f4ff", bg = "#1b3a4d"): THREE.MeshBasicMaterial {
    return this.kit.mat(`sp_label_${text}_${w}_${h}_${fg}_${bg}`, () => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = Math.max(32, Math.round(512 * (h / w)));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = fg;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = fg;
      let size = Math.floor(c.height * 0.55);
      ctx.font = `bold ${size}px monospace`;
      while (ctx.measureText(text).width > c.width - 40 && size > 10) { size -= 2; ctx.font = `bold ${size}px monospace`; }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, c.width / 2, c.height / 2 + 2);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.kit.track(tex);
      return new THREE.MeshBasicMaterial({ map: tex });
    });
  }

  private buildWallSign(group: THREE.Group, px: number, pz: number, side: SpaceSide, text: string) {
    const s = SIDES[side];
    const sign = new THREE.Mesh(this.kit.geo("sp_sign_wall", () => new THREE.PlaneGeometry(2.6, 0.34)), this.label(text, 2.6, 0.34));
    sign.position.set(px + s.dx * (CELL / 2 - 0.03), 2.05, pz + s.dz * (CELL / 2 - 0.03));
    sign.rotation.y = s.yaw;
    group.add(sign);
  }

  private buildDoor(group: THREE.Group, door: SpaceDoor, px: number, pz: number) {
    const root = new THREE.Group();
    root.position.set(px, 0, pz);
    root.rotation.y = door.axis === "x" ? Math.PI / 2 : 0;
    const hazard = this.kit.mat("sp_hazard", () => new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.6 }));
    for (const side of [-1, 1]) {
      this.box(root, 1.1, H, 0.3, this.wallMat, side * 1.45, H / 2, 0);
      this.box(root, 0.06, 2.35, 0.32, hazard, side * 0.93, 1.175, 0);
    }
    this.box(root, 1.8, H - 2.35, 0.3, this.wallMat, 0, (2.35 + H) / 2, 0);
    this.box(root, 1.86, 0.06, 0.32, hazard, 0, 2.38, 0);
    const leafMat = this.kit.mat("sp_door_leaf", () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.45, metalness: 0.55 }));
    const leaves: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      this.box(leaf, 0.92, 2.35, 0.08, leafMat, 0, 1.175, 0);
      this.box(leaf, 0.06, 1.2, 0.1, this.trimMat, side * -0.4, 1.2, 0);
      const win = this.box(leaf, 0.3, 0.5, 0.09, this.glassMat, 0, 1.65, 0);
      win.renderOrder = 1;
      leaf.position.x = side * 0.46;
      root.add(leaf);
      leaves.push(leaf);
    }
    const lamp = this.box(root, 0.16, 0.06, 0.34, this.kit.mat("sp_led_red", () => new THREE.MeshBasicMaterial({ color: 0xff3b2a })), 0, 2.5, 0);
    for (const [face, roomKey] of [[-1, door.fromLow], [1, door.fromHigh]] as [number, typeof door.fromLow][]) {
      const sign = new THREE.Mesh(this.kit.geo("sp_sign_door", () => new THREE.PlaneGeometry(1.7, 0.3)), this.label(t(ROOM_LABEL_KEY[roomKey]), 1.7, 0.3));
      sign.position.set(0, 2.85, face * 0.16);
      if (face < 0) sign.rotation.y = Math.PI;
      root.add(sign);
    }
    group.add(root);
    const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
    for (const lx of [-1.75, -1.2, 1.2, 1.75]) this.env.addObstacle(door.gx, door.gz, px + lx * c, pz - lx * s, 0.3);
    this.doors.push({ door, x: px, z: pz, leaves, lamp, open: 0, wantOpen: false });
  }

  // -------------------------------------------------------------------------
  // Textures
  // -------------------------------------------------------------------------

  private panelTexture(key: string, base: string, seam: string, cols: number, rows: number, grating = false): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const rng = spaceRng(key.length * 977 + 13);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    // Grime and scuffs.
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rng() * 0.05})`;
      ctx.fillRect(rng() * 256, rng() * 256, 2 + rng() * 14, 1 + rng() * 6);
    }
    const cw = 256 / cols, ch = 256 / rows;
    ctx.strokeStyle = seam;
    ctx.lineWidth = 3;
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      ctx.strokeRect(x * cw + 1.5, y * ch + 1.5, cw - 3, ch - 3);
      if (grating) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        for (let k = 8; k < ch - 6; k += 7) ctx.fillRect(x * cw + 8, y * ch + k, cw - 16, 2);
      } else {
        ctx.fillStyle = seam;
        for (const [rx, ry] of [[6, 6], [cw - 8, 6], [6, ch - 8], [cw - 8, ch - 8]]) ctx.fillRect(x * cw + rx, y * ch + ry, 3, 3);
      }
    }
    if (key === "wall") {
      ctx.fillStyle = "rgba(40,90,120,0.55)";
      ctx.fillRect(0, 150, 256, 6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    this.kit.track(tex);
    return tex;
  }

  // -------------------------------------------------------------------------
  // Models (built facing +z: a terminal's screen faces +z at yaw 0)
  // -------------------------------------------------------------------------

  private terminalModel(term: SpaceTerminal, wide: boolean): Piece {
    const g = new THREE.Group();
    const w = wide ? 1.9 : 1.3;
    this.box(g, w, 0.82, 0.62, this.trimMat, 0, 0.41, 0);
    this.box(g, w + 0.06, 0.05, 0.7, this.darkMat, 0, 0.845, 0.02);
    // The slanted screen housing, and the screen itself.
    const head = new THREE.Group();
    head.position.set(0, 0.87, -0.12);
    head.rotation.x = -0.55;
    this.box(head, w - 0.1, 0.62, 0.06, this.darkMat, 0, 0.31, -0.03);
    const scr = new THREE.Mesh(this.kit.geo(`sp_screen_${w}`, () => new THREE.PlaneGeometry(w - 0.22, 0.52)), this.screen(term.id).material);
    scr.position.set(0, 0.31, 0.005);
    head.add(scr);
    g.add(head);
    // Nameplate and a row of small indicator lights along the front lip.
    const plate = new THREE.Mesh(this.kit.geo(`sp_plate_${w}`, () => new THREE.PlaneGeometry(w * 0.6, 0.12)), this.label(t(term.nameKey), w * 0.6, 0.12, "#a8ecff", "#0b1d27"));
    plate.position.set(0, 0.62, 0.312);
    g.add(plate);
    const ledOn = this.kit.mat("sp_led_blue", () => new THREE.MeshBasicMaterial({ color: 0x5fd0ff }));
    for (let i = 0; i < 5; i++) {
      const led = this.box(g, 0.05, 0.03, 0.05, ledOn, -w / 2 + 0.2 + i * 0.1, 0.88, 0.3);
      if (i % 2 === 0) this.blinkers.push({ mesh: led, next: i * 0.7 });
    }
    return { object: g, footprint: wide ? [[-0.55, 0, 0.45], [0.55, 0, 0.45]] : [[-0.32, 0, 0.42], [0.32, 0, 0.42]] };
  }

  private chair(): Piece {
    const g = new THREE.Group();
    const seat = this.kit.mat("sp_seat", () => new THREE.MeshStandardMaterial({ color: 0x3b4650, roughness: 0.8 }));
    this.box(g, 0.08, 0.42, 0.08, this.trimMat, 0, 0.21, 0);
    this.box(g, 0.56, 0.08, 0.52, seat, 0, 0.46, 0);
    this.box(g, 0.56, 0.62, 0.08, seat, 0, 0.8, 0.24);
    this.box(g, 0.6, 0.04, 0.6, this.trimMat, 0, 0.03, 0);
    return { object: g, footprint: [[0, 0, 0.32]] };
  }

  private desk(w = 1.6): Piece {
    const g = new THREE.Group();
    this.box(g, w, 0.05, 0.75, this.trimMat, 0, 0.74, 0);
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) this.box(g, 0.06, 0.72, 0.7, this.darkMat, x, 0.36, 0);
    const mon = this.box(g, 0.55, 0.36, 0.04, this.darkMat, -w / 4, 1.0, -0.2);
    mon.rotation.x = -0.1;
    const scr = this.box(g, 0.5, 0.3, 0.01, this.kit.mat("sp_dead_screen", () => new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.2, metalness: 0.3 })), -w / 4, 1.0, -0.175);
    scr.rotation.x = -0.1;
    const papers = this.kit.mat("sp_paper", () => new THREE.MeshStandardMaterial({ color: 0xd8d8cc, roughness: 1 }));
    this.box(g, 0.3, 0.01, 0.22, papers, w / 4, 0.77, 0.05, 0.3);
    return { object: g, footprint: [[-w / 4, 0, 0.45], [w / 4, 0, 0.45]] };
  }

  private rack(): Piece {
    const g = new THREE.Group();
    this.box(g, 0.7, 2.0, 0.9, this.darkMat, 0, 1.0, 0);
    const on = this.kit.mat("sp_led_green", () => new THREE.MeshBasicMaterial({ color: 0x3dff7a }));
    const amber = this.kit.mat("sp_led_amber", () => new THREE.MeshBasicMaterial({ color: 0xffb13d }));
    for (let r = 0; r < 7; r++) {
      this.box(g, 0.62, 0.02, 0.02, this.trimMat, 0, 0.3 + r * 0.24, 0.455);
      const led = this.box(g, 0.04, 0.03, 0.02, r % 3 === 0 ? amber : on, 0.24, 0.36 + r * 0.24, 0.46);
      this.blinkers.push({ mesh: led, next: r * 0.37 });
    }
    return { object: g, footprint: [[0, 0, 0.55]] };
  }

  private crate(size = 1.0): Piece {
    const g = new THREE.Group();
    const m = this.kit.mat("sp_crate", () => new THREE.MeshStandardMaterial({ color: 0x5d6a58, roughness: 0.85, metalness: 0.2 }));
    this.box(g, size, size * 0.8, size, m, 0, size * 0.4, 0);
    this.box(g, size + 0.02, 0.06, size + 0.02, this.trimMat, 0, size * 0.78, 0);
    this.box(g, size + 0.02, 0.06, size + 0.02, this.trimMat, 0, 0.03, 0);
    return { object: g, footprint: [[0, 0, size * 0.62]] };
  }

  private locker(): Piece {
    const g = new THREE.Group();
    const m = this.kit.mat("sp_locker", () => new THREE.MeshStandardMaterial({ color: 0x6c7c8a, roughness: 0.6, metalness: 0.5 }));
    for (const x of [-0.26, 0.26]) {
      this.box(g, 0.5, 2.0, 0.5, m, x, 1.0, 0);
      this.box(g, 0.3, 0.03, 0.01, this.trimMat, x, 1.7, 0.255);
      this.box(g, 0.3, 0.03, 0.01, this.trimMat, x, 1.6, 0.255);
    }
    return { object: g, footprint: [[0, 0, 0.55]] };
  }

  private bunk(): Piece {
    const g = new THREE.Group();
    const mat = this.kit.mat("sp_mattress", () => new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 0.95 }));
    for (const y of [0.45, 1.45]) {
      this.box(g, 2.0, 0.08, 0.9, this.trimMat, 0, y, 0);
      this.box(g, 1.9, 0.14, 0.82, mat, 0, y + 0.11, 0);
    }
    for (const x of [-0.97, 0.97]) for (const z of [-0.42, 0.42]) this.box(g, 0.05, 1.9, 0.05, this.trimMat, x, 0.95, z);
    return { object: g, footprint: [[-0.6, 0, 0.5], [0.6, 0, 0.5]] };
  }

  private table(): Piece {
    const g = new THREE.Group();
    this.box(g, 1.6, 0.05, 1.0, this.trimMat, 0, 0.74, 0);
    this.box(g, 0.14, 0.72, 0.14, this.darkMat, 0, 0.36, 0);
    const cup = this.kit.mat("sp_cup", () => new THREE.MeshStandardMaterial({ color: 0xd4dde4, roughness: 0.4 }));
    this.box(g, 0.08, 0.1, 0.08, cup, 0.4, 0.82, 0.2);
    this.box(g, 0.08, 0.1, 0.08, cup, -0.5, 0.82, -0.25);
    return { object: g, footprint: [[-0.45, 0, 0.55], [0.45, 0, 0.55]] };
  }

  private bench(): Piece {
    const g = new THREE.Group();
    const seat = this.kit.mat("sp_seat", () => new THREE.MeshStandardMaterial({ color: 0x3b4650, roughness: 0.8 }));
    this.box(g, 2.4, 0.08, 0.5, seat, 0, 0.45, 0);
    for (const x of [-1.0, 1.0]) this.box(g, 0.1, 0.42, 0.4, this.trimMat, x, 0.21, 0);
    return { object: g, footprint: [[-0.8, 0, 0.35], [0, 0, 0.35], [0.8, 0, 0.35]] };
  }

  private railing(len: number): Piece {
    const g = new THREE.Group();
    this.box(g, len, 0.06, 0.06, this.trimMat, 0, 1.0, 0);
    this.box(g, len, 0.04, 0.04, this.trimMat, 0, 0.55, 0);
    for (let x = -len / 2; x <= len / 2 + 0.01; x += 2) this.box(g, 0.05, 1.0, 0.05, this.trimMat, x, 0.5, 0);
    const fp: [number, number, number][] = [];
    for (let x = -len / 2 + 0.25; x <= len / 2; x += 0.5) fp.push([x, 0, 0.18]);
    return { object: g, footprint: fp };
  }

  private telescope(): Piece {
    const g = new THREE.Group();
    const white = this.kit.mat("sp_scope", () => new THREE.MeshStandardMaterial({ color: 0xe6eaee, roughness: 0.35, metalness: 0.3 }));
    for (const a of [0, 2.1, 4.2]) {
      const leg = this.box(g, 0.05, 1.3, 0.05, this.trimMat, Math.sin(a) * 0.35, 0.62, Math.cos(a) * 0.35);
      leg.rotation.set(Math.cos(a) * 0.28, 0, -Math.sin(a) * 0.28);
    }
    const tube = new THREE.Mesh(this.kit.geo("sp_scope_tube", () => new THREE.CylinderGeometry(0.16, 0.19, 1.6, 16)), white);
    tube.position.set(0, 1.45, -0.2);
    tube.rotation.x = -1.2;
    g.add(tube);
    return { object: g, footprint: [[0, 0, 0.5]] };
  }

  private reactor(): Piece {
    const g = new THREE.Group();
    const core = this.kit.mat("sp_core", () => new THREE.MeshStandardMaterial({ color: 0x2a6f8f, emissive: 0x3fc8ff, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.1 }));
    this.pulsers.push(core);
    const coreMesh = new THREE.Mesh(this.kit.geo("sp_core", () => new THREE.CylinderGeometry(0.55, 0.55, 2.4, 20)), core);
    coreMesh.position.y = 1.5;
    g.add(coreMesh);
    for (const y of [0.25, 2.8]) {
      const ring = new THREE.Mesh(this.kit.geo("sp_core_ring", () => new THREE.CylinderGeometry(1.1, 1.1, 0.5, 20)), this.trimMat);
      ring.position.y = y;
      g.add(ring);
    }
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) this.box(g, 0.14, 2.3, 0.14, this.trimMat, Math.sin(a) * 0.9, 1.5, Math.cos(a) * 0.9);
    return { object: g, footprint: [[0, 0, 1.3]] };
  }

  /** The main bus's junction box: a grey cabinet with the five coloured cables hanging out of it, unplugged. */
  private junctionBox(): Piece {
    const g = new THREE.Group();
    this.box(g, 1.6, 0.9, 0.22, this.trimMat, 0, 0.45, 0.11);
    this.box(g, 1.5, 0.08, 0.02, this.kit.mat("sp_hazard", () => new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.6 })), 0, 0.84, 0.225);
    const colors = [0xff4a3a, 0x3d8bff, 0xffd23d, 0x3ddc6a, 0xe8eef5];
    colors.forEach((c, i) => {
      const m = this.kit.mat(`sp_cable_${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
      const cable = this.box(g, 0.05, 0.55 + (i % 2) * 0.2, 0.05, m, -0.6 + i * 0.3, -0.1 - (i % 2) * 0.1, 0.2);
      cable.rotation.z = (i - 2) * 0.12;
    });
    return { object: g, footprint: [] };
  }

  private wallScreen(id: "navDisplay", w: number, h: number): Piece {
    const g = new THREE.Group();
    this.box(g, w + 0.16, h + 0.16, 0.08, this.darkMat, 0, 0, -0.04);
    const scr = new THREE.Mesh(this.kit.geo(`sp_wscreen_${w}_${h}`, () => new THREE.PlaneGeometry(w, h)), this.screen(id).material);
    scr.position.z = 0.005;
    g.add(scr);
    return { object: g, footprint: [] };
  }

  private chart(): Piece {
    const g = new THREE.Group();
    const mat = this.kit.mat("sp_chart", () => {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 256;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#0b1822";
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = "rgba(120,190,230,0.35)";
      for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke(); }
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(512, i * 64); ctx.stroke(); }
      const rng = spaceRng(4242);
      ctx.fillStyle = "#cfe8ff";
      for (let i = 0; i < 120; i++) ctx.fillRect(rng() * 512, rng() * 256, 2, 2);
      // Object A: the hole, circled. Object B: the planet, circled and crossed out by hand.
      ctx.strokeStyle = "#ff9a3d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(230, 130, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(230, 130, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff9a3d"; ctx.font = "bold 18px monospace"; ctx.fillText("A", 262, 110);
      ctx.strokeStyle = "#5fd0ff";
      ctx.beginPath(); ctx.arc(300, 100, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#5fd0ff"; ctx.fillText("B ?", 320, 92);
      ctx.strokeStyle = "#ff4a3a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(284, 84); ctx.lineTo(316, 116); ctx.moveTo(316, 84); ctx.lineTo(284, 116); ctx.stroke();
      ctx.fillStyle = "#ff4a3a"; ctx.font = "14px monospace";
      ctx.fillText(t("space.scr.chart"), 250, 200);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.kit.track(tex);
      return new THREE.MeshBasicMaterial({ map: tex });
    });
    const m = new THREE.Mesh(this.kit.geo("sp_chart_plane", () => new THREE.PlaneGeometry(2.2, 1.1)), mat);
    g.add(m);
    return { object: g, footprint: [] };
  }

  // -------------------------------------------------------------------------
  // Authored rooms (world metres; see the cell ranges in spaceLayout.ts)
  // -------------------------------------------------------------------------

  private authorProps(specs: PropSpec[]) {
    const add = (x: number, z: number, yaw: number, make: () => Piece, extra: Partial<PropSpec> = {}) => specs.push({ x, z, yaw, make, ...extra });
    const S = Math.PI, W = Math.PI / 2, E = -Math.PI / 2;

    // Terminals (and the helm's wider body).
    for (const term of SPACE_TERMINALS) add(term.x, term.z, term.yaw, () => this.terminalModel(term, term.id === "helm"));

    // Dock (spawn): lockers of suits nobody came back for, a bench, crates.
    add(10.5, 56.5, 0, () => this.locker());
    add(12.0, 56.5, 0, () => this.locker());
    add(18.0, 67.3, S, () => this.bench());
    add(18.6, 57.6, 0.3, () => this.crate(0.9));
    add(10.4, 66.8, 0, () => this.crate(1.1));

    // Astronomy lab: the telescope at the glass, desks, the hand-marked chart.
    add(23.8, 38.8, 0.2, () => this.telescope());
    add(30.8, 45.0, E, () => this.desk());
    add(29.6, 45.0, E, () => this.chair());
    add(20.0, 51.2, S, () => this.desk(1.8));
    add(20.0, 50.0, S, () => this.chair());
    add(31.94, 40.5, E, () => this.chart(), { y: 1.7, solid: false });
    add(16.5, 44.0, 1.1, () => this.chair());

    // Navigation Room: a chair at each console, the captain's chair behind the helm.
    // (A chair faces its local -z: yaw 0 sits it looking north, at a console.)
    add(58, 41.6, 0, () => this.chair());
    add(58, 48.0, 0, () => this.chair());
    add(44.06, 44.0, W, () => this.wallScreen("navDisplay", 3.2, 1.8), { y: 1.9, solid: false });
    add(71.2, 48.5, E, () => this.rack());
    add(71.2, 50.3, E, () => this.rack());
    add(45.2, 50.8, 0.4, () => this.crate(0.8));

    // Communications: racks of receivers, a desk.
    add(86.0, 36.7, 0, () => this.rack());
    add(88.0, 36.7, 0, () => this.rack());
    add(101.5, 36.7, 0, () => this.rack());
    add(84.8, 46.0, W, () => this.desk());
    add(86.0, 46.0, W, () => this.chair());

    // Crew quarters: bunks, lockers, a table still set for a meal.
    add(35.2, 78.0, E, () => this.bunk());
    add(35.2, 84.0, E, () => this.bunk());
    add(18.0, 72.6, 0, () => this.locker());
    add(19.4, 72.6, 0, () => this.locker());
    add(24.0, 81.0, 0, () => this.table());
    add(24.0, 82.2, 0, () => this.chair());
    add(24.0, 79.8, S, () => this.chair());
    add(22.6, 81.0, 0.8, () => this.chair());

    // Systems analysis: two rows of racks.
    for (const x of [46.5, 48, 49.5]) { add(x, 79.5, 0, () => this.rack()); add(x, 84.5, S, () => this.rack()); }
    for (const x of [58.5, 60, 61.5, 63]) add(x, 79.5, 0, () => this.rack());
    add(66.8, 84.0, E, () => this.desk());

    // Engineering: the reactor column, crates, and the power bus's junction box over its terminal.
    add(80.0, 68.03, 0, () => this.junctionBox(), { y: 1.55, solid: false });
    add(86.0, 77.0, 0, () => this.reactor());
    add(93.8, 82.4, 0.2, () => this.crate(1.0));
    add(92.6, 70.0, 0, () => this.crate(0.8));
    add(78.0, 83.3, S, () => this.rack());
    add(79.5, 83.3, S, () => this.rack());

    // Cargo: stacks of crates.
    add(111.5, 54.5, 0.1, () => this.crate(1.2));
    add(113.2, 54.2, -0.2, () => this.crate(1.0));
    add(117.0, 56.0, 0.4, () => this.crate(1.3));
    add(117.5, 69.5, 0.0, () => this.crate(1.2));
    add(111.0, 70.5, 0.3, () => this.crate(1.0));
    add(118.6, 63.5, 0.1, () => this.crate(0.9));

    // Observation deck: a rail along the glass, benches facing it.
    for (let x = 66; x <= 94; x += 4) add(x, 13.0, 0, () => this.railing(4));
    add(70.0, 18.2, 0, () => this.bench());
    add(80.0, 18.8, 0, () => this.bench());
    add(90.0, 18.2, 0, () => this.bench());
  }
}
