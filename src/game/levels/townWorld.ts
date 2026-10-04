/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94's geometry. Unlike the station or the party venue, nothing here is
 * built per cell: the level is mostly open air with long views (the town
 * square, the hills, a castle on the horizon), so streaming cells in and out
 * at 20 m would show. Instead everything is built once, up front and
 * deterministically, and every static piece is merged into one mesh per
 * material per area (town, hills, castle) — a few dozen draw calls for the
 * whole level. ProceduralMap's cells stay empty.
 *
 * What the director needs to change later stays a separate object and is
 * exposed directly: the three gates, the street lamps and lit windows, the
 * clock's hands and hatch, the clock parts lying around town, the pieces of
 * the town's model, and the throne room's door.
 *
 * Collision is the map's: solid cells for buildings and hillsides, and
 * obstacle circles for everything thinner (house walls with their doorways,
 * cars, furniture, columns). Gates block their whole cell through
 * {@link TownWorld.isBlocked}.
 *
 * Every UV here is in metres; each texture's `repeat` carries its own tile
 * size, which is what lets merged geometry keep its tiling.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { DecorKit } from "../LevelDecor";
import type { DynamicLightSource } from "../LightPool";
import { t } from "../../i18n";
import {
  CASTLE_FOOTPRINT, CASTLE_ROOMS, CLOCK_FACE_Y, CLOCK_HATCH, CLOCK_PARTS, ClockPart, KING_THRONE, MODEL_PIECES, MODEL_SCALE, MODEL_SLOTS, MODEL_TABLE,
  ModelPieceId, PART_SPOTS, PUZZLE_GATE, STAY_CHAIR, STAY_HOUSE, TOWN_BARRICADE, TOWN_CELL, TOWN_EXIT, TOWN_FOOTPRINT, TOWN_GRID, TOWN_LOTS, TOWN_STREETS, TOWN_TOWER,
  TownLot, TownSide, VALLEY_PATH, cellCenter, modelPoint, partSpot, townCellAt, townGroundHeight, townLot, townRng,
} from "./townLayout";

const CELL = TOWN_CELL;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FLOOR_H = 3.2;
const ROOM_H: Record<string, number> = { entrance: 7, animRoom: 6, corridor: 4, throne: 11, gate: 5.2, inner: 4.6, exit: 6.2 };

export interface TownBuildEnv {
  kit: DecorKit;
  seed: number;
  registerLight(gx: number, gz: number, x: number, y: number, z: number, color: number, intensity: number, distance: number, decay?: number): DynamicLightSource;
  addObstacle(gx: number, gz: number, x: number, z: number, radius: number): { radius: number };
}

export type TownGate = "barricade" | "puzzle" | "exit";

interface Lamp { head: THREE.Mesh; light: DynamicLightSource; level: number }
interface HouseLights { mat: THREE.MeshStandardMaterial; light: DynamicLightSource | null }

const SIDES: Record<TownSide, { dx: number; dz: number }> = {
  N: { dx: 0, dz: -1 }, S: { dx: 0, dz: 1 }, W: { dx: -1, dz: 0 }, E: { dx: 1, dz: 0 },
};

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const shade = (c: number, k: number) => {
  const col = new THREE.Color(c);
  col.multiplyScalar(k);
  return `#${col.getHexString()}`;
};

/**
 * Collects static meshes and merges them into one mesh per material.
 * `userData.worldUV` on a mesh replaces its UVs with world x/z (metres), so
 * ground tiles seamlessly across every cell it was laid on.
 */
class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  addTree(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.dynamic) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      let src = o.geometry as THREE.BufferGeometry;
      src = src.index ? src.toNonIndexed() : src.clone();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", src.getAttribute("position"));
      g.setAttribute("normal", src.getAttribute("normal") ?? new THREE.BufferAttribute(new Float32Array(src.getAttribute("position").count * 3), 3));
      g.setAttribute("uv", src.getAttribute("uv") ?? new THREE.BufferAttribute(new Float32Array(src.getAttribute("position").count * 2), 2));
      if (!src.getAttribute("normal")) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      if (o.userData.worldUV) {
        const pos = g.getAttribute("position");
        const uv = g.getAttribute("uv");
        for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
      }
      src.dispose();
      let list = this.parts.get(mat);
      if (!list) { list = []; this.parts.set(mat, list); }
      list.push(g);
    });
  }

  flush(into: THREE.Group, kit: DecorKit, name: string) {
    let i = 0;
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      // Registered with the kit so the map disposes it with everything else.
      const geo = kit.geo(`town_merged_${name}_${i++}`, () => merged);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `town_${name}`;
      into.add(mesh);
    }
    this.parts.clear();
  }
}

export class TownWorld {
  /** Everything visible: merged static areas plus the dynamic objects. Added to the scene by the director. */
  readonly root = new THREE.Group();
  readonly seed: number;
  private readonly env: TownBuildEnv;
  private readonly kit: DecorKit;
  private readonly textures = new Map<string, THREE.CanvasTexture>();

  // Gates
  private readonly gateOpen: Record<TownGate, boolean> = { barricade: false, puzzle: false, exit: false };
  private barricade!: THREE.Group;
  private portcullis!: THREE.Group;
  private exitLeaves: THREE.Object3D[] = [];
  private gateAnim: Record<TownGate, number> = { barricade: 0, puzzle: 0, exit: 0 };

  // Lights
  readonly lamps: Lamp[] = [];
  readonly houses = new Map<string, HouseLights>();
  private readonly castleLights: { src: DynamicLightSource; base: number }[] = [];
  private kingLight!: DynamicLightSource;
  private exitLight!: DynamicLightSource;
  private lampOn!: THREE.MeshStandardMaterial;
  private lampOff!: THREE.MeshStandardMaterial;
  private innerWindow!: THREE.MeshStandardMaterial;

  // The clock
  readonly minuteHands: THREE.Object3D[] = [];
  readonly hourHands: THREE.Object3D[] = [];
  private readonly hatchParts = new Map<ClockPart, THREE.Object3D>();
  private readonly parts = new Map<ClockPart, THREE.Object3D>();
  private clockGlow!: THREE.MeshStandardMaterial;
  private readonly spin = new THREE.Quaternion();

  // The model
  private readonly modelPieces = new Map<ModelPieceId, THREE.Object3D>();
  private readonly modelSlot: Record<ModelPieceId, number> = { house: 0, car: 0, clock: 0 };
  private readonly gateBulbs: THREE.Mesh[] = [];
  private bulbOn!: THREE.Material;
  private bulbOff!: THREE.Material;

  // Animated bits
  private projector!: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; next: number; frame: number };
  private readonly flags: THREE.Object3D[] = [];
  private readonly glows: THREE.Sprite[] = [];
  private clock = 0;

  constructor(env: TownBuildEnv) {
    this.env = env;
    this.kit = env.kit;
    this.seed = env.seed;
    this.root.name = "oldTown";
    this.initShared();

    const town = new THREE.Group();
    this.buildTownGround(town);
    for (const l of TOWN_LOTS) this.buildLot(town, l);
    this.buildTower(town);
    this.buildStreetFurniture(town);
    this.flush(town, "town");

    const hills = new THREE.Group();
    this.buildTerrain(hills);
    this.buildValley(hills);
    this.flush(hills, "hills");

    const castle = new THREE.Group();
    this.buildCastleShell(castle);
    this.buildCastleRooms(castle);
    this.buildEntrance(castle);
    this.buildAnimationRoom(castle);
    this.buildThroneRoom(castle);
    this.flush(castle, "castle");

    this.buildGates();
    this.buildParts();
  }

  // -------------------------------------------------------------------------
  // What the director uses
  // -------------------------------------------------------------------------

  /** The map's kit (the director builds its figures through it, so they're disposed with the map). */
  get kitRef(): DecorKit {
    return this.kit;
  }

  /** Whether a gate fills cell (gx, gz) right now. */
  isBlocked(gx: number, gz: number): boolean {
    if (gx === TOWN_BARRICADE.gx && gz === TOWN_BARRICADE.gz) return !this.gateOpen.barricade;
    if (gx === PUZZLE_GATE.gx && gz === PUZZLE_GATE.gz) return !this.gateOpen.puzzle;
    if (gx === TOWN_EXIT.gx && gz === TOWN_EXIT.gz) return !this.gateOpen.exit;
    return false;
  }

  setGate(gate: TownGate, open: boolean) {
    this.gateOpen[gate] = open;
  }

  isGateOpen(gate: TownGate): boolean {
    return this.gateOpen[gate];
  }

  /** A street lamp: 0 off, 1 on (anything between flickers it dim). */
  setLamp(index: number, level: number) {
    const lamp = this.lamps[index];
    if (!lamp || lamp.level === level) return;
    lamp.level = level;
    lamp.head.material = level > 0.3 ? this.lampOn : this.lampOff;
    lamp.light.intensity = lamp.light.baseIntensity * level;
  }

  /** A house's lit windows and lamp: 0 dark .. 1 lit. */
  setHouseLight(id: string, level: number) {
    const h = this.houses.get(id);
    if (!h) return;
    h.mat.emissiveIntensity = 1.4 * level;
    if (h.light) h.light.intensity = h.light.baseIntensity * level;
  }

  /** How bright the windows look from inside houses (daylight 1, night 0). */
  setDaylight(k: number) {
    this.innerWindow.emissiveIntensity = 0.15 + 1.1 * k;
    this.innerWindow.emissive.setHex(k > 0.5 ? 0xcfe6ff : 0x22304a);
  }

  /** The castle's light level (1 normal; the throne room's vision drives it lower and redder). */
  setCastleMood(scale: number) {
    for (const l of this.castleLights) l.src.intensity = l.base * scale;
  }

  /** The light over the throne (the King's spotlight). */
  setKingLight(level: number) {
    this.kingLight.intensity = this.kingLight.baseIntensity * level;
  }

  /** The clock part lying around town (hidden once someone picked it up). */
  part(part: ClockPart): THREE.Object3D {
    return this.parts.get(part)!;
  }

  setPartTaken(part: ClockPart, taken: boolean) {
    this.parts.get(part)!.visible = !taken;
  }

  /** Parts fitted in the tower's hatch. */
  setHatchPart(part: ClockPart, fitted: boolean) {
    this.hatchParts.get(part)!.visible = fitted;
  }

  /** Clock faces: hands at `hours` (0..12, fractional), minute hands only once the clock has its hand back. */
  setClockTime(hours: number, minuteHand: boolean) {
    const h = ((hours % 12) + 12) % 12;
    const turn = (hand: THREE.Object3D, angle: number) => {
      hand.quaternion.copy(hand.userData.baseQuat as THREE.Quaternion).multiply(this.spin.setFromAxisAngle(Z_AXIS, angle));
    };
    for (const hand of this.hourHands) turn(hand, -(h / 12) * Math.PI * 2);
    for (const hand of this.minuteHands) {
      hand.visible = minuteHand;
      turn(hand, -((h % 1) * Math.PI * 2));
    }
  }

  /** The clock faces glow at night (the only light left in the square). */
  setClockGlow(level: number) {
    this.clockGlow.emissiveIntensity = 0.05 + 0.9 * level;
  }

  /** World position of a model piece (for picking it with E). */
  modelPiece(id: ModelPieceId): THREE.Object3D {
    return this.modelPieces.get(id)!;
  }

  setModelSlot(id: ModelPieceId, slot: number) {
    this.modelSlot[id] = slot;
    const piece = this.modelPieces.get(id)!;
    const [x, z] = modelPoint(MODEL_SLOTS[id][slot][0], MODEL_SLOTS[id][slot][1]);
    piece.position.set(x, MODEL_TABLE.y + 0.06, z);
  }

  /** How many of the puzzle gate's three bulbs are lit. */
  setGateBulbs(count: number) {
    this.gateBulbs.forEach((b, i) => { b.material = i < count ? this.bulbOn : this.bulbOff; });
  }

  update(delta: number) {
    this.clock += delta;
    // Gates ease towards their state.
    for (const gate of ["barricade", "puzzle", "exit"] as TownGate[]) {
      const target = this.gateOpen[gate] ? 1 : 0;
      const cur = this.gateAnim[gate];
      if (Math.abs(cur - target) < 0.001) continue;
      this.gateAnim[gate] = cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), delta * (gate === "puzzle" ? 0.45 : 0.8));
    }
    const b = this.gateAnim.barricade;
    this.barricade.visible = b < 0.99;
    this.barricade.position.y = -b * 2.5;
    this.portcullis.position.y = this.gateAnim.puzzle * 3.7;
    const e = this.gateAnim.exit;
    this.exitLeaves.forEach((leaf, i) => { leaf.rotation.y = (i === 0 ? 1 : -1) * e * 1.75; });
    this.exitLight.intensity = this.exitLight.baseIntensity * (0.15 + 0.85 * e);
    for (const f of this.flags) f.rotation.y = Math.sin(this.clock * 1.6 + f.position.x) * 0.25;
    const pulse = 0.85 + 0.15 * Math.sin(this.clock * 3.2);
    for (const g of this.glows) g.material.opacity = 0.55 * pulse;
    for (const part of CLOCK_PARTS) {
      const p = this.parts.get(part)!;
      if (p.visible) p.rotation.y = this.clock * 0.9;
    }
    if (this.clock >= this.projector.next) {
      this.projector.next = this.clock + 1 / 8;
      this.drawProjector(this.projector.frame++);
    }
  }

  dispose() {
    this.root.removeFromParent();
  }

  // -------------------------------------------------------------------------
  // Shared materials and helpers
  // -------------------------------------------------------------------------

  private initShared() {
    this.lampOn = this.mat("lamp_on", { color: 0xfff1c8, emissive: 0xffd98a, emissiveIntensity: 1.6, roughness: 0.4 });
    this.lampOff = this.mat("lamp_off", { color: 0x3a3a34, roughness: 0.4 });
    this.innerWindow = this.mat("inner_window", { color: 0x1a2030, emissive: 0xcfe6ff, emissiveIntensity: 1.2, roughness: 0.2 });
    this.bulbOn = this.mat("bulb_on", { color: 0xfff6c8, emissive: 0xffd24a, emissiveIntensity: 2.2 });
    this.bulbOff = this.mat("bulb_off", { color: 0x3a2a1a, roughness: 0.5 });
  }

  private flush(group: THREE.Group, name: string) {
    const batch = new Batch();
    batch.addTree(group);
    const out = new THREE.Group();
    out.name = name;
    batch.flush(out, this.kit, name);
    this.root.add(out);
    // Dynamic pieces built into the group keep living; move them over.
    const dynamic: THREE.Object3D[] = [];
    group.traverse((o) => { if (o.userData.dynamic && !(o.parent?.userData.dynamic)) dynamic.push(o); });
    for (const o of dynamic) {
      o.updateMatrixWorld(true);
      const m = o.matrixWorld.clone();
      o.removeFromParent();
      m.decompose(o.position, o.quaternion, o.scale);
      o.userData.baseQuat = o.quaternion.clone();
      this.root.add(o);
    }
  }

  private mat(key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    return this.kit.mat(`town_${key}`, () => new THREE.MeshStandardMaterial({ roughness: 0.8, ...params }));
  }

  private basic(key: string, params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    return this.kit.mat(`town_${key}`, () => new THREE.MeshBasicMaterial(params));
  }

  private tex(key: string, w: number, h: number, tile: [number, number] | null, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const cached = this.textures.get(key);
    if (cached) return cached;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d")!, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (tile) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1 / tile[0], 1 / tile[1]);
    }
    this.kit.track(tex);
    this.textures.set(key, tex);
    return tex;
  }

  /** Box with UVs in metres on every face. */
  private boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
    return this.kit.geo(`town_box_${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`, () => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.getAttribute("uv");
      const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
      }
      return g;
    });
  }

  private box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
    return m;
  }

  private cyl(parent: THREE.Object3D, rTop: number, rBot: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 12): THREE.Mesh {
    const m = new THREE.Mesh(this.kit.geo(`town_cyl_${rTop}_${rBot}_${h}_${seg}`, () => {
      const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
      const uv = g.getAttribute("uv");
      const circ = Math.PI * 2 * Math.max(rTop, rBot);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
      return g;
    }), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private sphere(parent: THREE.Object3D, r: number, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
    const m = new THREE.Mesh(this.kit.geo("town_sphere", () => new THREE.SphereGeometry(1, 14, 10)), mat);
    m.position.set(x, y, z);
    m.scale.set(r * sx, r * sy, r * sz);
    parent.add(m);
    return m;
  }

  private plane(parent: THREE.Object3D, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.kit.geo(`town_plane_${w}_${h}`, () => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
      return g;
    }), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
    return m;
  }

  /** Horizontal ground tile; its UVs become world x/z when merged. */
  private ground(parent: THREE.Object3D, x1: number, z1: number, x2: number, z2: number, y: number, mat: THREE.Material) {
    const m = new THREE.Mesh(this.kit.geo("town_unit_floor", () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), mat);
    m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    m.scale.set(x2 - x1, 1, z2 - z1);
    m.userData.worldUV = true;
    parent.add(m);
    return m;
  }

  /** Gable roof prism over x in [-w/2, w/2], z in [-d/2, d/2], ridge along x. */
  private gableGeo(w: number, d: number, h: number, overhang: number): THREE.BufferGeometry {
    return this.kit.geo(`town_gable_${w}_${d}_${h}_${overhang}`, () => {
      const hw = w / 2 + overhang, hd = d / 2 + overhang;
      const slope = Math.hypot(hd, h);
      const p: number[] = [];
      const uv: number[] = [];
      const quad = (a: number[], b: number[], c: number[], d2: number[], uw: number, vh: number) => {
        p.push(...a, ...b, ...c, ...a, ...c, ...d2);
        uv.push(0, 0, uw, 0, uw, vh, 0, 0, uw, vh, 0, vh);
      };
      quad([-hw, 0, hd], [hw, 0, hd], [hw, h, 0], [-hw, h, 0], 2 * hw, slope);
      quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, 0], [hw, h, 0], 2 * hw, slope);
      // Gable ends.
      p.push(-w / 2, 0, -d / 2, -w / 2, 0, d / 2, -w / 2, h * (d / 2) / hd, 0);
      uv.push(0, 0, d, 0, d / 2, h);
      p.push(w / 2, 0, d / 2, w / 2, 0, -d / 2, w / 2, h * (d / 2) / hd, 0);
      uv.push(0, 0, d, 0, d / 2, h);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    });
  }

  /** Obstacle circle registered in every cell it overlaps. */
  private solid(x: number, z: number, r: number): { radius: number } {
    let first: { radius: number } | null = null;
    const shared = { x, z, radius: r };
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        if (gx < 0 || gz < 0 || gx >= TOWN_GRID || gz >= TOWN_GRID) continue;
        const o = this.env.addObstacle(gx, gz, x, z, r);
        if (!first) first = o;
      }
    }
    return first ?? shared;
  }

  /** A wall line of obstacle circles from (x1,z1) to (x2,z2), leaving gaps (centre, half-width). */
  private wallLine(x1: number, z1: number, x2: number, z2: number, gaps: [number, number, number][] = []) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.ceil(len / 0.4));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const x = x1 + (x2 - x1) * k, z = z1 + (z2 - z1) * k;
      if (gaps.some(([gx, gz, hw]) => Math.hypot(x - gx, z - gz) < hw)) continue;
      this.solid(x, z, 0.25);
    }
  }

  private label(text: string, w: number, h: number, fg: string, bg: string, font = "bold"): THREE.MeshStandardMaterial {
    return this.kit.mat(`town_label_${text}_${w}_${h}_${fg}_${bg}`, () => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = Math.max(32, Math.round(512 * (h / w)));
      const g = c.getContext("2d")!;
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = fg;
      g.lineWidth = 8;
      g.strokeRect(8, 8, c.width - 16, c.height - 16);
      g.fillStyle = fg;
      let size = Math.floor(c.height * 0.55);
      g.font = `${font} ${size}px Georgia, serif`;
      while (g.measureText(text).width > c.width - 60 && size > 10) { size -= 2; g.font = `${font} ${size}px Georgia, serif`; }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, c.width / 2, c.height / 2 + 2);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.kit.track(tex);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    });
  }

  private glowSprite(color: number, size: number): THREE.Sprite {
    const tex = this.tex("glow", 64, 64, null, (g) => {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.3, "rgba(255,255,255,0.5)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    });
    const mat = this.kit.mat(`town_glow_${color}`, () => new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    s.userData.dynamic = true;
    this.glows.push(s);
    return s;
  }

  // -------------------------------------------------------------------------
  // Textures
  // -------------------------------------------------------------------------

  private grassMat(): THREE.MeshStandardMaterial {
    const tex = this.tex("grass", 256, 256, [8, 8], (g, w, h) => {
      // Mowed stripes, like a model railway's lawn.
      for (let y = 0; y < h; y++) {
        const stripe = Math.floor(y / 32) % 2 === 0;
        g.fillStyle = stripe ? "#6fa04a" : "#62933f";
        g.fillRect(0, y, w, 1);
      }
      const rng = townRng(11);
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = rng() < 0.5 ? "rgba(40,80,20,0.35)" : "rgba(170,210,110,0.3)";
        g.fillRect(rng() * w, rng() * h, 1, 2 + rng() * 3);
      }
    });
    return this.mat("grass", { map: tex, roughness: 0.95 });
  }

  private asphaltMat(): THREE.MeshStandardMaterial {
    const tex = this.tex("asphalt", 256, 256, [4, 4], (g, w, h) => {
      g.fillStyle = "#55555a";
      g.fillRect(0, 0, w, h);
      const rng = townRng(21);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = rng() < 0.5 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.08)";
        g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
      }
    });
    return this.mat("asphalt", { map: tex, roughness: 0.9 });
  }

  private cobbleMat(): THREE.MeshStandardMaterial {
    const tex = this.tex("cobble", 256, 256, [2, 2], (g, w, h) => {
      g.fillStyle = "#8a7e72";
      g.fillRect(0, 0, w, h);
      const rng = townRng(31);
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const x = col * 32 + (row % 2) * 16 + 16, y = row * 32 + 16;
          g.fillStyle = `hsl(${28 + rng() * 14}, ${14 + rng() * 10}%, ${52 + rng() * 14}%)`;
          g.beginPath(); g.ellipse(x % w, y, 13, 12, rng(), 0, Math.PI * 2); g.fill();
          g.strokeStyle = "rgba(40,30,20,0.6)";
          g.lineWidth = 2;
          g.stroke();
        }
      }
    });
    return this.mat("cobble", { map: tex, roughness: 0.9 });
  }

  private sidewalkMat(): THREE.MeshStandardMaterial {
    const tex = this.tex("sidewalk", 128, 128, [2, 2], (g, w, h) => {
      g.fillStyle = "#c9c4b8";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#8f897c";
      g.lineWidth = 3;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    });
    return this.mat("sidewalk", { map: tex, roughness: 0.9 });
  }

  private woodFloorMat(): THREE.MeshStandardMaterial {
    const tex = this.tex("woodfloor", 256, 256, [2, 2], (g, w, h) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? "#8a5a34" : "#7c4f2c";
        g.fillRect(0, i * 32, w, 32);
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(0, i * 32, w, 2);
        g.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
      }
    });
    return this.mat("woodfloor", { map: tex, roughness: 0.75 });
  }

  private wallpaperMat(key: string, a: string, b: string): THREE.MeshStandardMaterial {
    const tex = this.tex(`paper_${key}`, 128, 128, [1, 1], (g, w, h) => {
      g.fillStyle = a;
      g.fillRect(0, 0, w, h);
      g.fillStyle = b;
      for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 12, h);
      g.fillStyle = "rgba(255,255,255,0.25)";
      for (let y = 16; y < h; y += 32) for (let x = 22; x < w; x += 32) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    });
    return this.mat(`paper_${key}`, { map: tex, roughness: 0.9 });
  }

  /**
   * A lot's facade: one 4 m bay of one 3.2 m storey, tiled over the walls.
   * Windows get a matching emissive mask, so the house can be lit from inside.
   */
  private facadeMat(l: TownLot): THREE.MeshStandardMaterial {
    const style = l.style;
    const draw = (mask: boolean) => (g: CanvasRenderingContext2D, w: number, h: number) => {
      g.fillStyle = mask ? "#000" : hex(l.wall);
      g.fillRect(0, 0, w, h);
      if (!mask) {
        if (style === "cottage") {
          g.strokeStyle = shade(l.wall, 0.82);
          g.lineWidth = 2;
          for (let y = 6; y < h; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        } else if (style === "tall" || style === "hotel" || style === "chapel") {
          g.fillStyle = shade(l.wall, style === "chapel" ? 0.9 : 0.84);
          for (let y = 0; y < h; y += 14) for (let x = (y / 14) % 2 ? 0 : 14; x < w; x += 28) g.fillRect(x, y, 26, 12);
        } else {
          g.fillStyle = shade(l.wall, 0.94);
          for (let i = 0; i < 40; i++) g.fillRect((i * 53) % w, (i * 37) % h, 6, 3);
        }
        // Dark outlines at the corners (it's a cartoon).
        g.fillStyle = shade(l.wall, 0.55);
        g.fillRect(0, 0, 4, h);
        g.fillRect(w - 4, 0, 4, h);
        g.fillRect(0, h - 6, w, 6);
      }
      // The window.
      const ww = style === "garage" ? 0 : style === "shop" || style === "cinema" ? 150 : 84;
      if (ww === 0) return;
      const wh = style === "shop" || style === "cinema" ? 110 : 112;
      const x0 = (w - ww) / 2, y0 = style === "shop" || style === "cinema" ? 70 : 48;
      if (mask) {
        g.fillStyle = "#fff";
        g.fillRect(x0 + 6, y0 + 6, ww - 12, wh - 12);
        return;
      }
      if (style === "cottage" || style === "house") {
        g.fillStyle = hex(l.roof);
        g.fillRect(x0 - 26, y0, 22, wh);
        g.fillRect(x0 + ww + 4, y0, 22, wh);
      }
      g.fillStyle = "#1c1c1c";
      g.fillRect(x0 - 4, y0 - 4, ww + 8, wh + 8);
      g.fillStyle = "#f4efe2";
      g.fillRect(x0, y0, ww, wh);
      g.fillStyle = "#3a5068";
      g.fillRect(x0 + 6, y0 + 6, ww - 12, wh - 12);
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.fillRect(x0 + 10, y0 + 10, 14, wh - 20);
      g.fillStyle = "#f4efe2";
      g.fillRect(x0 + ww / 2 - 3, y0, 6, wh);
      g.fillRect(x0, y0 + wh / 2 - 3, ww, 6);
      if (style === "cottage") {
        g.fillStyle = "#6b3a2a";
        g.fillRect(x0 - 6, y0 + wh, ww + 12, 12);
        for (let i = 0; i < 6; i++) {
          g.fillStyle = ["#e04a5a", "#f2d24b", "#ffffff"][i % 3];
          g.beginPath(); g.arc(x0 + 6 + i * (ww / 5.5), y0 + wh - 2, 7, 0, Math.PI * 2); g.fill();
        }
      }
    };
    const map = this.tex(`facade_${l.id}`, 256, 204, [4, FLOOR_H], (g, w, h) => {
      // Canvas y runs down; the bay's ground is its bottom row.
      draw(false)(g, w, h);
    });
    const mask = this.tex(`facade_mask_${style}`, 256, 204, [4, FLOOR_H], (g, w, h) => draw(true)(g, w, h));
    map.flipY = true;
    mask.flipY = true;
    const material = this.mat(`facade_${l.id}`, { map, emissiveMap: mask, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.85 });
    return material;
  }

  // -------------------------------------------------------------------------
  // The town
  // -------------------------------------------------------------------------

  private buildTownGround(g: THREE.Group) {
    const asphalt = this.asphaltMat();
    const cobble = this.cobbleMat();
    const walk = this.sidewalkMat();
    const dirt = this.mat("alley_dirt", { color: 0x7a6650, roughness: 1 });
    const curb = this.mat("curb", { color: 0xb4ada0, roughness: 0.9 });
    for (const r of TOWN_STREETS) {
      for (let x = r.x1; x <= r.x2; x++) {
        for (let z = r.z1; z <= r.z2; z++) {
          const x0 = x * CELL, z0 = z * CELL;
          const mat = r.kind === "plaza" ? cobble : r.kind === "alley" ? dirt : asphalt;
          if (r.kind === "plaza" && x === TOWN_TOWER.gx && z === TOWN_TOWER.gz) continue;
          this.ground(g, x0, z0, x0 + CELL, z0 + CELL, 0.02, mat);
          if (r.kind !== "street") continue;
          // Sidewalks along every edge that faces a building or a hillside.
          for (const side of ["N", "S", "W", "E"] as TownSide[]) {
            const s = SIDES[side];
            const n = townCellAt(x + s.dx, z + s.dz);
            if (n && n.kind !== "interior") continue;
            const w = 1.1;
            const [ax1, az1, ax2, az2] = side === "N" ? [x0, z0, x0 + CELL, z0 + w] : side === "S" ? [x0, z0 + CELL - w, x0 + CELL, z0 + CELL]
              : side === "W" ? [x0, z0, x0 + w, z0 + CELL] : [x0 + CELL - w, z0, x0 + CELL, z0 + CELL];
            this.ground(g, ax1, az1, ax2, az2, 0.14, walk);
            const cx = (ax1 + ax2) / 2, cz = (az1 + az2) / 2;
            if (side === "N" || side === "S") this.box(g, CELL, 0.14, 0.12, curb, cx, 0.07, side === "N" ? az2 : az1);
            else this.box(g, 0.12, 0.14, CELL, curb, side === "W" ? ax2 : ax1, 0.07, cz);
          }
        }
      }
    }
    // The road out: asphalt to the town's edge, then nothing but grass.
    this.ground(g, TOWN_BARRICADE.gx * CELL, TOWN_BARRICADE.gz * CELL, (TOWN_BARRICADE.gx + 1) * CELL, (TOWN_BARRICADE.gz + 1) * CELL, 0.02, asphalt);
    // Painted centre lines on the long streets.
    const paint = this.mat("paint", { color: 0xf2ead2, roughness: 0.8 });
    for (const r of TOWN_STREETS) {
      if (r.kind !== "street" || r.id === "busStop") continue;
      const horizontal = r.x2 > r.x1;
      const len = horizontal ? (r.x2 - r.x1 + 1) * CELL : (r.z2 - r.z1 + 1) * CELL;
      for (let d = 1; d < len - 1; d += 3) {
        if (horizontal) this.box(g, 1.4, 0.01, 0.12, paint, r.x1 * CELL + d + 0.7, 0.03, cellCenter(r.z1));
        else this.box(g, 0.12, 0.01, 1.4, paint, cellCenter(r.x1), 0.03, r.z1 * CELL + d + 0.7);
      }
    }
    // The town's flat green, under the houses and around the edge.
    const grass = this.grassMat();
    const f = TOWN_FOOTPRINT;
    this.ground(g, f.x1 * CELL, f.z1 * CELL, (f.x2 + 1) * CELL, (f.z2 + 1) * CELL, 0.0, grass);

    // The town ends at a picket fence; the road goes through it.
    const white = this.mat("picket", { color: 0xf6f3ea, roughness: 0.7 });
    const fenceZ = (TOWN_BARRICADE.gz + 1) * CELL - 0.3;
    for (let x = 100.5; x < 184; x += 0.5) {
      if (x > 139.5 && x < 144.5) continue;
      this.box(g, 0.1, 1.0, 0.05, white, x, 0.5, fenceZ);
    }
    this.box(g, 39.5, 0.08, 0.06, white, 120, 0.75, fenceZ + 0.04);
    this.box(g, 39.5, 0.08, 0.06, white, 164, 0.75, fenceZ + 0.04);
    this.box(g, 39.5, 0.08, 0.06, white, 120, 0.35, fenceZ + 0.04);
    this.box(g, 39.5, 0.08, 0.06, white, 164, 0.35, fenceZ + 0.04);
  }

  private frontSide(l: TownLot): TownSide {
    if (l.door) return l.door.side;
    let best: TownSide = "S";
    let bestN = -1;
    for (const side of ["S", "N", "E", "W"] as TownSide[]) {
      let n = 0;
      if (side === "N" || side === "S") {
        const z = side === "N" ? l.z1 - 1 : l.z2 + 1;
        for (let x = l.x1; x <= l.x2; x++) { const c = townCellAt(x, z); if (c && c.zone === "town" && c.kind !== "interior") n++; }
      } else {
        const x = side === "W" ? l.x1 - 1 : l.x2 + 1;
        for (let z = l.z1; z <= l.z2; z++) { const c = townCellAt(x, z); if (c && c.zone === "town" && c.kind !== "interior") n++; }
      }
      if (n > bestN) { bestN = n; best = side; }
    }
    return best;
  }

  private buildLot(g: THREE.Group, l: TownLot) {
    const x0 = l.x1 * CELL, x1 = (l.x2 + 1) * CELL, z0 = l.z1 * CELL, z1 = (l.z2 + 1) * CELL;
    const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const floors = l.floors;
    const H = floors * FLOOR_H + (l.style === "cinema" ? 1.2 : 0);
    const wall = this.facadeMat(l);
    const roof = this.mat(`roof_${l.roof}`, { color: l.roof, roughness: 0.7 });
    const trim = this.mat("trim", { color: 0xf4efe2, roughness: 0.7 });
    const front = this.frontSide(l);
    const lights: HouseLights = { mat: wall, light: null };
    this.houses.set(l.id, lights);

    if (l.door) {
      this.buildHollowHouse(g, l, wall, H);
    } else {
      this.box(g, W - 0.2, H, D - 0.2, wall, cx, H / 2, cz);
    }

    // Roof.
    const ridgeAlongX = W >= D;
    if (l.style === "cottage" || l.style === "house" || l.style === "chapel") {
      const rh = l.style === "chapel" ? 4.2 : 2.2;
      const roofMesh = new THREE.Mesh(this.gableGeo(ridgeAlongX ? W - 0.2 : D - 0.2, ridgeAlongX ? D - 0.2 : W - 0.2, rh, 0.35), roof);
      roofMesh.position.set(cx, H, cz);
      if (!ridgeAlongX) roofMesh.rotation.y = Math.PI / 2;
      // A little crooked, like a hand-made set.
      roofMesh.rotation.z = (townRng(l.x1 * 31 + l.z1)() - 0.5) * 0.05;
      g.add(roofMesh);
      // Chimney.
      if (l.style !== "chapel") {
        const brick = this.mat("chimney", { color: 0x9a4a3a, roughness: 0.9 });
        this.box(g, 0.6, 1.8, 0.6, brick, cx + (ridgeAlongX ? W * 0.25 : 0.4), H + 1.6, cz + (ridgeAlongX ? 0.4 : D * 0.25));
      } else {
        // The steeple.
        const stone = this.mat("steeple", { color: 0xe6e2d8, roughness: 0.8 });
        this.box(g, 2.6, 6, 2.6, stone, x1 - 2.4, H + 3, cz);
        const spire = new THREE.Mesh(this.kit.geo("town_spire", () => new THREE.ConeGeometry(1.9, 6, 4)), roof);
        spire.position.set(x1 - 2.4, H + 9, cz);
        spire.rotation.y = Math.PI / 4;
        g.add(spire);
        this.box(g, 0.12, 1.4, 0.12, trim, x1 - 2.4, H + 12.6, cz);
        this.box(g, 0.8, 0.12, 0.12, trim, x1 - 2.4, H + 12.8, cz);
      }
    } else {
      // Flat roofs with a parapet.
      this.box(g, W, 0.35, D, roof, cx, H + 0.17, cz);
      this.box(g, W, 0.6, 0.2, trim, cx, H + 0.3, z0 + 0.1);
      this.box(g, W, 0.6, 0.2, trim, cx, H + 0.3, z1 - 0.1);
      this.box(g, 0.2, 0.6, D, trim, x0 + 0.1, H + 0.3, cz);
      this.box(g, 0.2, 0.6, D, trim, x1 - 0.1, H + 0.3, cz);
      if (l.style === "hotel") {
        const water = this.mat("water_tank", { color: 0x8a6a4a, roughness: 0.9 });
        this.cyl(g, 1.1, 1.1, 2.2, water, cx - 2, H + 2.6, cz, 10);
      }
    }

    // The front: door (a fake one unless it can be entered), steps, sign, awning.
    const fs = SIDES[front];
    const along = front === "N" || front === "S";
    const fx = front === "W" ? x0 : front === "E" ? x1 : cx;
    const fz = front === "N" ? z0 : front === "S" ? z1 : cz;
    const yaw = front === "S" ? 0 : front === "N" ? Math.PI : front === "E" ? Math.PI / 2 : -Math.PI / 2;
    const doorAt = l.door ? (along ? cellCenter(l.door.gx) : cellCenter(l.door.gz)) : (along ? cx : cz);
    // Enterable houses' walls stand on the lot's edge; the solid ones are inset 0.1 m.
    const out = l.door ? 0.06 : -0.08;
    const dx = along ? doorAt : fx + fs.dx * out;
    const dz = along ? fz + fs.dz * out : doorAt;
    const frame = new THREE.Group();
    frame.position.set(dx, 0, dz);
    frame.rotation.y = yaw;
    const doorMat = this.mat(`door_${l.roof}`, { color: l.roof, roughness: 0.6 });
    if (l.style === "garage" || l.style === "cinema" || l.style === "shop") {
      // Shop fronts get a striped awning over the door.
      const awn = this.tex(`awning_${l.roof}`, 64, 64, [1, 1], (c, w, h) => {
        for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#f4efe2" : hex(l.roof); c.fillRect(i * 8, 0, 8, h); }
      });
      const awnMat = this.mat(`awning_${l.roof}`, { map: awn, roughness: 0.8, side: THREE.DoubleSide });
      const a = this.plane(frame, Math.min(along ? W : D, 8) - 0.4, 1.4, awnMat, 0, 2.95, 0.6);
      a.rotation.x = -1.0;
    }
    if (!l.door) {
      this.box(frame, 1.5, 2.6, 0.12, trim, 0, 1.3, 0.02);
      this.box(frame, 1.2, 2.3, 0.14, doorMat, 0, 1.15, 0.03);
      this.sphere(frame, 0.05, this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 }), 0.42, 1.1, 0.12);
      this.box(frame, 1.8, 0.16, 0.6, this.mat("step", { color: 0xb4ada0, roughness: 0.9 }), 0, 0.08, 0.3);
    }
    if (l.sign) {
      const text = t(l.sign);
      // On the wall above the ground floor, or standing on the roof's edge of a one-storey shop.
      this.plane(frame, 3.2, 0.7, this.label(text, 3.2, 0.7, "#2b1a10", "#f4e6c0"), 0, floors > 1 ? 3.75 : H + 0.75, 0.09);
    }
    if (l.style === "cinema") {
      // Marquee with bulbs.
      this.box(frame, 6, 1.2, 1.4, this.mat("marquee", { color: 0x7a2e2e, roughness: 0.6 }), 0, 3.6, 0.7);
      for (let i = -12; i <= 12; i++) this.sphere(frame, 0.07, this.lampOn, i * 0.24, 3.0, 1.42);
    }
    g.add(frame);
  }

  /** A house you can walk into: four walls with a doorway, a floor, a ceiling and a room of furniture. */
  private buildHollowHouse(g: THREE.Group, l: TownLot, wall: THREE.MeshStandardMaterial, H: number) {
    const x0 = l.x1 * CELL, x1 = (l.x2 + 1) * CELL, z0 = l.z1 * CELL, z1 = (l.z2 + 1) * CELL;
    const door = l.door!;
    const paper = l.id === "garage" ? this.mat("garage_wall", { color: 0x8a8478, roughness: 0.95 })
      : l.id === "bakery" ? this.wallpaperMat("bakery", "#f4e2c4", "#e9cfa6")
        : l.id === STAY_HOUSE ? this.wallpaperMat("stay", "#c8d8f0", "#b4c6e4")
          : this.wallpaperMat(l.id, hex(0xf0e0c8), shade(l.wall, 0.95));
    const inH = 3.1;
    const doorW = l.id === "garage" ? 3.0 : 1.5;
    const doorH = l.id === "garage" ? 2.7 : 2.35;
    const T = 0.12, I = 0.06;
    const sides: [TownSide, number, number, number, number][] = [
      ["N", x0, z0, x1, z0], ["S", x0, z1, x1, z1], ["W", x0, z0, x0, z1], ["E", x1, z0, x1, z1],
    ];
    for (const [side, ax, az, bx, bz] of sides) {
      const along = side === "N" || side === "S";
      const len = along ? bx - ax : bz - az;
      const inward = side === "N" || side === "W" ? 1 : -1;
      const hasDoor = side === door.side;
      const dc = hasDoor ? (along ? cellCenter(door.gx) : cellCenter(door.gz)) : 0;
      const segs: [number, number][] = hasDoor ? [[along ? ax : az, dc - doorW / 2], [dc + doorW / 2, along ? bx : bz]] : [[along ? ax : az, along ? bx : bz]];
      for (const [s0, s1] of segs) {
        const m = (s0 + s1) / 2, w = s1 - s0;
        if (w <= 0.01) continue;
        if (along) {
          this.box(g, w, H, T, wall, m, H / 2, az + inward * T / 2);
          this.box(g, w, inH, I, paper, m, inH / 2, az + inward * (T + I / 2));
        } else {
          this.box(g, T, H, w, wall, ax + inward * T / 2, H / 2, m);
          this.box(g, I, inH, w, paper, ax + inward * (T + I / 2), inH / 2, m);
        }
      }
      if (hasDoor) {
        // Lintel above the doorway, outside and in.
        if (along) {
          this.box(g, doorW, H - doorH, T, wall, dc, doorH + (H - doorH) / 2, az + inward * T / 2);
          this.box(g, doorW, inH - doorH, I, paper, dc, doorH + (inH - doorH) / 2, az + inward * (T + I / 2));
        } else {
          this.box(g, T, H - doorH, doorW, wall, ax + inward * T / 2, doorH + (H - doorH) / 2, dc);
          this.box(g, I, inH - doorH, doorW, paper, ax + inward * (T + I / 2), doorH + (inH - doorH) / 2, dc);
        }
        // The door stands open, swung in square to the wall on its hinge side.
        const leafMat = this.mat(`door_${l.roof}`, { color: l.roof, roughness: 0.6 });
        const hinge = dc - doorW / 2 + 0.03;
        const depth = doorW * 0.95;
        if (along) {
          this.box(g, 0.06, doorH - 0.05, depth, leafMat, hinge, (doorH - 0.05) / 2, az + inward * (T + depth / 2));
          this.solid(hinge, az + inward * (T + depth * 0.3), 0.14);
          this.solid(hinge, az + inward * (T + depth * 0.75), 0.14);
        } else {
          this.box(g, depth, doorH - 0.05, 0.06, leafMat, ax + inward * (T + depth / 2), (doorH - 0.05) / 2, hinge);
          this.solid(ax + inward * (T + depth * 0.3), hinge, 0.14);
          this.solid(ax + inward * (T + depth * 0.75), hinge, 0.14);
        }
      }
      // Collision along the wall, with the doorway open.
      const off = inward * 0.12;
      if (along) this.wallLine(ax, az + off, bx, bz + off, hasDoor ? [[dc, az + off, doorW / 2 + 0.3]] : []);
      else this.wallLine(ax + off, az, bx + off, bz, hasDoor ? [[ax + off, dc, doorW / 2 + 0.3]] : []);
      // Bright window panes inside (the facade paints the outside ones).
      if (!hasDoor && len >= 4 && l.id !== "garage") {
        for (let k = 0; k < Math.floor(len / CELL); k++) {
          const p = (along ? ax : az) + k * CELL + CELL / 2;
          if (along) this.plane(g, 1.0, 1.3, this.innerWindow, p, 1.75, az + inward * (T + I + 0.01), inward > 0 ? 0 : Math.PI);
          else this.plane(g, 1.0, 1.3, this.innerWindow, ax + inward * (T + I + 0.01), 1.75, p, inward > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
    }
    // Floor and ceiling.
    this.ground(g, x0, z0, x1, z1, 0.03, l.id === "garage" ? this.mat("concrete", { color: 0x8c877c, roughness: 1 }) : this.woodFloorMat());
    const ceil = new THREE.Mesh(this.kit.geo("town_unit_ceil", () => new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)), this.mat("ceiling", { color: 0xece4d4, roughness: 0.95 }));
    ceil.position.set((x0 + x1) / 2, inH, (z0 + z1) / 2);
    ceil.scale.set(x1 - x0, 1, z1 - z0);
    g.add(ceil);
    // A lamp, so houses glow at dusk (the director dims it at night).
    const light = this.env.registerLight(Math.floor((x0 + x1) / 2 / CELL), Math.floor((z0 + z1) / 2 / CELL), (x0 + x1) / 2, inH - 0.4, (z0 + z1) / 2, 0xffc890, 1.1, 9, 1.2);
    this.houses.get(l.id)!.light = light;
    this.sphere(g, 0.18, this.lampOn, (x0 + x1) / 2, inH - 0.35, (z0 + z1) / 2);
    this.furnish(g, l);
  }

  // -------------------------------------------------------------------------
  // Furniture
  // -------------------------------------------------------------------------

  private table(g: THREE.Group, x: number, z: number, w: number, d: number, top: number, mat?: THREE.Material, solid = true) {
    const wood = mat ?? this.mat("furn_wood", { color: 0x7a4a28, roughness: 0.7 });
    this.box(g, w, 0.06, d, wood, x, top - 0.03, z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(g, 0.07, top - 0.06, 0.07, wood, x + sx * (w / 2 - 0.08), (top - 0.06) / 2, z + sz * (d / 2 - 0.08));
    if (solid) this.solid(x, z, Math.max(w, d) * 0.42);
  }

  private chair(g: THREE.Group, x: number, z: number, yaw: number, mat?: THREE.Material, solid = true): THREE.Group {
    const wood = mat ?? this.mat("furn_wood", { color: 0x7a4a28, roughness: 0.7 });
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    c.rotation.y = yaw;
    this.box(c, 0.46, 0.05, 0.44, wood, 0, 0.46, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(c, 0.05, 0.46, 0.05, wood, sx * 0.19, 0.23, sz * 0.18);
    // The back is on the chair's -z side: a seated figure faces +z.
    this.box(c, 0.46, 0.55, 0.05, wood, 0, 0.75, -0.2);
    g.add(c);
    if (solid) this.solid(x, z, 0.3);
    return c;
  }

  private armchair(g: THREE.Group, x: number, z: number, yaw: number, color: number, y = 0) {
    const fab = this.mat(`fabric_${color}`, { color, roughness: 0.95 });
    const c = new THREE.Group();
    c.position.set(x, y, z);
    c.rotation.y = yaw;
    this.box(c, 0.95, 0.42, 0.85, fab, 0, 0.21, 0);
    this.box(c, 0.95, 0.75, 0.2, fab, 0, 0.75, -0.33);
    this.box(c, 0.18, 0.35, 0.85, fab, -0.4, 0.55, 0);
    this.box(c, 0.18, 0.35, 0.85, fab, 0.4, 0.55, 0);
    g.add(c);
    this.solid(x, z, 0.55);
  }

  private bed(g: THREE.Group, x: number, z: number, yaw: number, solid = true) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = yaw;
    const wood = this.mat("furn_wood", { color: 0x7a4a28, roughness: 0.7 });
    this.box(b, 1.1, 0.35, 2.0, wood, 0, 0.25, 0);
    this.box(b, 1.0, 0.18, 1.9, this.mat("sheet", { color: 0xf0ece0, roughness: 0.95 }), 0, 0.5, 0);
    this.box(b, 1.0, 0.2, 0.5, this.mat("blanket", { color: 0xb04a4a, roughness: 0.95 }), 0, 0.52, 0.5);
    this.box(b, 1.1, 0.9, 0.08, wood, 0, 0.45, -1.0);
    g.add(b);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    if (solid) for (const k of [-0.6, 0, 0.6]) this.solid(x + s * k, z + c * k, 0.6);
  }

  private shelf(g: THREE.Group, x: number, z: number, yaw: number, h = 1.9) {
    const s = new THREE.Group();
    s.position.set(x, 0, z);
    s.rotation.y = yaw;
    const wood = this.mat("shelf_wood", { color: 0x5a3a20, roughness: 0.8 });
    this.box(s, 1.4, h, 0.35, wood, 0, h / 2, 0);
    const colors = [0xb04a4a, 0x4a7ab0, 0xd9b84a, 0x4ab07a, 0xe8e2d0];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) {
      this.box(s, 0.12, 0.28, 0.22, this.mat(`book_${colors[(r + i) % 5]}`, { color: colors[(r + i) % 5], roughness: 0.8 }), -0.55 + i * 0.2, 0.25 + r * (h / 4.2), 0.08);
    }
    g.add(s);
    this.solid(x, z, 0.55);
  }

  private frame(g: THREE.Group, x: number, y: number, z: number, yaw: number, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, key: string) {
    const f = new THREE.Group();
    f.position.set(x, y, z);
    f.rotation.y = yaw;
    this.box(f, w + 0.16, h + 0.16, 0.06, this.mat("gilt", { color: 0xc9962a, roughness: 0.35, metalness: 0.6 }), 0, 0, -0.03);
    const tex = this.tex(`frame_${key}`, 256, Math.round(256 * h / w), null, draw);
    this.plane(f, w, h, this.mat(`frame_${key}`, { map: tex, roughness: 0.8 }), 0, 0, 0.005);
    g.add(f);
  }

  /** Each enterable house's room, built around its clock-part spot (both candidates get the furniture). */
  private furnish(g: THREE.Group, l: TownLot) {
    const rug = this.mat("rug", { color: 0x9a3a3a, roughness: 1 });
    const spot = (part: ClockPart) => PART_SPOTS[part].find((s) => s.lot === l.id);
    switch (l.id) {
      case "houseA": {
        const s = spot("key")!;
        this.table(g, s.x, s.z, 1.3, 0.9, s.y);
        this.chair(g, s.x - 0.9, s.z, Math.PI / 2);
        this.chair(g, s.x + 0.9, s.z, -Math.PI / 2);
        this.bed(g, 106, 211.5, Math.PI);
        this.shelf(g, 112, 208.4, 0);
        this.ground(g, 110, 212, 114, 215, 0.04, rug);
        break;
      }
      case "garage": {
        const s = spot("gear")!;
        const bench = this.mat("workbench", { color: 0x6b4a2a, roughness: 0.8 });
        this.box(g, 4.0, 0.08, 0.8, bench, s.x + 0.8, s.y - 0.04, s.z + 0.2);
        for (const dx of [-1.1, 2.7]) this.box(g, 0.08, s.y - 0.08, 0.7, bench, s.x + dx, (s.y - 0.08) / 2, s.z + 0.2);
        this.solid(s.x - 0.4, s.z + 0.2, 0.45); this.solid(s.x + 0.8, s.z + 0.2, 0.45); this.solid(s.x + 2.0, s.z + 0.2, 0.45);
        this.box(g, 0.6, 0.3, 0.35, this.mat("toolbox", { color: 0xb02a2a, roughness: 0.5 }), s.x + 2.2, s.y + 0.15, s.z + 0.2);
        const rubber = this.mat("rubber", { color: 0x1a1a1a, roughness: 0.9 });
        for (let i = 0; i < 3; i++) this.cyl(g, 0.38, 0.38, 0.25, rubber, 137.5, 0.13 + i * 0.26, 209.5, 14);
        this.solid(137.5, 209.5, 0.5);
        this.ground(g, 126, 211, 131, 214.5, 0.035, this.mat("oil", { color: 0x2a2826, roughness: 0.3 }));
        break;
      }
      case "bakery": {
        const s = spot("hand")!;
        const counter = this.mat("counter", { color: 0xd9c4a0, roughness: 0.6 });
        this.box(g, 9, s.y, 0.8, counter, 152, s.y / 2, s.z);
        this.wallLine(147.6, s.z, 156.4, s.z);
        const bread = this.mat("bread", { color: 0xc8843a, roughness: 0.8 });
        for (let i = 0; i < 6; i++) this.sphere(g, 0.16, bread, 148.4 + i * 1.0, s.y + 0.1, s.z - 0.15, 1.6, 0.8, 1);
        this.shelf(g, 150, 215.6, Math.PI, 1.6);
        this.shelf(g, 154.5, 215.6, Math.PI, 1.6);
        this.box(g, 0.6, 1.1, 0.6, this.mat("cake", { color: 0xf4d0d8, roughness: 0.7 }), 158.5, 0.55, 214.8);
        break;
      }
      case "houseB": {
        const s = spot("hand")!;
        this.table(g, s.x, s.z, 1.2, 0.9, s.y);
        this.chair(g, s.x - 0.85, s.z, Math.PI / 2);
        // An upright piano nobody plays (except, sometimes, it does).
        const piano = this.mat("piano", { color: 0x1a120c, roughness: 0.3 });
        this.box(g, 1.6, 1.3, 0.6, piano, 168, 0.65, 221);
        this.box(g, 1.5, 0.05, 0.25, this.mat("keys", { color: 0xf4efe2, roughness: 0.4 }), 168, 0.78, 221.42);
        this.solid(167.4, 221, 0.45); this.solid(168.6, 221, 0.45);
        this.shelf(g, 178.5, 221.5, -Math.PI / 2);
        break;
      }
      case STAY_HOUSE: {
        const s = spot("key")!;
        this.table(g, s.x, s.z, 0.6, 0.6, s.y);
        // The chair in the middle of the room, facing the open door.
        this.chair(g, STAY_CHAIR.x, STAY_CHAIR.z, -Math.PI / 2, this.mat("stay_chair", { color: 0x6b2a2a, roughness: 0.7 }));
        this.ground(g, 106.5, 256, 111, 260, 0.04, rug);
        this.shelf(g, 111.6, 262, -Math.PI / 2);
        this.frame(g, 108, 1.8, 252.25, 0, 1.1, 0.8, (c, w, h) => {
          c.fillStyle = "#c8d8f0"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#6fa04a"; c.fillRect(0, h * 0.6, w, h * 0.4);
          c.fillStyle = "#f2b8b5"; c.fillRect(w * 0.3, h * 0.35, w * 0.4, h * 0.3);
          c.fillStyle = "#40527a"; c.beginPath(); c.moveTo(w * 0.25, h * 0.36); c.lineTo(w * 0.5, h * 0.15); c.lineTo(w * 0.75, h * 0.36); c.fill();
        }, "home");
        break;
      }
      case "houseD": {
        const s = spot("gear")!;
        this.table(g, s.x, s.z, 1.2, 0.9, s.y);
        this.chair(g, s.x - 0.85, s.z, Math.PI / 2);
        this.bed(g, 168, 236, 0);
        // A radio the size of a dog house.
        const radio = this.mat("radio", { color: 0x6b4a2a, roughness: 0.5 });
        this.box(g, 0.8, 1.1, 0.5, radio, 178.8, 0.55, 234);
        this.solid(178.8, 234, 0.45);
        this.ground(g, 170, 238, 175, 242, 0.04, rug);
        break;
      }
      default:
        break;
    }
  }

  private buildTower(g: THREE.Group) {
    const x = cellCenter(TOWN_TOWER.gx), z = cellCenter(TOWN_TOWER.gz);
    const stone = this.mat("tower_stone", {
      map: this.tex("tower_stone", 128, 128, [2, 2], (c, w, h) => {
        c.fillStyle = "#d8c8b0"; c.fillRect(0, 0, w, h);
        c.strokeStyle = "#a8957a"; c.lineWidth = 3;
        for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); for (let xx = (y / 32) % 2 ? 0 : 32; xx < w; xx += 64) { c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + 32); c.stroke(); } }
      }), roughness: 0.85,
    });
    const roof = this.mat("tower_roof", { color: 0x2f5f4a, roughness: 0.6 });
    const trim = this.mat("trim", { color: 0xf4efe2, roughness: 0.7 });
    // Base (the plinth fills the cell), shaft, clock stage, spire.
    this.box(g, 4.0, 4.5, 4.0, stone, x, 2.25, z);
    this.box(g, 4.3, 0.4, 4.3, trim, x, 4.6, z);
    this.box(g, 3.2, 11.0, 3.2, stone, x, 10.1, z);
    this.box(g, 3.8, 4.0, 3.8, stone, x, CLOCK_FACE_Y, z);
    this.box(g, 4.1, 0.35, 4.1, trim, x, CLOCK_FACE_Y + 2.15, z);
    const spire = new THREE.Mesh(this.kit.geo("town_tower_spire", () => new THREE.ConeGeometry(3.0, 6.5, 4)), roof);
    spire.position.set(x, CLOCK_FACE_Y + 5.5, z);
    spire.rotation.y = Math.PI / 4;
    g.add(spire);
    this.box(g, 0.12, 1.6, 0.12, this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 }), x, CLOCK_FACE_Y + 9.4, z);
    // Four clock faces with their hands.
    const faceTex = this.tex("clock_face", 256, 256, null, (c, w) => {
      c.fillStyle = "#f6efd8"; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#1a1a1a"; c.lineWidth = 10; c.stroke();
      c.fillStyle = "#1a1a1a"; c.font = "bold 30px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
      const numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
      numerals.forEach((n, i) => { const a = (i / 12) * Math.PI * 2; c.fillText(n, w / 2 + Math.sin(a) * 92, w / 2 - Math.cos(a) * 92); });
    });
    this.clockGlow = this.mat("clock_face", { map: faceTex, emissive: 0xfff2c0, emissiveMap: faceTex, emissiveIntensity: 0.05, roughness: 0.6 });
    const handMat = this.mat("clock_hand", { color: 0x111111, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const yaw = (i * Math.PI) / 2;
      const face = new THREE.Group();
      face.position.set(x + Math.sin(yaw) * 1.92, CLOCK_FACE_Y, z + Math.cos(yaw) * 1.92);
      face.rotation.y = yaw;
      const disc = new THREE.Mesh(this.kit.geo("town_clock_disc", () => new THREE.CircleGeometry(1.45, 40)), this.clockGlow);
      face.add(disc);
      const hourPivot = new THREE.Group();
      hourPivot.position.z = 0.03;
      hourPivot.userData.dynamic = true;
      this.box(hourPivot, 0.12, 0.75, 0.03, handMat, 0, 0.32, 0).userData.dynamic = true;
      const minutePivot = new THREE.Group();
      minutePivot.position.z = 0.05;
      minutePivot.userData.dynamic = true;
      this.box(minutePivot, 0.08, 1.15, 0.03, handMat, 0, 0.52, 0).userData.dynamic = true;
      face.add(hourPivot, minutePivot);
      this.hourHands.push(hourPivot);
      this.minuteHands.push(minutePivot);
      g.add(face);
    }
    // The mechanism hatch at the foot of the tower, with the three empty fittings.
    const hatch = new THREE.Group();
    hatch.position.set(CLOCK_HATCH.x, 0, CLOCK_HATCH.z + 0.02);
    this.box(hatch, 1.6, 2.2, 0.08, this.mat("hatch", { color: 0x3a2a1a, roughness: 0.6 }), 0, 1.3, 0.02);
    this.box(hatch, 1.8, 0.12, 0.1, trim, 0, 2.45, 0.03);
    this.plane(hatch, 1.5, 0.3, this.label(t("town.sign.mechanism"), 1.5, 0.3, "#2b1a10", "#e9d8a8"), 0, 2.15, 0.08);
    const brass = this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 });
    const slots: Record<ClockPart, [number, number]> = { key: [-0.45, 1.35], gear: [0, 1.5], hand: [0.45, 1.35] };
    for (const part of CLOCK_PARTS) {
      const [sx, sy] = slots[part];
      this.cyl(hatch, 0.18, 0.18, 0.04, this.mat("socket", { color: 0x151515, roughness: 0.5 }), sx, sy, 0.07, 16).rotation.x = Math.PI / 2;
      const fitted = this.partModel(part, brass, handMat);
      fitted.position.set(sx, sy, 0.12);
      fitted.rotation.x = part === "gear" ? Math.PI / 2 : 0;
      fitted.scale.setScalar(0.8);
      fitted.visible = false;
      fitted.userData.dynamic = true;
      hatch.add(fitted);
      this.hatchParts.set(part, fitted);
    }
    g.add(hatch);
  }

  /** A clock part's own model (used lying around town and fitted in the hatch). */
  private partModel(part: ClockPart, brass: THREE.Material, dark: THREE.Material): THREE.Group {
    const p = new THREE.Group();
    if (part === "key") {
      const ring = new THREE.Mesh(this.kit.geo("town_key_ring", () => new THREE.TorusGeometry(0.09, 0.025, 8, 18)), brass);
      ring.position.y = 0.2;
      p.add(ring);
      this.box(p, 0.035, 0.3, 0.035, brass, 0, 0.0, 0);
      this.box(p, 0.09, 0.035, 0.035, brass, 0.04, -0.1, 0);
      this.box(p, 0.06, 0.035, 0.035, brass, 0.03, -0.05, 0);
    } else if (part === "gear") {
      const disc = new THREE.Mesh(this.kit.geo("town_gear_disc", () => new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20)), brass);
      p.add(disc);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.box(p, 0.06, 0.05, 0.06, brass, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2, a);
      }
      this.cyl(p, 0.04, 0.04, 0.07, dark, 0, 0, 0, 10);
    } else {
      this.box(p, 0.05, 0.6, 0.02, dark, 0, 0.18, 0);
      const tip = new THREE.Mesh(this.kit.geo("town_hand_tip", () => new THREE.ConeGeometry(0.07, 0.16, 4)), dark);
      tip.position.y = 0.55;
      p.add(tip);
      this.sphere(p, 0.05, brass, 0, -0.1, 0);
    }
    p.traverse((o) => { o.userData.dynamic = true; });
    return p;
  }

  private buildParts() {
    const brass = this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 });
    const dark = this.mat("clock_hand", { color: 0x111111, roughness: 0.4 });
    for (const part of CLOCK_PARTS) {
      const spot = partSpot(part, this.seed);
      const holder = new THREE.Group();
      holder.position.set(spot.x, spot.y + 0.16, spot.z);
      const model = this.partModel(part, brass, dark);
      if (part === "hand") model.rotation.z = Math.PI / 2.4;
      holder.add(model);
      const glow = this.glowSprite(0xffd76a, 0.9);
      holder.add(glow);
      holder.userData.dynamic = true;
      this.root.add(holder);
      this.parts.set(part, holder);
    }
  }

  private lamp(g: THREE.Group, x: number, z: number, bent = 0) {
    const iron = this.mat("iron", { color: 0x223a2a, roughness: 0.5, metalness: 0.4 });
    const pole = new THREE.Group();
    pole.position.set(x, 0, z);
    pole.rotation.z = bent;
    this.cyl(pole, 0.08, 0.12, 4.2, iron, 0, 2.1, 0, 8);
    this.cyl(pole, 0.22, 0.26, 0.3, iron, 0, 0.15, 0, 8);
    this.box(pole, 0.5, 0.08, 0.5, iron, 0, 4.25, 0);
    g.add(pole);
    const head = new THREE.Mesh(this.boxGeo(0.36, 0.5, 0.36), this.lampOff);
    head.position.set(x - Math.sin(bent) * 4.45, Math.cos(bent) * 4.45, z);
    head.userData.dynamic = true;
    g.add(head);
    const cap = new THREE.Mesh(this.kit.geo("town_lamp_cap", () => new THREE.ConeGeometry(0.34, 0.3, 4)), iron);
    cap.position.set(head.position.x, head.position.y + 0.38, z);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);
    const light = this.env.registerLight(Math.floor(x / CELL), Math.floor(z / CELL), head.position.x, head.position.y - 0.2, z, 0xffd9a0, 2.6, 13, 1.1);
    light.intensity = 0;
    this.lamps.push({ head, light, level: 0 });
    this.solid(x, z, 0.2);
  }

  private car(g: THREE.Group, x: number, z: number, yaw: number, color: number, scale = 1, tilt = 0, solid = true): THREE.Group {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    c.rotation.set(0, yaw, tilt);
    c.scale.setScalar(scale);
    const paint = this.mat(`car_${color}`, { color, roughness: 0.35, metalness: 0.3 });
    const black = this.mat("car_black", { color: 0x141414, roughness: 0.5 });
    const chrome = this.mat("chrome", { color: 0xdedede, roughness: 0.2, metalness: 0.9 });
    // A rounded 1930s sedan, nose towards +z.
    this.box(c, 1.6, 0.55, 3.6, paint, 0, 0.75, 0);
    this.box(c, 1.4, 0.7, 1.8, paint, 0, 1.35, -0.35);
    this.box(c, 1.42, 0.45, 1.5, this.mat("car_glass", { color: 0x2a3a4a, roughness: 0.15 }), 0, 1.35, -0.35);
    this.box(c, 1.2, 0.35, 1.2, paint, 0, 1.0, 1.25);
    this.box(c, 0.9, 0.5, 0.08, chrome, 0, 0.95, 1.87);
    for (const sx of [-0.45, 0.45]) this.sphere(c, 0.14, chrome, sx, 1.1, 1.8);
    for (const sz of [-1.15, 1.15]) for (const sx of [-0.78, 0.78]) {
      const w = this.cyl(c, 0.4, 0.4, 0.28, black, sx, 0.4, sz, 14);
      w.rotation.z = Math.PI / 2;
      // Fenders over the wheels.
      this.sphere(c, 0.52, paint, sx * 1.02, 0.62, sz, 0.55, 0.55, 1.1);
    }
    this.box(c, 1.7, 0.1, 0.25, chrome, 0, 0.55, 1.95);
    this.box(c, 1.7, 0.1, 0.25, chrome, 0, 0.55, -1.95);
    g.add(c);
    const s = Math.sin(yaw), co = Math.cos(yaw);
    if (solid) for (const k of [-1.0, 0.0, 1.0]) this.solid(x + s * k * scale, z + co * k * scale, 0.85 * scale);
    return c;
  }

  private bench(g: THREE.Group, x: number, z: number, yaw: number) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = yaw;
    const wood = this.mat("bench_wood", { color: 0x8a5a32, roughness: 0.8 });
    const iron = this.mat("iron", { color: 0x223a2a, roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < 3; i++) this.box(b, 1.8, 0.05, 0.12, wood, 0, 0.45, -0.15 + i * 0.15);
    for (let i = 0; i < 2; i++) this.box(b, 1.8, 0.12, 0.04, wood, 0, 0.7 + i * 0.18, -0.25);
    for (const sx of [-0.8, 0.8]) this.box(b, 0.06, 0.45, 0.45, iron, sx, 0.22, 0);
    g.add(b);
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const k of [-0.6, 0.6]) this.solid(x + c * k, z - s * k, 0.32);
  }

  private tree(g: THREE.Group, x: number, z: number, size: number, y = 0, solid = true) {
    const trunk = this.mat("trunk", { color: 0x6b4a2a, roughness: 0.9 });
    const leaves = this.mat("leaves", { color: 0x3f7a2e, roughness: 0.85 });
    this.cyl(g, 0.12 * size, 0.18 * size, 1.6 * size, trunk, x, y + 0.8 * size, z, 8);
    this.sphere(g, 1.1 * size, leaves, x, y + 2.4 * size, z, 1, 0.95, 1);
    if (solid) this.solid(x, z, 0.3 * size);
  }

  private hedge(g: THREE.Group, x1: number, z1: number, x2: number, z2: number) {
    const leaves = this.mat("hedge", { color: 0x3a6a2a, roughness: 0.9 });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = this.box(g, len, 1.1, 0.8, leaves, (x1 + x2) / 2, 0.55, (z1 + z2) / 2);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  }

  private buildStreetFurniture(g: THREE.Group) {
    // Street lamps: on every corner of the plaza and along the ring.
    const lampSpots: [number, number, number?][] = [
      [124.5, 233.5], [159.5, 233.5], [124.5, 266.5], [159.5, 266.5],
      [139.2, 207.0], [104.6, 206.5], [179.4, 206.5], [104.6, 230.5], [179.4, 230.5],
      [104.6, 270.6], [179.4, 270.6], [139.2, 270.6], [116, 206.5], [168, 230.6, 0.18],
    ];
    for (const [x, z, bent] of lampSpots) this.lamp(g, x, z, bent ?? 0);

    // Cars. The red one outside the garage is the one the model remembers.
    this.car(g, 143.4, 214, 0, 0xc0282e);
    this.car(g, 127.5, 263.5, Math.PI / 2, 0x2e6fc0);
    this.car(g, 156.6, 240, Math.PI, 0xe8c040);
    this.car(g, 101.4, 246, 0, 0x3a8a4a);
    this.car(g, 182.6, 218, Math.PI, 0x7a4ab0);
    this.car(g, 170, 269.4, Math.PI / 2, 0xe8e2d0, 1, 0.06);

    // The plaza: benches, flower beds, a little hedge round the tower.
    this.bench(g, 129.5, 238.4, Math.PI / 2);
    this.bench(g, 154.5, 238.4, -Math.PI / 2);
    this.bench(g, 129.5, 262, Math.PI / 2);
    this.bench(g, 136, 265.6, Math.PI);
    const bed = this.mat("flower_bed", { color: 0x5a3a20, roughness: 1 });
    const flowers = [0xe04a5a, 0xf2d24b, 0xffffff, 0xd98fb5];
    for (const [fx, fz] of [[134, 236], [150, 236], [134, 260], [150, 260]]) {
      this.box(g, 2.4, 0.35, 1.2, bed, fx, 0.17, fz);
      for (let i = 0; i < 10; i++) this.sphere(g, 0.12, this.mat(`flower_${flowers[i % 4]}`, { color: flowers[i % 4], roughness: 0.7 }), fx - 1.0 + (i % 5) * 0.5, 0.45, fz - 0.3 + Math.floor(i / 5) * 0.6);
      this.solid(fx - 0.6, fz, 0.6); this.solid(fx + 0.6, fz, 0.6);
    }

    // Things slightly out of place.
    this.chair(g, 126, 229.2, 0.4);
    const mailbox = new THREE.Group();
    // A mailbox, leaning like it's listening at a door.
    mailbox.position.set(148.6, 0, 228.6);
    mailbox.rotation.z = 0.35;
    this.box(mailbox, 0.12, 1.0, 0.12, this.mat("iron", { color: 0x223a2a, roughness: 0.5, metalness: 0.4 }), 0, 0.5, 0);
    this.box(mailbox, 0.5, 0.7, 0.4, this.mat("mailbox", { color: 0x2a4aa0, roughness: 0.5 }), 0, 1.35, 0);
    g.add(mailbox);
    this.solid(148.6, 228.6, 0.3);
    // A bicycle on the bakery roof, a lone shoe in the square, a door leaning on nothing.
    const bike = new THREE.Group();
    bike.position.set(150, FLOOR_H + 0.35, 210);
    const tyre = this.mat("car_black", { color: 0x141414, roughness: 0.5 });
    for (const bx of [-0.55, 0.55]) {
      const w = new THREE.Mesh(this.kit.geo("town_bike_wheel", () => new THREE.TorusGeometry(0.33, 0.03, 6, 20)), tyre);
      w.position.set(bx, 0.35, 0);
      bike.add(w);
    }
    this.box(bike, 1.1, 0.05, 0.05, this.mat("bike_frame", { color: 0xc0282e, roughness: 0.4 }), 0, 0.55, 0);
    g.add(bike);
    this.sphere(g, 0.14, this.mat("shoe", { color: 0x2a1a10, roughness: 0.4 }), 145.2, 0.08, 255.2, 1.6, 0.6, 0.9);
    const lone = new THREE.Group();
    lone.position.set(103.2, 0, 238);
    lone.rotation.set(0, Math.PI / 2, -0.12);
    this.box(lone, 1.0, 2.2, 0.08, this.mat("door_lone", { color: 0x6b2a2a, roughness: 0.6 }), 0, 1.1, 0);
    g.add(lone);
    this.solid(103.2, 238, 0.4);

    // Bus stop: a sign and a bench where everyone arrives.
    this.bench(g, 141.0, 275.4, Math.PI);
    const post = this.mat("iron", { color: 0x223a2a, roughness: 0.5, metalness: 0.4 });
    this.cyl(g, 0.05, 0.05, 2.6, post, 143.8, 1.3, 275.6, 8);
    this.plane(g, 0.7, 0.7, this.label(t("town.sign.bus"), 0.7, 0.7, "#ffffff", "#2a4aa0"), 143.8, 2.5, 275.55, Math.PI);
    this.solid(143.8, 275.6, 0.15);

    // Hedges and trees in the gaps between the outer houses.
    this.hedge(g, 89, 226, 99.5, 226);
    this.hedge(g, 89, 246, 99.5, 246);
    this.hedge(g, 184.5, 230, 195, 230);
    this.hedge(g, 184.5, 250, 195, 250);
    for (const [tx, tz, s] of [[94, 226, 1.0], [190, 228, 1.1], [94, 246, 0.9], [190, 248, 1.0], [118, 283, 1.2], [166, 283, 1.1], [136, 281, 0.8]] as [number, number, number][]) this.tree(g, tx, tz, s, 0, false);

    // The painter's fence on East St.
    const white = this.mat("picket", { color: 0xf6f3ea, roughness: 0.7 });
    for (let zz = 242; zz < 252; zz += 0.5) this.box(g, 0.05, 1.0, 0.1, white, 183.6, 0.5, zz);
  }

  // -------------------------------------------------------------------------
  // The hills
  // -------------------------------------------------------------------------

  private buildTerrain(g: THREE.Group) {
    const step = 3;
    const min = -72, max = TOWN_GRID * CELL + 72;
    const n = Math.round((max - min) / step) + 1;
    const pos = new Float32Array(n * n * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = min + i * step, z = min + j * step;
      const k = (i * n + j) * 3;
      pos[k] = x;
      pos[k + 1] = townGroundHeight(x, z) - 0.03;
      pos[k + 2] = z;
    }
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1;
      index.push(a, d, b, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * n * 2), 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.grassMat());
    mesh.userData.worldUV = true;
    g.add(mesh);
    // A few cartoon trees and lone houses up on the hills, like a postcard.
    const hilltop = (x: number, z: number) => townGroundHeight(x, z);
    const scatter: [number, number, number][] = [
      [70, 150, 1.4], [218, 140, 1.6], [60, 100, 1.2], [220, 70, 1.5], [96, 60, 1.3], [200, 196, 1.2], [80, 196, 1.4], [240, 120, 1.7],
      [56, 40, 1.3], [230, 30, 1.4], [108, 172, 1.0], [186, 104, 1.2], [70, 236, 1.3], [214, 246, 1.4], [140, 296, 1.6], [40, 160, 1.5],
    ];
    for (const [x, z, s] of scatter) this.tree(g, x, z, s, hilltop(x, z) - 0.2, false);
    const lone: [number, number, number, number][] = [[214, 160, 0xf2b8b5, 0x8f3b3b], [64, 120, 0xf3dc8c, 0x6b4a32], [222, 92, 0xa9d3e8, 0x3c5a7a], [84, 72, 0xc8d8f0, 0x40527a]];
    lone.forEach(([x, z, wall, roof], i) => {
      const y = hilltop(x, z) - 0.4;
      const fake: TownLot = { id: `hill${i}`, x1: 0, z1: 0, x2: 0, z2: 0, style: "cottage", wall, roof, floors: 1 };
      const house = new THREE.Group();
      house.position.set(x, y, z);
      house.rotation.y = i * 0.9;
      this.box(house, 6, 3.4, 5, this.facadeMat(fake), 0, 1.7, 0);
      const r = new THREE.Mesh(this.gableGeo(6, 5, 2.2, 0.35), this.mat(`roof_${roof}`, { color: roof, roughness: 0.7 }));
      r.position.y = 3.4;
      house.add(r);
      g.add(house);
    });
    // A water tower on the ridge west of the valley.
    const wt = new THREE.Group();
    wt.position.set(66, hilltop(66, 168), 168);
    const wood = this.mat("tower_wood", { color: 0x8a6a4a, roughness: 0.9 });
    for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) this.box(wt, 0.25, 9, 0.25, wood, lx, 4.5, lz);
    this.cyl(wt, 2.4, 2.4, 3.2, this.mat("tank", { color: 0xc8c8c0, roughness: 0.6, metalness: 0.3 }), 0, 10.6, 0, 16);
    const cone = new THREE.Mesh(this.kit.geo("town_tank_roof", () => new THREE.ConeGeometry(2.7, 1.6, 16)), this.mat("tank", { color: 0xc8c8c0, roughness: 0.6, metalness: 0.3 }));
    cone.position.y = 13;
    wt.add(cone);
    g.add(wt);
  }

  /** The road through the valley, and the abandoned furniture left on the grass. */
  private buildValley(g: THREE.Group) {
    const pts = VALLEY_PATH.map(([x, z]) => new THREE.Vector3(cellCenter(x), 0, cellCenter(z)));
    pts.unshift(new THREE.Vector3(cellCenter(35), 0, 203.5));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const samples = 160;
    const half = 1.9;
    const p: number[] = [], uv: number[] = [], line: number[] = [], lineUv: number[] = [];
    let dist = 0;
    const ribbon = (out: number[], outUv: number[], w: number, y: number, dashed: boolean) => {
      dist = 0;
      for (let i = 0; i < samples; i++) {
        const a = curve.getPoint(i / samples), b = curve.getPoint((i + 1) / samples);
        const ta = curve.getTangent(i / samples), tb = curve.getTangent((i + 1) / samples);
        const na = new THREE.Vector3(-ta.z, 0, ta.x).normalize().multiplyScalar(w);
        const nb = new THREE.Vector3(-tb.z, 0, tb.x).normalize().multiplyScalar(w);
        const seg = a.distanceTo(b);
        if (dashed && Math.floor(dist / 1.5) % 2 === 1) { dist += seg; continue; }
        const ya = (q: THREE.Vector3) => townGroundHeight(q.x, q.z) + y;
        const a1 = a.clone().add(na), a2 = a.clone().sub(na), b1 = b.clone().add(nb), b2 = b.clone().sub(nb);
        for (const v of [a1, a2, b1, b2]) v.y = ya(v);
        out.push(a1.x, a1.y, a1.z, a2.x, a2.y, a2.z, b1.x, b1.y, b1.z, a2.x, a2.y, a2.z, b2.x, b2.y, b2.z, b1.x, b1.y, b1.z);
        outUv.push(0, dist, w * 2, dist, 0, dist + seg, w * 2, dist, w * 2, dist + seg, 0, dist + seg);
        dist += seg;
      }
    };
    ribbon(p, uv, half, 0.06, false);
    ribbon(line, lineUv, 0.08, 0.075, true);
    const mk = (pos: number[], uvs: number[], mat: THREE.Material) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, mat));
    };
    mk(p, uv, this.asphaltMat());
    mk(line, lineUv, this.mat("road_line", { color: 0xe8b830, roughness: 0.7 }));

    // Telephone poles along the road.
    const poleMat = this.mat("pole_wood", { color: 0x5a4030, roughness: 0.9 });
    for (let i = 4; i < samples; i += 16) {
      const q = curve.getPoint(i / samples), tg = curve.getTangent(i / samples);
      const nx = -tg.z * 3.2, nz = tg.x * 3.2;
      const x = q.x + nx, z = q.z + nz, y = townGroundHeight(x, z);
      this.cyl(g, 0.11, 0.14, 7, poleMat, x, y + 3.5, z, 6);
      this.box(g, 1.6, 0.12, 0.12, poleMat, x, y + 6.4, z).rotation.y = Math.atan2(tg.x, tg.z);
      this.solid(x, z, 0.2);
    }

    // Furniture and pieces of houses, left out on the grass.
    const at = (x: number, z: number) => townGroundHeight(x, z);
    const place = (x: number, z: number, yaw: number, build: (h: THREE.Group) => void, r = 0.6) => {
      const h = new THREE.Group();
      h.position.set(x, at(x, z), z);
      h.rotation.y = yaw;
      build(h);
      g.add(h);
      if (r > 0) this.solid(x, z, r);
    };
    const wood = this.mat("furn_wood", { color: 0x7a4a28, roughness: 0.7 });
    this.armchair(g, 151, 172, 2.6, 0x4a7a5a, at(151, 172));
    place(166, 158, 0.3, (h) => {
      this.box(h, 1.4, 2.3, 0.7, this.mat("wardrobe", { color: 0x5a3a20, roughness: 0.7 }), 0, 1.15, 0);
      this.box(h, 0.04, 2.1, 0.02, this.mat("trim", { color: 0xf4efe2, roughness: 0.7 }), 0, 1.15, 0.36);
    }, 0.8);
    place(160, 146, -0.4, (h) => {
      this.table(h, 0, 0, 1.6, 1.0, 0.78, wood, false);
      this.chair(h, -1.1, 0, Math.PI / 2, wood, false);
      const fallen = this.chair(h, 1.2, 0.4, 0, wood, false);
      fallen.rotation.set(Math.PI / 2, 0.6, 0);
      fallen.position.y = 0.25;
    }, 0.9);
    place(140, 150, 0.2, (h) => {
      // A piece of wall with yellow wallpaper and a window, standing on its own.
      const yellow = this.wallpaperMat("lonely", "#d8c36a", "#cdb75c");
      this.box(h, 5, 3, 0.25, yellow, 0, 1.5, 0);
      this.box(h, 1.2, 1.2, 0.27, this.innerWindow, -1, 1.7, 0);
      this.box(h, 5.1, 0.18, 0.3, this.mat("trim", { color: 0xf4efe2, roughness: 0.7 }), 0, 0.09, 0);
    }, 0);
    this.wallLine(137.55, 150.5, 142.45, 149.5);
    place(126, 146, 1.1, (h) => this.bed(h, 0, 0, 0, false), 0.9);
    place(112, 142, 0.0, (h) => {
      // A stop sign, for no road.
      this.cyl(h, 0.05, 0.05, 2.4, this.mat("iron_grey", { color: 0x8a8a8a, roughness: 0.5, metalness: 0.6 }), 0, 1.2, 0, 8);
      const sign = new THREE.Mesh(this.kit.geo("town_stop", () => new THREE.CircleGeometry(0.42, 8)), this.label(t("town.sign.stop"), 0.84, 0.84, "#ffffff", "#c8202a"));
      sign.position.set(0, 2.4, 0.06);
      sign.rotation.z = Math.PI / 8;
      h.add(sign);
    }, 0.15);
    place(104, 128, 0.7, (h) => {
      // A door frame with a door in it, and nothing on either side.
      const trim = this.mat("trim", { color: 0xf4efe2, roughness: 0.7 });
      this.box(h, 0.2, 2.5, 0.2, trim, -0.7, 1.25, 0);
      this.box(h, 0.2, 2.5, 0.2, trim, 0.7, 1.25, 0);
      this.box(h, 1.6, 0.2, 0.2, trim, 0, 2.5, 0);
      this.box(h, 1.2, 2.3, 0.06, this.mat("door_lone", { color: 0x6b2a2a, roughness: 0.6 }), 0, 1.15, 0);
    }, 0.6);
    place(106, 116, 2.0, (h) => {
      // A standing lamp, still on.
      this.cyl(h, 0.03, 0.03, 1.6, this.mat("iron_grey", { color: 0x8a8a8a, roughness: 0.5, metalness: 0.6 }), 0, 0.8, 0, 6);
      this.cyl(h, 0.18, 0.3, 0.35, this.mat("shade", { color: 0xf0d8a0, emissive: 0xffc070, emissiveIntensity: 0.8, roughness: 0.8 }), 0, 1.7, 0, 12);
    }, 0.2);
    place(118, 120, -0.6, (h) => {
      // A bathtub.
      this.box(h, 1.7, 0.6, 0.8, this.mat("enamel", { color: 0xf4f4f0, roughness: 0.3 }), 0, 0.42, 0);
      for (const [fx, fz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) this.sphere(h, 0.08, this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 }), fx, 0.08, fz);
    }, 0.8);
    place(132, 120, 0.4, (h) => {
      // A picket fence and its gate, fencing in nothing.
      const white = this.mat("picket", { color: 0xf6f3ea, roughness: 0.7 });
      for (let x = -3; x <= 3; x += 0.5) if (Math.abs(x) > 0.6) this.box(h, 0.1, 1.0, 0.05, white, x, 0.5, 0);
      this.box(h, 6.2, 0.08, 0.06, white, 0, 0.75, 0.04);
    }, 0);
    place(140, 124, -0.9, (h) => {
      // A grandfather clock, stopped at the same time as the tower.
      this.box(h, 0.6, 2.1, 0.4, this.mat("clock_wood", { color: 0x4a2a14, roughness: 0.6 }), 0, 1.05, 0);
      const face = new THREE.Mesh(this.kit.geo("town_clock_disc_small", () => new THREE.CircleGeometry(0.2, 24)), this.clockGlow);
      face.position.set(0, 1.75, 0.205);
      h.add(face);
    }, 0.4);
    place(170, 172, 1.9, (h) => {
      // A radio on a stool, playing to nobody.
      this.box(h, 0.4, 0.5, 0.4, wood, 0, 0.25, 0);
      this.box(h, 0.5, 0.4, 0.3, this.mat("radio", { color: 0x6b4a2a, roughness: 0.5 }), 0, 0.7, 0);
    }, 0.35);
    place(130, 154, 2.8, (h) => {
      // A piano on the grass.
      this.box(h, 1.6, 1.3, 0.6, this.mat("piano", { color: 0x1a120c, roughness: 0.3 }), 0, 0.65, 0);
      this.box(h, 1.5, 0.05, 0.25, this.mat("keys", { color: 0xf4efe2, roughness: 0.4 }), 0, 0.78, 0.42);
    }, 0.9);
    place(160, 182, -0.3, (h) => {
      // An old television.
      this.box(h, 0.7, 0.6, 0.55, this.mat("tv", { color: 0x5a3a20, roughness: 0.6 }), 0, 0.3, 0);
      this.box(h, 0.5, 0.4, 0.02, this.mat("tv_screen", { color: 0x2a3a3a, emissive: 0x405a5a, emissiveIntensity: 0.4, roughness: 0.2 }), -0.05, 0.32, 0.28);
    }, 0.4);
    // The castle's courtyard: two hedges flanking the approach.
    this.hedge(g, 132, 114, 132, 124);
    this.hedge(g, 152, 114, 152, 124);
    this.wallLine(132, 114, 132, 124);
    this.wallLine(152, 114, 152, 124);
  }

  // -------------------------------------------------------------------------
  // The castle
  // -------------------------------------------------------------------------

  private castleStone(): THREE.MeshStandardMaterial {
    return this.mat("castle_stone", {
      map: this.tex("castle_stone", 128, 128, [3, 3], (c, w, h) => {
        c.fillStyle = "#e6b8c8"; c.fillRect(0, 0, w, h);
        c.strokeStyle = "#b88898"; c.lineWidth = 3;
        for (let y = 0; y < h; y += 32) {
          c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
          for (let x = (y / 32) % 2 ? 0 : 32; x < w; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); }
        }
      }), roughness: 0.85,
    });
  }

  /** A round tower with a cone roof and a flag (`tilt` makes it lean a little, like a toy). */
  private tower(g: THREE.Group, x: number, z: number, r: number, h: number, roofColor: number, tilt = 0, y0 = 0, roofless = false) {
    const t = new THREE.Group();
    t.position.set(x, y0, z);
    t.rotation.z = tilt;
    if (y0 === 0) this.solid(x, z, r + 0.2);
    const stripes = this.mat("castle_tower", {
      map: this.tex("castle_tower", 64, 128, [4, 4], (c, w, hh) => {
        c.fillStyle = "#f2d0dc"; c.fillRect(0, 0, w, hh);
        c.fillStyle = "#e0a8bc";
        for (let y = 0; y < hh; y += 32) c.fillRect(0, y, w, 12);
      }), roughness: 0.8,
    });
    this.cyl(t, r, r * 1.05, h, stripes, 0, h / 2, 0, 18);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.box(t, 0.8, 1.0, 0.8, stripes, Math.sin(a) * r, h + 0.5, Math.cos(a) * r, a);
    }
    if (roofless) { g.add(t); return; }
    const roof = new THREE.Mesh(this.kit.geo(`town_cone_${r}`, () => new THREE.ConeGeometry(r * 1.25, r * 2.6, 18)), this.mat(`castle_roof_${roofColor}`, { color: roofColor, roughness: 0.55 }));
    roof.position.y = h + 1 + r * 1.3;
    t.add(roof);
    this.cyl(t, 0.08, 0.08, 3, this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 }), 0, h + 1 + r * 2.6 + 1.2, 0, 6);
    const flag = new THREE.Mesh(this.kit.geo("town_flag", () => new THREE.PlaneGeometry(1.8, 1.0).translate(0.9, 0, 0)), this.mat("flag", { color: 0xd9a830, roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.set(0, h + 1 + r * 2.6 + 2.2, 0);
    flag.userData.dynamic = true;
    t.add(flag);
    this.flags.push(flag);
    g.add(t);
  }

  /** The outside: thick pink walls, battlements, candy-striped towers, a keep with a crown on top. */
  private buildCastleShell(g: THREE.Group) {
    const stone = this.castleStone();
    const f = CASTLE_FOOTPRINT;
    const x0 = f.x1 * CELL, x1 = (f.x2 + 1) * CELL, z0 = f.z1 * CELL, z1 = (f.z2 + 1) * CELL;
    const H = 15;
    const gateX = cellCenter(35);
    // South wall with the gate opening (4 m wide, 5.2 m high).
    this.box(g, gateX - 2 - x0, H, 1.0, stone, (x0 + gateX - 2) / 2, H / 2, z1 - 0.5);
    this.box(g, x1 - gateX - 2, H, 1.0, stone, (gateX + 2 + x1) / 2, H / 2, z1 - 0.5);
    this.box(g, 4, H - 5.2, 1.0, stone, gateX, 5.2 + (H - 5.2) / 2, z1 - 0.5);
    this.box(g, x1 - x0, H, 1.0, stone, (x0 + x1) / 2, H / 2, z0 + 0.5);
    this.box(g, 1.0, H, z1 - z0, stone, x0 + 0.5, H / 2, (z0 + z1) / 2);
    this.box(g, 1.0, H, z1 - z0, stone, x1 - 0.5, H / 2, (z0 + z1) / 2);
    this.box(g, x1 - x0, 0.6, z1 - z0, this.mat("castle_roof_flat", { color: 0x8a6a7a, roughness: 0.9 }), (x0 + x1) / 2, H, (z0 + z1) / 2);
    // Battlements.
    for (let x = x0 + 1; x < x1; x += 2.2) { this.box(g, 1.1, 1.3, 1.0, stone, x, H + 0.95, z1 - 0.5); this.box(g, 1.1, 1.3, 1.0, stone, x, H + 0.95, z0 + 0.5); }
    for (let z = z0 + 1; z < z1; z += 2.2) { this.box(g, 1.0, 1.3, 1.1, stone, x0 + 0.5, H + 0.95, z); this.box(g, 1.0, 1.3, 1.1, stone, x1 - 0.5, H + 0.95, z); }
    // The gate arch, the gatehouse towers and banners.
    const red = this.mat("castle_banner", { color: 0xb0203a, roughness: 0.8, side: THREE.DoubleSide });
    this.box(g, 5.2, 0.7, 1.4, this.mat("gilt", { color: 0xc9962a, roughness: 0.35, metalness: 0.6 }), gateX, 5.5, z1 - 0.3);
    this.plane(g, 3.4, 0.8, this.label(t("town.sign.castle"), 3.4, 0.8, "#f6e2a0", "#5a0f1c"), gateX, 7.0, z1 + 0.02);
    for (const bx of [gateX - 7, gateX + 7]) this.plane(g, 2.0, 7.0, red, bx, 9, z1 + 0.04);
    this.tower(g, gateX - 4.6, z1 + 1.2, 2.4, 19, 0x3a5ab0, -0.02);
    this.tower(g, gateX + 4.6, z1 + 1.2, 2.4, 19, 0x3a5ab0, 0.025);
    // Corner towers, each leaning its own way.
    this.tower(g, x0, z1, 3.2, 22, 0xb0203a, 0.03);
    this.tower(g, x1, z1, 3.2, 22, 0xb0203a, -0.025);
    this.tower(g, x0, z0, 3.6, 27, 0x3a5ab0, 0.02);
    this.tower(g, x1, z0, 3.6, 27, 0x3a5ab0, -0.035);
    this.tower(g, x0, (z0 + z1) / 2, 2.8, 20, 0xd9a830, 0.0);
    this.tower(g, x1, (z0 + z1) / 2, 2.8, 20, 0xd9a830, 0.0);
    // The keep over the throne room, its tower and the crown on top.
    const kz0 = z0 + 1, kz1 = 13 * CELL;
    this.box(g, x1 - x0 - 4, 9, kz1 - kz0, stone, (x0 + x1) / 2, H + 4.5, (kz0 + kz1) / 2);
    // The keep's tower rises from the keep's roof, not from the hall below it; a crown instead of a roof.
    const keepTop = H + 9;
    this.tower(g, gateX, (kz0 + kz1) / 2 - 4, 5.5, 16, 0x5a2a7a, 0, keepTop, true);
    const crown = new THREE.Group();
    crown.position.set(gateX, keepTop + 16 + 2.2, (kz0 + kz1) / 2 - 4);
    const gold = this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 });
    this.cyl(crown, 3.2, 3.0, 2.2, gold, 0, 0, 0, 20);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(this.kit.geo("town_crown_spike", () => new THREE.ConeGeometry(0.55, 2.4, 6)), gold);
      spike.position.set(Math.sin(a) * 3.0, 2.2, Math.cos(a) * 3.0);
      crown.add(spike);
    }
    g.add(crown);
  }

  private roomH(region: string): number {
    return ROOM_H[region] ?? 6;
  }

  /** Floors, ceilings and walls of every castle cell, from the cell grid. */
  private buildCastleRooms(g: THREE.Group) {
    const floors: Record<string, THREE.Material> = {
      entrance: this.mat("castle_checker", {
        map: this.tex("castle_checker", 128, 128, [2, 2], (c, w, h) => {
          for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = (x + y) % 2 ? "#1a1a1a" : "#f2ead8"; c.fillRect(x * w / 2, y * h / 2, w / 2, h / 2); }
        }), roughness: 0.4,
      }),
      animRoom: this.woodFloorMat(),
      corridor: this.mat("castle_corridor", { color: 0x3a2a4a, roughness: 0.8 }),
      throne: this.mat("castle_throne_floor", {
        map: this.tex("castle_throne_floor", 128, 128, [4, 4], (c, w, h) => {
          c.fillStyle = "#5a4a5a"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "#3a2a3a"; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
          c.strokeRect(w / 4, h / 4, w / 2, h / 2);
        }), roughness: 0.6,
      }),
    };
    const walls: Record<string, THREE.Material> = {
      entrance: this.wallpaperMat("castle_entrance", "#d02a4a", "#f4d0a0"),
      animRoom: this.wallpaperMat("castle_anim", "#2a5a3a", "#24502f"),
      corridor: this.wallpaperMat("castle_corridor", "#4a2a6a", "#5a3a7a"),
      throne: this.mat("castle_throne_wall", {
        map: this.tex("castle_throne_wall", 128, 256, [4, 8], (c, w, h) => {
          c.fillStyle = "#6a0f1f"; c.fillRect(0, 0, w, h);
          c.fillStyle = "#4a0a15";
          for (let x = 8; x < w; x += 32) c.fillRect(x, 0, 6, h);
          c.fillStyle = "#c9962a"; c.fillRect(0, h - 20, w, 6); c.fillRect(0, 30, w, 4);
        }), roughness: 0.85,
      }),
    };
    const stone = this.castleStone();
    const ceilMat = this.mat("castle_ceiling", { color: 0x2a1a2a, roughness: 0.95 });
    for (let x = CASTLE_FOOTPRINT.x1; x <= CASTLE_FOOTPRINT.x2; x++) {
      for (let z = CASTLE_FOOTPRINT.z1; z <= CASTLE_FOOTPRINT.z2; z++) {
        const cell = townCellAt(x, z);
        if (!cell) continue;
        const region = cell.region;
        const h = this.roomH(region);
        const x0 = x * CELL, z0 = z * CELL;
        if (region === "exit") {
          // The way out: a doorway full of white light.
          const white = this.basic("exit_white", { color: 0xffffff });
          this.ground(g, x0, z0, x0 + CELL, z0 + CELL, 0.02, white);
          this.box(g, CELL, h, 0.1, white, x0 + 2, h / 2, z0 + 0.05);
          this.box(g, 0.1, h, CELL, white, x0 + 0.05, h / 2, z0 + 2);
          this.box(g, 0.1, h, CELL, white, x0 + CELL - 0.05, h / 2, z0 + 2);
          this.box(g, CELL, 0.1, CELL, white, x0 + 2, h, z0 + 2);
          continue;
        }
        const floorMat = floors[region] ?? floors.corridor;
        this.ground(g, x0, z0, x0 + CELL, z0 + CELL, 0.02, floorMat);
        const ceil = new THREE.Mesh(this.kit.geo("town_unit_ceil", () => new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)), ceilMat);
        ceil.position.set(x0 + 2, h, z0 + 2);
        ceil.scale.set(CELL, 1, CELL);
        g.add(ceil);
        const wallMat = walls[region] ?? stone;
        for (const side of ["N", "S", "W", "E"] as TownSide[]) {
          const s = SIDES[side];
          const n = townCellAt(x + s.dx, z + s.dz);
          const along = side === "N" || side === "S";
          const wx = side === "W" ? x0 : side === "E" ? x0 + CELL : x0 + 2;
          const wz = side === "N" ? z0 : side === "S" ? z0 + CELL : z0 + 2;
          const inward = side === "N" || side === "W" ? 0.05 : -0.05;
          const put = (y0: number, y1: number) => {
            if (y1 - y0 < 0.01) return;
            if (along) this.box(g, CELL, y1 - y0, 0.1, wallMat, wx, (y0 + y1) / 2, wz + inward);
            else this.box(g, 0.1, y1 - y0, CELL, wallMat, wx + inward, (y0 + y1) / 2, wz);
          };
          if (!n || n.zone !== "castle" && n.region !== "valley") {
            put(0, h);
          } else if (n.region === "valley") {
            // The gate's outside: open.
            continue;
          } else if (n.region !== region) {
            // An opening into the next room: only the lintel above it.
            const nh = Math.min(h, this.roomH(n.region));
            put(nh, h);
          }
        }
      }
    }
    // Room lights: odd, saturated colours in the entrance, warm lamps elsewhere.
    const light = (x: number, y: number, z: number, color: number, intensity: number, dist: number) => {
      const src = this.env.registerLight(Math.floor(x / CELL), Math.floor(z / CELL), x, y, z, color, intensity, dist, 1.1);
      this.castleLights.push({ src, base: intensity });
      return src;
    };
    light(134, 5.5, 92, 0xff4ad0, 2.4, 14);
    light(150, 5.5, 92, 0x4ad8ff, 2.4, 14);
    light(142, 5.5, 100, 0xffe04a, 1.8, 12);
    light(132, 4.5, 72, 0xffc890, 1.8, 11);
    light(152, 4.5, 72, 0xffc890, 1.8, 11);
    light(142, 3.2, 58, 0xb070ff, 1.4, 8);
    light(130, 6, 44, 0xff3a2a, 1.6, 14);
    light(154, 6, 44, 0xff3a2a, 1.6, 14);
    light(130, 6, 20, 0xff3a2a, 1.6, 14);
    light(154, 6, 20, 0xff3a2a, 1.6, 14);
    this.kingLight = this.env.registerLight(KING_THRONE.gx, KING_THRONE.gz, cellCenter(KING_THRONE.gx), 8.5, cellCenter(KING_THRONE.gz) + 1, 0xffd090, 3.4, 16, 1.0);
    this.exitLight = this.env.registerLight(TOWN_EXIT.gx, TOWN_EXIT.gz, cellCenter(TOWN_EXIT.gx), 2.5, cellCenter(TOWN_EXIT.gz), 0xffffff, 3.0, 12, 1.0);
  }

  /** The entrance hall: toys, paintings, strange light. */
  private buildEntrance(g: THREE.Group) {
    // Giant alphabet blocks.
    const letters = ["A", "B", "C", "K", "I", "N", "G"];
    const blockColors = ["#d02a4a", "#3a5ab0", "#e8b830", "#3a8a4a"];
    letters.forEach((l, i) => {
      const mat = this.mat(`block_${l}`, {
        map: this.tex(`block_${l}`, 128, 128, null, (c, w, h) => {
          c.fillStyle = "#f2ead8"; c.fillRect(0, 0, w, h);
          c.fillStyle = blockColors[i % 4]; c.fillRect(8, 8, w - 16, h - 16);
          c.fillStyle = "#f2ead8"; c.font = "bold 90px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(l, w / 2, h / 2 + 4);
        }), roughness: 0.7,
      });
      const x = 130 + (i % 4) * 1.4, z = 98 + Math.floor(i / 4) * 1.5;
      const stackY = i === 6 ? 1.2 : 0;
      this.box(g, 1.2, 1.2, 1.2, mat, i === 6 ? 131.2 : x, 0.6 + stackY, i === 6 ? 98 : z, (i * 0.37) % 0.6);
      if (i !== 6) this.solid(x, z, 0.75);
    });
    // A rocking horse.
    const horse = new THREE.Group();
    horse.position.set(152, 0, 98);
    horse.rotation.y = -0.6;
    const paint = this.mat("horse", { color: 0xf2ead8, roughness: 0.6 });
    const redP = this.mat("horse_red", { color: 0xd02a4a, roughness: 0.6 });
    this.sphere(horse, 0.6, paint, 0, 1.1, 0, 1.6, 0.8, 0.8);
    this.sphere(horse, 0.35, paint, 0.95, 1.6, 0, 1.2, 0.8, 0.7);
    this.box(horse, 2.4, 0.12, 0.6, redP, 0, 0.3, 0);
    for (const sx of [-0.6, 0.6]) for (const sz of [-0.2, 0.2]) this.box(horse, 0.12, 0.6, 0.12, paint, sx, 0.65, sz);
    g.add(horse);
    this.solid(152, 98, 1.1);
    // Toy soldiers flanking the way in.
    for (const sx of [137.5, 146.5]) {
      const s = new THREE.Group();
      s.position.set(sx, 0, 102);
      this.cyl(s, 0.45, 0.45, 1.4, this.mat("soldier_red", { color: 0xc0202a, roughness: 0.5 }), 0, 1.6, 0, 14);
      this.cyl(s, 0.4, 0.4, 1.0, this.mat("soldier_blue", { color: 0x1a2a6a, roughness: 0.5 }), 0, 0.5, 0, 14);
      this.sphere(s, 0.38, this.mat("soldier_face", { color: 0xf3d2b0, roughness: 0.6 }), 0, 2.6, 0);
      this.cyl(s, 0.36, 0.36, 0.9, this.mat("soldier_hat", { color: 0x111111, roughness: 0.6 }), 0, 3.3, 0, 14);
      g.add(s);
      this.solid(sx, 102, 0.55);
    }
    // Paintings: the King, a townsperson, and the town itself seen from above (the model's clue).
    this.frame(g, 128.12, 3.4, 94, Math.PI / 2, 2.2, 2.8, (c, w, h) => {
      c.fillStyle = "#3a0a14"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#121212"; c.beginPath(); c.arc(w / 2, h * 0.45, w * 0.28, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#efe2c4"; c.beginPath(); c.ellipse(w / 2, h * 0.5, w * 0.2, w * 0.21, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#d9a830"; c.fillRect(w * 0.3, h * 0.18, w * 0.4, h * 0.07);
      for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(w * (0.3 + i * 0.1), h * 0.18); c.lineTo(w * (0.35 + i * 0.1), h * 0.1); c.lineTo(w * (0.4 + i * 0.1), h * 0.18); c.fill(); }
      c.fillStyle = "#0b0b0b"; c.beginPath(); c.ellipse(w * 0.43, h * 0.45, 8, 16, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(w * 0.57, h * 0.45, 8, 16, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(w * 0.36, h * 0.55); c.quadraticCurveTo(w / 2, h * 0.68, w * 0.64, h * 0.55); c.quadraticCurveTo(w / 2, h * 0.6, w * 0.36, h * 0.55); c.fill();
      c.fillStyle = "#7a1424"; c.fillRect(w * 0.15, h * 0.72, w * 0.7, h * 0.3);
    }, "king");
    this.frame(g, 155.88, 3.4, 94, -Math.PI / 2, 3.4, 2.4, (c, w, h) => this.paintTownPlan(c, w, h, true), "plan");
    const plaque = this.label(t("town.sign.plan"), 2.6, 0.32, "#2b1a10", "#e9d8a8", "italic");
    this.plane(g, 2.6, 0.32, plaque, 155.86, 1.85, 94, -Math.PI / 2);
    this.frame(g, 134, 3.6, 88.12, 0, 1.6, 2.0, (c, w, h) => {
      c.fillStyle = "#e9d8a8"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#4fa87a"; c.fillRect(w * 0.25, h * 0.5, w * 0.5, h * 0.5);
      c.fillStyle = "#f3d2b0"; c.beginPath(); c.arc(w / 2, h * 0.38, w * 0.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#2b2b2b"; c.fillRect(w * 0.3, h * 0.12, w * 0.4, h * 0.08);
      c.fillStyle = "#0b0b0b"; c.beginPath(); c.ellipse(w * 0.44, h * 0.36, 4, 9, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(w * 0.56, h * 0.36, 4, 9, 0, 0, Math.PI * 2); c.fill();
    }, "folk");
    // A gramophone on a little table.
    this.table(g, 133, 90, 0.8, 0.8, 0.8);
    const horn = new THREE.Mesh(this.kit.geo("town_horn", () => new THREE.ConeGeometry(0.4, 0.8, 16, 1, true)), this.mat("brass", { color: 0xd9a830, roughness: 0.3, metalness: 0.8 }));
    horn.position.set(133, 1.4, 90);
    horn.rotation.x = Math.PI * 0.75;
    g.add(horn);
    // A welcome sign over the door through to the next room.
    this.plane(g, 3.4, 0.6, this.label(t("town.sign.animRoom"), 3.4, 0.6, "#f6e2a0", "#5a0f1c"), 142, 5.2, 88.1);
  }

  /** The town plan, as the painting in the entrance (and the model's base) draws it. */
  private paintTownPlan(c: CanvasRenderingContext2D, w: number, h: number, painting: boolean) {
    const f = TOWN_FOOTPRINT;
    const sx = w / ((f.x2 - f.x1 + 1) * CELL), sz = h / ((f.z2 - f.z1 + 1) * CELL);
    c.fillStyle = "#6fa04a"; c.fillRect(0, 0, w, h);
    const rect = (x0: number, z0: number, x1: number, z1: number, col: string) => {
      c.fillStyle = col;
      c.fillRect((x0 - f.x1 * CELL) * sx, (z0 - f.z1 * CELL) * sz, (x1 - x0) * sx, (z1 - z0) * sz);
    };
    for (const r of TOWN_STREETS) rect(r.x1 * CELL, r.z1 * CELL, (r.x2 + 1) * CELL, (r.z2 + 1) * CELL, r.kind === "plaza" ? "#b8a890" : r.kind === "alley" ? "#8a7660" : "#6a6a6e");
    rect(140, 200, 144, 204, "#6a6a6e");
    if (!painting) return;
    // The painting shows every house, the tower, and the red car where it belongs.
    for (const l of TOWN_LOTS) rect(l.x1 * CELL + 0.6, l.z1 * CELL + 0.6, (l.x2 + 1) * CELL - 0.6, (l.z2 + 1) * CELL - 0.6, hex(l.roof));
    const lc = townLot(STAY_HOUSE);
    rect(lc.x1 * CELL + 0.6, lc.z1 * CELL + 0.6, (lc.x2 + 1) * CELL - 0.6, (lc.z2 + 1) * CELL - 0.6, "#40527a");
    rect(140, 248, 144, 252, "#e9d8a8");
    c.fillStyle = "#1a1a1a"; c.beginPath(); c.arc((142 - f.x1 * CELL) * sx, (250 - f.z1 * CELL) * sz, 2.2 * sx, 0, Math.PI * 2); c.fill();
    rect(142.6, 212.2, 144.2, 215.8, "#c0282e");
  }

  /** The Animation Room: the model of the town, the projector, the gate north. */
  private buildAnimationRoom(g: THREE.Group) {
    const T = MODEL_TABLE;
    const f = TOWN_FOOTPRINT;
    const mw = (f.x2 - f.x1 + 1) * CELL * MODEL_SCALE, md = (f.z2 - f.z1 + 1) * CELL * MODEL_SCALE;
    // The table and the model's base, painted with the streets.
    const wood = this.mat("model_table", { color: 0x5a3a20, roughness: 0.6 });
    this.box(g, mw + 0.6, 0.12, md + 0.6, wood, T.x, T.y - 0.06, T.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(g, 0.15, T.y - 0.12, 0.15, wood, T.x + sx * (mw / 2 + 0.15), (T.y - 0.12) / 2, T.z + sz * (md / 2 + 0.15));
    const base = this.tex("model_base", 512, 400, null, (c, w, h) => this.paintTownPlan(c, w, h, false));
    const baseMesh = new THREE.Mesh(this.kit.geo("town_model_base", () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), this.mat("model_base", { map: base, roughness: 0.8 }));
    baseMesh.position.set(T.x, T.y + 0.005, T.z);
    baseMesh.scale.set(mw, 1, md);
    g.add(baseMesh);
    this.wallLine(T.x - mw / 2 - 0.2, T.z - md / 2 - 0.2, T.x + mw / 2 + 0.2, T.z - md / 2 - 0.2);
    this.wallLine(T.x - mw / 2 - 0.2, T.z + md / 2 + 0.2, T.x + mw / 2 + 0.2, T.z + md / 2 + 0.2);
    this.wallLine(T.x - mw / 2 - 0.2, T.z - md / 2 - 0.2, T.x - mw / 2 - 0.2, T.z + md / 2 + 0.2);
    this.wallLine(T.x + mw / 2 + 0.2, T.z - md / 2 - 0.2, T.x + mw / 2 + 0.2, T.z + md / 2 + 0.2);
    // Every house in miniature, except the one whose lot stands empty (but for a tiny chair).
    for (const l of TOWN_LOTS) {
      if (l.id === STAY_HOUSE) continue;
      const [ax, az] = modelPoint(l.x1 * CELL + 0.4, l.z1 * CELL + 0.4);
      const [bx, bz] = modelPoint((l.x2 + 1) * CELL - 0.4, (l.z2 + 1) * CELL - 0.4);
      const hh = (l.floors * FLOOR_H) * MODEL_SCALE * 1.4;
      this.box(g, bx - ax, hh, bz - az, this.mat(`model_wall_${l.wall}`, { color: l.wall, roughness: 0.7 }), (ax + bx) / 2, T.y + hh / 2, (az + bz) / 2);
      this.box(g, bx - ax + 0.02, 0.025, bz - az + 0.02, this.mat(`roof_${l.roof}`, { color: l.roof, roughness: 0.7 }), (ax + bx) / 2, T.y + hh + 0.012, (az + bz) / 2);
    }
    const lc = townLot(STAY_HOUSE);
    const [cx, cz] = modelPoint((lc.x1 + lc.x2 + 1) * CELL / 2, (lc.z1 + lc.z2 + 1) * CELL / 2);
    const tiny = this.chair(new THREE.Group(), 0, 0, Math.PI, this.mat("stay_chair", { color: 0x6b2a2a, roughness: 0.7 }), false);
    tiny.position.set(cx, T.y, cz);
    tiny.scale.setScalar(0.12);
    g.add(tiny);

    // The three pieces that are out of place.
    const house = new THREE.Group();
    this.box(house, (lc.x2 - lc.x1 + 1) * CELL * MODEL_SCALE * 0.9, 0.18, (lc.z2 - lc.z1 + 1) * CELL * MODEL_SCALE * 0.9, this.mat(`model_wall_${lc.wall}`, { color: lc.wall, roughness: 0.7 }), 0, 0.09 - 0.06, 0);
    const hr = new THREE.Mesh(this.gableGeo(0.32, 0.45, 0.12, 0.02), this.mat(`roof_${lc.roof}`, { color: lc.roof, roughness: 0.7 }));
    hr.rotation.y = Math.PI / 2;
    hr.position.y = 0.12;
    house.add(hr);
    const car = new THREE.Group();
    this.car(car, 0, 0, 0, 0xc0282e, 0.06, 0, false);
    car.position.y = -0.06;
    const clock = new THREE.Group();
    this.box(clock, 0.16, 0.95, 0.16, this.mat("tower_model", { color: 0xd8c8b0, roughness: 0.8 }), 0, 0.475 - 0.06, 0);
    const sp = new THREE.Mesh(this.kit.geo("town_model_spire", () => new THREE.ConeGeometry(0.13, 0.28, 4)), this.mat("tower_roof", { color: 0x2f5f4a, roughness: 0.6 }));
    sp.position.y = 0.95 + 0.14 - 0.06;
    sp.rotation.y = Math.PI / 4;
    clock.add(sp);
    const pieces: Record<ModelPieceId, THREE.Group> = { house, car, clock };
    for (const id of MODEL_PIECES) {
      const holder = new THREE.Group();
      holder.add(pieces[id]);
      holder.userData.dynamic = true;
      holder.traverse((o) => { o.userData.dynamic = true; });
      this.root.add(holder);
      this.modelPieces.set(id, holder);
      this.setModelSlot(id, 0);
    }

    // Drawing desks with animation cels, film cans, shelves of reels.
    for (const [dx, dz, yaw] of [[131, 80, 0], [153, 80, 0], [131, 66.5, Math.PI], [153, 66.5, Math.PI]] as [number, number, number][]) {
      const d = new THREE.Group();
      d.position.set(dx, 0, dz);
      d.rotation.y = yaw;
      this.box(d, 1.6, 0.06, 0.9, wood, 0, 0.85, 0);
      const top = this.box(d, 1.2, 0.04, 0.7, this.mat("lightbox", { color: 0xf4f0e0, emissive: 0xfff2d0, emissiveIntensity: 0.6, roughness: 0.4 }), 0, 0.92, 0);
      top.rotation.x = -0.3;
      for (const sx of [-0.7, 0.7]) this.box(d, 0.06, 0.85, 0.8, wood, sx, 0.425, 0);
      g.add(d);
      this.solid(dx, dz, 0.8);
    }
    const can = this.mat("film_can", { color: 0x8a8a90, roughness: 0.3, metalness: 0.7 });
    for (let i = 0; i < 9; i++) this.cyl(g, 0.3, 0.3, 0.06, can, 155 - (i % 3) * 0.7, 0.03 + Math.floor(i / 3) * 0.07, 75 + (i % 2) * 0.3, 16);
    // The projector and its screen on the east wall.
    const proj = new THREE.Group();
    proj.position.set(132, 0, 73);
    this.box(proj, 0.12, 1.2, 0.12, this.mat("iron", { color: 0x223a2a, roughness: 0.5, metalness: 0.4 }), 0, 0.6, 0);
    this.box(proj, 0.6, 0.45, 0.4, this.mat("projector", { color: 0x2a2a2a, roughness: 0.4, metalness: 0.5 }), 0, 1.4, 0);
    for (const rz of [-0.3, 0.3]) { const reel = this.cyl(proj, 0.3, 0.3, 0.05, can, -0.05, 1.85, rz, 16); reel.rotation.x = Math.PI / 2; }
    g.add(proj);
    this.solid(132, 73, 0.4);
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 192;
    const screenTex = new THREE.CanvasTexture(canvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    this.kit.track(screenTex);
    this.projector = { canvas, tex: screenTex, next: 0, frame: 0 };
    const screen = this.plane(g, 4.4, 3.3, this.basic("projector_screen", { map: screenTex }), 155.86, 3.0, 73, -Math.PI / 2);
    screen.userData.dynamic = true;
    this.drawProjector(0);
    // The gate north to the throne room, and its three bulbs.
    this.plane(g, 3.6, 0.5, this.label(t("town.sign.model"), 3.6, 0.5, "#f6e2a0", "#2a1a10"), 142, 4.9, 64.08);
  }

  /** The projector's loop: two little figures dancing, film grain, sprocket flicker. */
  private drawProjector(frame: number) {
    const { canvas, tex } = this.projector;
    const c = canvas.getContext("2d")!;
    const w = canvas.width, h = canvas.height;
    const flick = 0.85 + ((frame * 7919) % 13) / 90;
    c.fillStyle = `rgb(${Math.round(230 * flick)},${Math.round(226 * flick)},${Math.round(210 * flick)})`;
    c.fillRect(0, 0, w, h);
    const t2 = frame / 8;
    for (const side of [-1, 1]) {
      const x = w / 2 + side * 50 + Math.sin(t2 * 3 + side) * 6;
      const bob = Math.abs(Math.sin(t2 * 6 + (side > 0 ? 1 : 0))) * 10;
      c.fillStyle = "#111";
      c.beginPath(); c.arc(x, 70 - bob, 20, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(x, 112 - bob, 16, 22, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#111"; c.lineWidth = 4;
      const kick = Math.sin(t2 * 6) * side;
      c.beginPath(); c.moveTo(x - 6, 130 - bob); c.lineTo(x - 10 + kick * 10, 160); c.moveTo(x + 6, 130 - bob); c.lineTo(x + 10 - kick * 10, 160); c.stroke();
      c.beginPath(); c.moveTo(x - 12, 100 - bob); c.lineTo(x - 30, 80 - bob + kick * 14); c.moveTo(x + 12, 100 - bob); c.lineTo(x + 30, 80 - bob - kick * 14); c.stroke();
      c.fillStyle = "#f4efe2";
      c.beginPath(); c.ellipse(x, 74 - bob, 13, 12, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#111";
      c.fillRect(x - 6, 66 - bob, 3, 7); c.fillRect(x + 3, 66 - bob, 3, 7);
      c.beginPath(); c.arc(x, 78 - bob, 6, 0.2, Math.PI - 0.2); c.stroke();
    }
    c.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < 40; i++) c.fillRect((frame * 37 + i * 53) % w, (frame * 11 + i * 29) % h, 1, 2 + (i % 3));
    if (frame % 9 === 0) { c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect((frame * 13) % w, 0, 1, h); }
    c.fillStyle = "#111";
    c.fillRect(0, 0, w, 6); c.fillRect(0, h - 6, w, 6);
    tex.needsUpdate = true;
  }

  /** The hall: a long carpet, the throne on its dais, columns and tables to dodge around, banners. */
  private buildThroneRoom(g: THREE.Group) {
    const kx = cellCenter(KING_THRONE.gx), kz = cellCenter(KING_THRONE.gz);
    const carpet = this.mat("carpet", { color: 0xa8102a, roughness: 0.95 });
    this.ground(g, kx - 1.2, 12.2, kx + 1.2, 52, 0.04, carpet);
    const gold = this.mat("gilt", { color: 0xc9962a, roughness: 0.35, metalness: 0.6 });
    // The dais and the throne (its seat over the cell's centre, its back to the north).
    // A low dais around the throne (flush enough to walk on), and the throne on the floor.
    this.box(g, 7, 0.06, 6, this.mat("dais", { color: 0x4a2a3a, roughness: 0.7 }), kx, 0.03, kz - 0.4);
    const throne = new THREE.Group();
    throne.position.set(kx, 0, kz);
    const velvet = this.mat("velvet", { color: 0x5a0a1a, roughness: 0.9 });
    this.box(throne, 2.2, 0.5, 1.5, gold, 0, 0.25, 0.05);
    this.box(throne, 1.9, 0.1, 1.3, velvet, 0, 0.55, 0.05);
    this.box(throne, 2.3, 4.4, 0.35, gold, 0, 2.2, -0.75);
    this.box(throne, 1.8, 3.6, 0.1, velvet, 0, 2.3, -0.55);
    for (const sx of [-1.05, 1.05]) this.box(throne, 0.25, 0.7, 1.4, gold, sx, 0.6, 0.05);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(this.kit.geo("town_throne_spike", () => new THREE.ConeGeometry(0.16, 0.7, 6)), gold);
      spike.position.set(-0.9 + i * 0.45, 4.75, -0.75);
      throne.add(spike);
    }
    g.add(throne);
    this.solid(kx - 0.9, kz - 1.0, 0.45);
    this.solid(kx + 0.9, kz - 1.0, 0.45);
    // Columns: their cells are walls to him, gaps to you.
    const pillar = this.mat("pillar", { color: 0xe6c8d0, roughness: 0.6 });
    for (const [gx, gz] of [[33, 5], [37, 5], [33, 9], [37, 9], [33, 11], [37, 11]]) {
      const x = cellCenter(gx), z = cellCenter(gz);
      this.cyl(g, 0.8, 0.9, 11, pillar, x, 5.5, z, 16);
      this.box(g, 2.0, 0.5, 2.0, gold, x, 0.25, z);
      this.box(g, 2.0, 0.5, 2.0, gold, x, 10.75, z);
      this.solid(x, z, 0.95);
    }
    // Two long banquet tables, set for nobody.
    const cloth = this.mat("tablecloth", { color: 0xf4efe2, roughness: 0.9 });
    for (const gx of [33, 37]) {
      const x = cellCenter(gx);
      this.box(g, 1.3, 0.08, 7.2, cloth, x, 0.86, 28);
      for (const sz of [-3.3, 3.3]) for (const sx of [-0.5, 0.5]) this.box(g, 0.1, 0.82, 0.1, this.mat("furn_wood", { color: 0x7a4a28, roughness: 0.7 }), x + sx, 0.41, 28 + sz);
      for (let i = 0; i < 6; i++) this.cyl(g, 0.16, 0.16, 0.03, gold, x + (i % 2 ? 0.35 : -0.35), 0.92, 25 + i * 1.2, 12);
      this.cyl(g, 0.08, 0.12, 0.7, gold, x, 1.25, 28, 8);
      for (let k = -3; k <= 3; k++) this.solid(x, 28 + k, 0.65);
    }
    // Banners down the long walls.
    const banner = this.mat("castle_banner", { color: 0xb0203a, roughness: 0.8, side: THREE.DoubleSide });
    for (let z = 18; z <= 46; z += 7) {
      this.plane(g, 1.6, 5, banner, 128.2, 6.5, z, Math.PI / 2);
      this.plane(g, 1.6, 5, banner, 155.8, 6.5, z, -Math.PI / 2);
    }
    // The north door: two tall leaves that only open for whoever reaches them.
    const doorWood = this.mat("exit_door", { color: 0x3a1a10, roughness: 0.6 });
    const dz = (TOWN_EXIT.gz + 1) * CELL + 0.1;
    this.box(g, 0.8, 6, 0.6, gold, kx - 2.4, 3, dz);
    this.box(g, 0.8, 6, 0.6, gold, kx + 2.4, 3, dz);
    this.box(g, 5.6, 0.8, 0.6, gold, kx, 6.2, dz);
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(kx + side * 2.0, 0, dz - 0.1);
      const leaf = this.box(hinge, 2.0, 5.6, 0.18, doorWood, -side * 1.0, 2.8, 0);
      this.sphere(hinge, 0.12, gold, -side * 1.8, 2.6, 0.12);
      leaf.userData.dynamic = true;
      hinge.userData.dynamic = true;
      hinge.traverse((o) => { o.userData.dynamic = true; });
      g.add(hinge);
      this.exitLeaves.push(hinge);
    }
  }

  // -------------------------------------------------------------------------
  // Gates
  // -------------------------------------------------------------------------

  private buildGates() {
    // The barricade on the road out: two sawhorses, striped planks, a sign.
    const b = new THREE.Group();
    b.position.set(cellCenter(TOWN_BARRICADE.gx), 0, TOWN_BARRICADE.gz * CELL + 2.6);
    const stripes = this.mat("barricade", {
      map: this.tex("barricade", 128, 32, [1, 0.25], (c, w, h) => {
        for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#f4efe2" : "#d02a2a"; c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16 + 16, 0); c.lineTo(i * 16, h); c.lineTo(i * 16 - 16, h); c.fill(); }
      }), roughness: 0.7,
    });
    const wood = this.mat("furn_wood", { color: 0x7a4a28, roughness: 0.7 });
    for (const sx of [-1.5, 1.5]) for (const sz of [-0.2, 0.2]) { const leg = this.box(b, 0.08, 1.2, 0.08, wood, sx, 0.55, sz); leg.rotation.x = sz > 0 ? -0.25 : 0.25; }
    this.box(b, 3.8, 0.28, 0.06, stripes, 0, 1.0, 0.25);
    this.box(b, 3.8, 0.28, 0.06, stripes, 0, 0.55, 0.25);
    this.plane(b, 1.8, 0.5, this.label(t("town.sign.closed"), 1.8, 0.5, "#1a1a1a", "#f2d24b"), 0, 1.5, 0.3);
    b.traverse((o) => { o.userData.dynamic = true; });
    this.root.add(b);
    this.barricade = b;

    // The portcullis between the Animation Room and the corridor.
    const p = new THREE.Group();
    const iron = this.mat("portcullis", { color: 0x2a2a30, roughness: 0.4, metalness: 0.7 });
    const gx = cellCenter(PUZZLE_GATE.gx), gz = (PUZZLE_GATE.gz + 1) * CELL - 0.15;
    for (let x = -1.8; x <= 1.81; x += 0.45) this.box(p, 0.09, 4.0, 0.09, iron, x, 2.0, 0);
    for (let y = 0.4; y < 4; y += 0.7) this.box(p, 3.8, 0.08, 0.09, iron, 0, y, 0);
    for (let x = -1.8; x <= 1.81; x += 0.45) {
      const spike = new THREE.Mesh(this.kit.geo("town_gate_spike", () => new THREE.ConeGeometry(0.07, 0.2, 4)), iron);
      spike.position.set(x, -0.08, 0);
      spike.rotation.x = Math.PI;
      p.add(spike);
    }
    p.position.set(gx, 0, gz);
    p.traverse((o) => { o.userData.dynamic = true; });
    this.root.add(p);
    this.portcullis = p;
    for (let i = 0; i < 3; i++) {
      const bulb = new THREE.Mesh(this.kit.geo("town_bulb", () => new THREE.SphereGeometry(0.16, 12, 10)), this.bulbOff);
      bulb.position.set(gx - 0.9 + i * 0.9, 4.35, gz + 0.3);
      bulb.userData.dynamic = true;
      this.root.add(bulb);
      this.gateBulbs.push(bulb);
    }
  }
}
