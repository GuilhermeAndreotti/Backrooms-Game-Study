/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level FUN's geometry. ProceduralMap hands every cell of the FUN grid to
 * {@link FunWorld.createCell}, which builds it whole (floor, wallpaper,
 * ceiling, fluorescent, gate, and the hand-authored props from the scenes
 * below) out of LevelFunModels' pieces.
 *
 * Everything the puzzles and scares need to touch later is registered by tag
 * (`tag("pickup:plates")`, `tagAll("crowd")` ...) or by gate id, so the
 * director (funDirector.ts) never searches the scene graph. The world also
 * owns the "the party is going wrong" stage: three sets of wall/carpet
 * textures swapped in place (so already-built cells change with no rebuild),
 * plus props that only exist from a given stage on, or that move when the
 * stage passes theirs.
 *
 * Cells are built once, up front, so all of this is deterministic and, apart
 * from the cosmetic scares, identical on every client.
 */

import * as THREE from "three";
import type { DecorKit } from "../LevelDecor";
import type { DynamicLightSource } from "../LightPool";
import type { LightFixture } from "../ProceduralMap";
import * as M from "../LevelFunModels";
import { t } from "../../i18n";
import {
  FUN_EXIT, FUN_GATES, FUN_GRID, FUN_SPAWN, FUN_THEMES, FunCode, FunGate, FunRandom, FunTheme,
  THEME_SYMBOL, PANEL_BUTTONS, funCellCenter, funCodeForSeed, funGateAt, funRegionAt,
} from "./funLayout";

const CELL = 4;
const WALL_H = 3;
const TABLE_TOP = 0.737;

export interface FunBuildEnv {
  kit: DecorKit;
  seed: number;
  registerLight(gx: number, gz: number, x: number, y: number, z: number, color: number, intensity: number, distance: number, decay?: number): DynamicLightSource;
  addObstacle(gx: number, gz: number, x: number, z: number, radius: number): void;
  pushFixture(fixture: LightFixture): void;
  /** The map's shared tube materials, so its flicker code and ours agree. */
  glassOn: THREE.Material;
  glassOff: THREE.Material;
  glow(color: number, size: number, opacity: number): THREE.Sprite;
}

interface PropEnv {
  kit: DecorKit;
  rng: FunRandom;
  code: FunCode;
}

interface PropSpec {
  x: number; z: number; y?: number; yaw?: number;
  cell?: [number, number];
  make: (e: PropEnv) => M.FunPiece;
  tag?: string;
  solid?: boolean;
  /** Present only while stage is in [from, to]. */
  from?: M.FunStage; to?: M.FunStage;
  /** Moves here once the stage reaches `from` (kept inside its cell). */
  alt?: { x: number; z: number; yaw?: number; from: M.FunStage };
  hidden?: boolean;
  glow?: { color: number; size: number };
  bob?: boolean;
}

export interface TaggedProp {
  tag: string;
  obj: THREE.Object3D;
  x: number; y: number; z: number; yaw: number;
  piece: M.FunPiece;
}

interface GateRt {
  gate: FunGate;
  closed: boolean;
  angle: number;
  leaf: THREE.Object3D | null;
  barrier: THREE.Object3D | null;
  lock: THREE.Object3D | null;
}

interface Shift { obj: THREE.Object3D; alt: NonNullable<PropSpec["alt"]>; base: { x: number; z: number; yaw: number }; done: boolean }

type Side = "N" | "S" | "W" | "E";
const SIDES: Record<Side, { dx: number; dz: number; yaw: number }> = {
  N: { dx: 0, dz: -1, yaw: 0 },
  S: { dx: 0, dz: 1, yaw: Math.PI },
  W: { dx: -1, dz: 0, yaw: Math.PI / 2 },
  E: { dx: 1, dz: 0, yaw: -Math.PI / 2 },
};

const cc = (gx: number, gz: number): [number, number] => funCellCenter(gx, gz, CELL);

/** A point on a cell's wall, facing into the cell; `along` slides it along the wall. */
function wallAt(gx: number, gz: number, side: Side, along = 0): { x: number; z: number; yaw: number; cell: [number, number] } {
  const [cx, cz] = cc(gx, gz);
  const s = SIDES[side];
  return {
    x: cx + s.dx * (CELL / 2) + (s.dx === 0 ? along : 0),
    z: cz + s.dz * (CELL / 2) + (s.dz === 0 ? along : 0),
    yaw: s.yaw,
    cell: [gx, gz],
  };
}

const lines = (key: Parameters<typeof t>[0]) => t(key).split("|");

/** Table + chairs as a set of specs. Chair positions are given relative to the table, facing it. */
function tableSet(specs: PropSpec[], x: number, z: number, o: {
  length?: number; depth?: number; places?: number; cloth: M.PartyColor; yaw?: number; tag?: string;
  chairColors?: M.PartyColor[]; missing?: number[]; tipFrom?: M.FunStage; cell?: [number, number];
}) {
  const length = o.length ?? 1.8, depth = o.depth ?? 0.8, places = o.places ?? 2;
  const yaw = o.yaw ?? 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  specs.push({ x, z, yaw, cell: o.cell, tag: o.tag, make: (e) => M.funPartyTable(e.kit, o.cloth, { length, depth, places, stage: 1 }) });
  let n = 0;
  for (const side of [1, -1]) {
    for (let i = 0; i < places; i++, n++) {
      if (o.missing?.includes(n)) continue;
      const lx = (i - (places - 1) / 2) * (length / places), lz = side * (depth / 2 + 0.3);
      const [px, pz] = at(lx, lz);
      const color = (o.chairColors ?? [o.cloth])[n % (o.chairColors ?? [o.cloth]).length];
      const [ax, az] = at(lx + 0.25, lz + side * 0.3);
      specs.push({
        x: px, z: pz, yaw: yaw + (side > 0 ? Math.PI : 0), cell: o.cell,
        make: (e) => M.funKidChair(e.kit, color, false),
        alt: o.tipFrom ? { x: ax, z: az, yaw: yaw + (side > 0 ? Math.PI : 0) + (n % 2 ? 0.9 : -1.1), from: o.tipFrom } : undefined,
      });
    }
  }
}
export class FunWorld {
  readonly code: FunCode;
  stage: M.FunStage = 0;

  private readonly env: FunBuildEnv;
  private readonly kit: DecorKit;
  private readonly wall: THREE.MeshStandardMaterial;
  private readonly themeWall = new Map<FunTheme, THREE.MeshStandardMaterial>();
  private readonly carpet: THREE.MeshStandardMaterial;
  private readonly ceiling: THREE.MeshStandardMaterial;
  private readonly baseboard: THREE.MeshStandardMaterial;
  private readonly wallTex: THREE.Texture[] = [];
  private readonly themeTex = new Map<FunTheme, THREE.Texture[]>();
  private readonly carpetTex: THREE.Texture[] = [];

  private readonly specsByCell = new Map<string, PropSpec[]>();
  private readonly reserved = new Set<string>();
  private readonly groups = new Map<string, THREE.Group>();
  private readonly tags = new Map<string, TaggedProp[]>();
  private readonly gates = new Map<string, GateRt>();
  private readonly layers: { obj: THREE.Object3D; from: M.FunStage; to: M.FunStage }[] = [];
  private readonly shifts: Shift[] = [];
  private readonly bobbers: { obj: THREE.Object3D; baseY: number; phase: number }[] = [];
  /** Fixtures the director may make stutter. */
  readonly flickyFixtures: LightFixture[] = [];
  private readonly lightsByRegion = new Map<string, DynamicLightSource[]>();

  constructor(env: FunBuildEnv) {
    this.env = env;
    this.kit = env.kit;
    this.code = funCodeForSeed(env.seed);

    for (const stage of [0, 1, 2] as const) {
      const w = M.funWallMaterial(this.kit, stage).map!;
      w.repeat.set(2, 1.5);
      this.wallTex.push(w);
      const c = M.funCarpetMaterial(this.kit, stage).map!;
      c.repeat.set(2, 2);
      this.carpetTex.push(c);
    }
    this.wall = new THREE.MeshStandardMaterial({ map: this.wallTex[0], roughness: 0.92 });
    this.carpet = new THREE.MeshStandardMaterial({ map: this.carpetTex[0], roughness: 1 });
    const ceilingMap = M.funCeilingMaterial(this.kit).map!;
    ceilingMap.repeat.set(2, 2);
    this.ceiling = new THREE.MeshStandardMaterial({ map: ceilingMap, roughness: 0.95 });
    this.baseboard = new THREE.MeshStandardMaterial({ color: 0xd7c98f, roughness: 0.8 });
    for (const theme of FUN_THEMES) {
      const texes = ([0, 1, 2] as const).map((stage) => {
        const tex = M.funWallMaterial(this.kit, stage, theme).map!;
        tex.repeat.set(2, 1.5);
        return tex;
      });
      this.themeTex.set(theme, texes);
      this.themeWall.set(theme, new THREE.MeshStandardMaterial({ map: texes[0], roughness: 0.92 }));
    }

    const specs: PropSpec[] = [];
    this.authorScenes(specs);
    for (const spec of specs) {
      const cell = spec.cell ?? [Math.floor(spec.x / CELL), Math.floor(spec.z / CELL)] as [number, number];
      spec.cell = cell;
      const key = `${cell[0]},${cell[1]}`;
      const list = this.specsByCell.get(key) ?? [];
      list.push(spec);
      this.specsByCell.set(key, list);
      this.reserved.add(key);
    }
    for (const gate of FUN_GATES) {
      this.gates.set(gate.id, { gate, closed: gate.closed, angle: 0, leaf: null, barrier: null, lock: null });
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.reserved.add(`${gate.gx + dx},${gate.gz + dz}`);
    }
    // Keep the exit stretch clear too.
    for (let x = FUN_EXIT.gx; x <= FUN_EXIT.gx + 3; x++) this.reserved.add(`${x},${FUN_EXIT.gz}`);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 1; dz++) this.reserved.add(`${FUN_SPAWN.gx + dx},${FUN_SPAWN.gz + dz}`);
  }

  // -------------------------------------------------------------------------
  // Queries the director and the map use
  // -------------------------------------------------------------------------

  tag(name: string): TaggedProp | undefined { return this.tags.get(name)?.[0]; }
  tagAll(prefix: string): TaggedProp[] {
    const out: TaggedProp[] = [];
    this.tags.forEach((list, key) => { if (key === prefix || key.startsWith(`${prefix}:`)) out.push(...list); });
    return out;
  }

  isGateClosed(gx: number, gz: number): boolean {
    const g = funGateAt(gx, gz);
    return !!g && (this.gates.get(g.id)?.closed ?? false);
  }

  gateClosed(id: string): boolean { return this.gates.get(id)?.closed ?? false; }

  gateCenter(id: string): [number, number] | null {
    const g = this.gates.get(id)?.gate;
    return g ? cc(g.gx, g.gz) : null;
  }

  /** Slides a gate's leaf open/shut (animated by update()). Blocked-style gates also drop their tape and lock. */
  setGate(id: string, closed: boolean, instant = false) {
    const rt = this.gates.get(id);
    if (!rt) return;
    rt.closed = closed;
    if (rt.gate.variant === "blocked") {
      if (rt.barrier) rt.barrier.visible = closed;
      if (rt.lock) rt.lock.visible = closed;
    }
    if (instant) {
      rt.angle = closed ? 0 : -1.75;
      if (rt.leaf) rt.leaf.rotation.y = rt.angle;
    }
  }

  /** Puts a freshly built piece in the cell group that owns (x, z); returns it, or null if that cell isn't built yet. */
  place(piece: M.FunPiece, x: number, y: number, z: number, yaw = 0): THREE.Object3D | null {
    const group = this.groups.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!group) return null;
    piece.object.position.set(x, y, z);
    piece.object.rotation.y = yaw;
    group.add(piece.object);
    return piece.object;
  }

  makeEnv(seedSalt: number): PropEnv {
    return { kit: this.kit, rng: new FunRandom(this.env.seed + seedSalt * 977), code: this.code };
  }

  /** A local-only copy used by the first-person carry view. */
  makeHeldItem(id: string): M.FunPiece {
    const env = this.makeEnv(700 + id.length);
    switch (id) {
      case "tablecloth": return M.funTableclothFolded(env.kit, "red");
      case "plates": {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const plate = M.funPlate(env.kit, i % 2 ? "white" : "blue").object;
          plate.position.y = i * 0.035;
          g.add(plate);
        }
        return { object: g, footprint: [] };
      }
      case "cups": {
        const g = new THREE.Group();
        for (const [i, color] of (["red", "yellow", "blue"] as M.PartyColor[]).entries()) {
          const cup = M.funCup(env.kit, color).object;
          cup.position.set((i - 1) * 0.16, 0, 0);
          g.add(cup);
        }
        return { object: g, footprint: [] };
      }
      case "gift": return M.funGift(env.kit, "pink", "yellow", 0.32);
      case "candles": return M.funCandleBox(env.kit);
      case "balloons": return M.funBalloonCluster(env.kit, env.rng, 3);
      case "cake": return M.funCake(env.kit, { candles: 5, lit: true });
      case "balloon": return M.funSpecialBalloon(env.kit, 0.85);
      default: return M.funGift(env.kit, "purple", "yellow", 0.3);
    }
  }

  /** A cosmetic apparition in the player's current cell. It never has collision. */
  spawnPartygoer(x: number, z: number, yaw: number): THREE.Object3D | null {
    const group = this.groups.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!group) return null;
    const piece = M.funPartygoer(this.kit, { scale: 1.16 });
    piece.object.position.set(x, 0, z);
    piece.object.rotation.y = yaw;
    group.add(piece.object);
    return piece.object;
  }

  /** The stage's look. Texture swaps are in place, so every built cell changes with no rebuild. */
  applyStage(stage: M.FunStage) {
    this.stage = stage;
    this.wall.map = this.wallTex[stage];
    this.carpet.map = this.carpetTex[stage];
    for (const theme of FUN_THEMES) this.themeWall.get(theme)!.map = this.themeTex.get(theme)![stage];
    for (const l of this.layers) l.obj.visible = stage >= l.from && stage <= l.to;
    for (const s of this.shifts) {
      if (s.done || stage < s.alt.from) continue;
      s.done = true;
      s.obj.position.x = s.alt.x; s.obj.position.z = s.alt.z;
      s.obj.rotation.y = s.alt.yaw ?? s.base.yaw;
    }
  }

  /** Tints every lamp in a region (e.g. "hallA") — the party lights. null restores them. */
  tintRegion(regionId: string, color: number | null) {
    const list = this.lightsByRegion.get(regionId);
    if (!list) return;
    for (const src of list) {
      if (color === null) src.color = this.originalColors.get(src) ?? src.color;
      else src.color = color;
    }
  }
  private readonly originalColors = new Map<DynamicLightSource, number>();

  update(delta: number, time: number) {
    this.gates.forEach((rt) => {
      const target = rt.closed ? 0 : -1.75;
      if (Math.abs(rt.angle - target) > 0.001) {
        rt.angle += (target - rt.angle) * Math.min(1, (rt.closed ? 9 : 3.2) * delta);
        if (rt.leaf) rt.leaf.rotation.y = rt.angle;
      }
    });
    for (const b of this.bobbers) b.obj.position.y = b.baseY + Math.sin(time * 0.9 + b.phase) * 0.05;
  }

  // -------------------------------------------------------------------------
  // Cells
  // -------------------------------------------------------------------------

  createCell(gx: number, gz: number): THREE.Group {
    const group = new THREE.Group();
    const region = funRegionAt(gx, gz);
    const key = `${gx},${gz}`;
    this.groups.set(key, group);
    group.userData.aabb = new THREE.Box3(
      new THREE.Vector3(gx * CELL - 2.5, -0.5, gz * CELL - 2.5),
      new THREE.Vector3((gx + 1) * CELL + 2.5, WALL_H + 0.6, (gz + 1) * CELL + 2.5),
    );
    if (!region) return group;

    const kit = this.kit;
    const [px, pz] = cc(gx, gz);
    const theme = FUN_THEMES.find((th) => region.id === th);
    const wallMat = theme ? this.themeWall.get(theme)! : this.wall;

    const floor = new THREE.Mesh(kit.geo("fun_floor", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2)), this.carpet);
    floor.position.set(px, 0, pz);
    floor.receiveShadow = true;
    group.add(floor);
    const ceil = new THREE.Mesh(kit.geo("fun_ceil", () => new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2)), this.ceiling);
    ceil.position.set(px, WALL_H, pz);
    group.add(ceil);

    const solid = (x: number, z: number) => !funRegionAt(x, z) || x < 0 || z < 0 || x >= FUN_GRID || z >= FUN_GRID;
    for (const side of ["N", "S", "W", "E"] as Side[]) {
      const s = SIDES[side];
      if (!solid(gx + s.dx, gz + s.dz)) continue;
      const wallGeo = kit.geo("fun_wall", () => new THREE.PlaneGeometry(CELL, WALL_H));
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(px + s.dx * (CELL / 2), WALL_H / 2, pz + s.dz * (CELL / 2));
      wall.rotation.y = s.yaw;
      group.add(wall);
      const base = new THREE.Mesh(kit.geo("fun_base", () => new THREE.BoxGeometry(CELL, 0.12, 0.04)), this.baseboard);
      base.position.set(px + s.dx * (CELL / 2 - 0.02), 0.06, pz + s.dz * (CELL / 2 - 0.02));
      base.rotation.y = s.yaw;
      group.add(base);
    }

    this.buildFixture(group, gx, gz, px, pz, region.id, region.kind);
    const gate = funGateAt(gx, gz);
    if (gate) this.buildGate(group, gate, px, pz);

    for (const spec of this.specsByCell.get(`${gx},${gz}`) ?? []) this.buildSpec(group, spec);
    if (!gate) this.fillDecor(group, gx, gz, px, pz, region.kind === "corridor", region.id);
    if (gx === FUN_EXIT.gx && gz === FUN_EXIT.gz) this.buildExitGlow(group, px, pz);
    return group;
  }

  private buildSpec(group: THREE.Group, spec: PropSpec) {
    const [gx, gz] = spec.cell!;
    const env = this.makeEnv(gx * 131 + gz * 17 + Math.floor(spec.x * 7));
    const piece = spec.make(env);
    const obj = piece.object;
    obj.position.set(spec.x, spec.y ?? 0, spec.z);
    obj.rotation.y = spec.yaw ?? 0;
    if (spec.hidden) obj.visible = false;
    group.add(obj);
    if (spec.glow) {
      const sprite = this.env.glow(spec.glow.color, spec.glow.size, 0.55);
      sprite.position.set(0, 0.28, 0);
      obj.add(sprite);
    }
    if (spec.solid !== false) {
      const c = Math.cos(spec.yaw ?? 0), s = Math.sin(spec.yaw ?? 0);
      for (const [lx, lz, r] of piece.footprint) this.env.addObstacle(gx, gz, spec.x + lx * c + lz * s, spec.z - lx * s + lz * c, r);
    }
    if (spec.tag) {
      const list = this.tags.get(spec.tag) ?? [];
      list.push({ tag: spec.tag, obj, x: spec.x, y: spec.y ?? 0, z: spec.z, yaw: spec.yaw ?? 0, piece });
      this.tags.set(spec.tag, list);
    }
    if (spec.from !== undefined || spec.to !== undefined) {
      const from = spec.from ?? 0, to = spec.to ?? 2;
      this.layers.push({ obj, from, to });
      obj.visible = !spec.hidden && this.stage >= from && this.stage <= to;
    }
    if (spec.alt) {
      this.shifts.push({ obj, alt: spec.alt, base: { x: spec.x, z: spec.z, yaw: spec.yaw ?? 0 }, done: false });
    }
    if (spec.bob) this.bobbers.push({ obj, baseY: spec.y ?? 0, phase: (spec.x * 3.1 + spec.z) % 6 });
  }

  private buildFixture(group: THREE.Group, gx: number, gz: number, px: number, pz: number, regionId: string, kind: string) {
    const rng = new FunRandom(this.env.seed + gx * 7919 + gz * 104729);
    const gate = funGateAt(gx, gz);
    if (gate) return;
    let chance = kind === "corridor" ? 0.4 : kind === "hall" ? 0.5 : 0.6;
    if (regionId === "corrLong") chance = 0.2;
    if (regionId === "corrExit" || regionId === "corrG2") chance = 0.3;
    if (regionId === "hallLast") chance = 0.42;
    const anchor = kind !== "corridor" && (gx + gz) % 3 === 0;
    const r = rng.next();
    if (!anchor && r > chance) return;

    const burnt = !anchor && rng.next() < 0.14;
    const flicky = !burnt && rng.next() < 0.22;
    const housing = this.kit.mat("fun_fx_housing", () => new THREE.MeshStandardMaterial({ color: 0xd9d4c2, roughness: 0.6, metalness: 0.3 }));
    const fx = new THREE.Group();
    fx.add(new THREE.Mesh(this.kit.geo("fun_fx_box", () => new THREE.BoxGeometry(1.24, 0.06, 0.34)), housing));
    fx.children[0].position.set(0, WALL_H - 0.03, 0);
    const tube = new THREE.Mesh(this.kit.geo("fun_fx_tube", () => new THREE.CylinderGeometry(0.024, 0.024, 1.16, 8).rotateZ(Math.PI / 2)), burnt ? this.env.glassOff : this.env.glassOn);
    tube.position.set(0, WALL_H - 0.085, 0);
    tube.name = "tube";
    fx.add(tube);
    fx.position.set(px + (rng.next() - 0.5) * 0.6, 0, pz + (rng.next() - 0.5) * 0.6);
    fx.rotation.y = rng.next() < 0.5 ? 0 : Math.PI / 2;
    group.add(fx);

    const intensity = burnt ? 0 : 1.5;
    const color = 0xfff2c4;
    const light = this.env.registerLight(gx, gz, px, WALL_H - 0.2, pz, color, intensity, 8, 1.0);
    this.originalColors.set(light, color);
    const list = this.lightsByRegion.get(regionId) ?? [];
    list.push(light);
    this.lightsByRegion.set(regionId, list);
    const fixture: LightFixture = { mesh: tube, light, intensity, flickerTimer: 0, gridX: gx, gridZ: gz };
    this.env.pushFixture(fixture);
    if (flicky) this.flickyFixtures.push(fixture);
  }

  /** The exit corridor's last cell: a doorway of white light with a smiley over it. */
  private buildExitGlow(group: THREE.Group, px: number, pz: number) {
    const [gx, gz] = [FUN_EXIT.gx, FUN_EXIT.gz];
    const glowMat = this.kit.mat("fun_exit_glow", () => new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
    const door = new THREE.Mesh(this.kit.geo("fun_exit_plane", () => new THREE.PlaneGeometry(1.7, 2.5)), glowMat);
    door.position.set(px - CELL / 2 + 0.03, 1.25, pz);
    door.rotation.y = Math.PI / 2;
    group.add(door);
    this.env.registerLight(gx, gz, px - 1, 2.0, pz, 0xfff6d8, 2.4, 9, 1.0);
    const smile = M.funWallSymbol(this.kit, "smile", "orange", 0.5).object;
    smile.position.set(px - CELL / 2 + 0.02, 2.6, pz);
    smile.rotation.y = Math.PI / 2;
    group.add(smile);
  }

  // -------------------------------------------------------------------------
  // Gates: a doorway wall across the corridor cell
  // -------------------------------------------------------------------------

  private panel(w: number, h: number): THREE.PlaneGeometry {
    return this.kit.geo(`fun_panel_${w}_${h}`, () => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / CELL), uv.getY(i) * (h / WALL_H));
      return g;
    });
  }

  private buildGate(group: THREE.Group, gate: FunGate, px: number, pz: number) {
    const rt = this.gates.get(gate.id)!;
    const root = new THREE.Group();
    // Built facing +Z across an x-running corridor... rotated onto the corridor's axis.
    root.position.set(px, 0, pz);
    root.rotation.y = gate.axis === "x" ? Math.PI / 2 : 0;
    const door = M.funDoor(this.kit, gate.color, gate.variant);
    root.add(door.object);
    rt.leaf = door.object.getObjectByName("leaf") ?? null;
    rt.barrier = door.object.getObjectByName("barrier") ?? null;
    rt.lock = door.object.getObjectByName("lock") ?? null;
    if (rt.leaf) rt.leaf.rotation.y = rt.closed ? 0 : -1.75;
    rt.angle = rt.closed ? 0 : -1.75;
    if (gate.variant === "blocked") {
      if (rt.barrier) rt.barrier.visible = rt.closed;
      if (rt.lock) rt.lock.visible = rt.closed;
    }
    // Wallpaper either side of the 1.1 m opening, both faces, and above it.
    for (const side of [-1, 1]) {
      const cx = side * 1.3;
      for (const face of [1, -1]) {
        const m = new THREE.Mesh(this.panel(1.4, WALL_H), this.wall);
        m.position.set(cx, WALL_H / 2, face * 0.081);
        if (face < 0) m.rotation.y = Math.PI;
        root.add(m);
      }
    }
    for (const face of [1, -1]) {
      const lintel = new THREE.Mesh(this.panel(1.1, WALL_H - 2.3), this.wall);
      lintel.position.set(0, 2.3 + (WALL_H - 2.3) / 2, face * 0.081);
      if (face < 0) lintel.rotation.y = Math.PI;
      root.add(lintel);
    }
    group.add(root);

    // Wall pieces beside the doorway stay solid even when the door is open.
    const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
    for (const lx of [-1.6, -1.1, 1.1, 1.6]) {
      this.env.addObstacle(gate.gx, gate.gz, px + lx * c, pz - lx * s, 0.3);
    }
  }

  // -------------------------------------------------------------------------
  // Generic dressing for cells no scene claims
  // -------------------------------------------------------------------------

  private fillDecor(group: THREE.Group, gx: number, gz: number, px: number, pz: number, corridor: boolean, regionId: string) {
    if (this.reserved.has(`${gx},${gz}`)) return;
    const rng = new FunRandom(this.env.seed + gx * 389 + gz * 733 + 0xdec0);
    const isSolid = (x: number, z: number) => !funRegionAt(x, z);
    const walkable = (x: number, z: number) => !isSolid(x, z);
    if (corridor) {
      const ns = walkable(gx, gz - 1) && walkable(gx, gz + 1) && !walkable(gx - 1, gz) && !walkable(gx + 1, gz);
      const ew = walkable(gx - 1, gz) && walkable(gx + 1, gz) && !walkable(gx, gz - 1) && !walkable(gx, gz + 1);
      if (!ns && !ew) return;
    } else {
      // A room cell at a corridor mouth stays clear.
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const r = funRegionAt(gx + dx, gz + dz);
        if (r && r.kind === "corridor") return;
      }
    }
    const sides = (Object.keys(SIDES) as Side[]).filter((sd) => isSolid(gx + SIDES[sd].dx, gz + SIDES[sd].dz));
    if (sides.length === 0) return;
    const chance = regionId === "corrLong" ? 0.32 : corridor ? 0.3 : 0.5;
    if (rng.next() > chance) return;
    const side = sides[rng.nextInt(0, sides.length)];
    const rot = SIDES[side].yaw;
    const piece = M.funRoomDecor(this.kit, rng, CELL / 2, corridor, 1);
    piece.object.rotation.y = rot;
    piece.object.position.set(px, 0, pz);
    group.add(piece.object);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [lx, lz, r] of piece.footprint) this.env.addObstacle(gx, gz, px + lx * c + lz * s, pz - lx * s + lz * c, r);

    // What the room looks like once the party has soured: extras that appear with the stage.
    if (!corridor && rng.next() < 0.4) {
      const extra = M.funPartyDebris(this.kit, rng, 2).object;
      extra.position.set(px + rng.nextRange(-1, 1), 0, pz + rng.nextRange(-1, 1));
      group.add(extra);
      this.layers.push({ obj: extra, from: 1, to: 2 });
      extra.visible = this.stage >= 1;
    }
    if (rng.next() < 0.3) {
      const w = wallAt(gx, gz, side, rng.nextRange(-0.9, 0.9));
      const scrawl = M.funWallSymbol(this.kit, "smile", "red", 0.5).object;
      scrawl.position.set(w.x, rng.nextRange(1.2, 2.1), w.z);
      scrawl.rotation.y = w.yaw;
      group.add(scrawl);
      this.layers.push({ obj: scrawl, from: 2, to: 2 });
      scrawl.visible = this.stage >= 2;
    }
  }

  // -------------------------------------------------------------------------
  // Authored scenes
  // -------------------------------------------------------------------------

  private authorScenes(specs: PropSpec[]) {
    this.sceneHallA(specs);
    this.sceneSideRooms(specs);
    this.sceneHub(specs);
    this.sceneThemedRooms(specs);
    this.sceneP3Corridor(specs);
    this.sceneLastHall(specs);
    this.sceneAnnexes(specs);
  }

  private onWall(specs: PropSpec[], gx: number, gz: number, side: Side, along: number, y: number, make: PropSpec["make"], extra: Partial<PropSpec> = {}) {
    const w = wallAt(gx, gz, side, along);
    specs.push({ x: w.x, z: w.z, y, yaw: w.yaw, cell: w.cell, solid: false, make, ...extra });
  }

  private sceneHallA(specs: PropSpec[]) {
    // The table: a long one, with five numbered places along it.
    const [tx, tz] = cc(7, 6);
    tableSet(specs, tx, tz, { length: 3.4, depth: 1.0, places: 3, cloth: "white", tag: "p1table", chairColors: ["red", "blue", "yellow", "green", "pink", "purple"], tipFrom: 1 });
    for (let i = 0; i < 5; i++) {
      specs.push({ x: tx + (i - 2) * 0.66, z: tz, y: TABLE_TOP, cell: [7, 6], solid: false, tag: `slot:${i}`, make: (e) => M.funNumberMarker(e.kit, i + 1, 0.5) });
    }
    // Things hanging over it.
    this.onWall(specs, 6, 2, "N", 0, 2.85, (e) => M.funBirthdayBanner(e.kit, 3.4));
    for (const dx of [-1.4, 1.4]) {
      for (let i = 0; i < 3; i++) {
        const colors: M.PartyColor[] = ["red", "yellow", "blue"];
        specs.push({ x: tx + dx + (i - 1) * 0.3, z: tz + (i - 1) * 0.5, y: WALL_H, cell: [7, 6], solid: false, make: (e) => M.funStreamer(e.kit, colors[i], 0.9 + i * 0.3) });
      }
    }

    // Clues imply the table-setting order without listing the solution outright.
    this.onWall(specs, 2, 5, "W", 0, 1.5, (e) => M.funNote(e.kit, lines("fun.hint.table"), 1));
    this.onWall(specs, 2, 7, "W", 0.3, 1.45, (e) => M.funDrawing(e.kit, { kind: "house" }, 4));
    this.onWall(specs, 9, 2, "N", 0, 1.5, (e) => { const l = lines("fun.poster.rules"); return M.funPoster(e.kit, l[0], l.slice(1), "pink"); });
    this.onWall(specs, 4, 2, "N", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 4 }, 2), { to: 0 });
    this.onWall(specs, 4, 2, "N", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 4, wrong: true }, 2), { from: 1 });
    this.onWall(specs, 12, 6, "E", 0.9, 1.5, (e) => M.funDrawing(e.kit, { kind: "partygoer" }, 3), { from: 2 });
    this.onWall(specs, 10, 10, "S", 0, 1.4, (e) => M.funNote(e.kit, lines("fun.note.a"), 1));
    this.onWall(specs, 11, 6, "E", -0.6, 1.9, (e) => M.funWallSymbol(e.kit, "smile", "red", 0.55), { from: 2 });

    // Pickups: everything a party needs, and one thing it doesn't.
    const [sx, sz] = cc(10, 2);
    specs.push({ x: sx, z: 8 + 0.55, cell: [10, 2], make: (e) => M.funPartyTable(e.kit, "blue", { length: 1.0, depth: 0.6, places: 1, stage: 1 }) });
    specs.push({ x: sx, z: 8 + 0.55, y: 0.75, cell: [10, 2], solid: false, tag: "pickup:tablecloth", glow: { color: 0xffe08a, size: 0.8 }, make: (e) => M.funTableclothFolded(e.kit, "red") });
    const [gx, gz] = cc(12, 10);
    specs.push({ x: gx + 0.7, z: gz + 0.5, cell: [12, 10], make: (e) => M.funGift(e.kit, "blue", "white", 0.42) });
    specs.push({ x: gx - 0.4, z: gz + 0.8, yaw: 0.6, cell: [12, 10], make: (e) => M.funGift(e.kit, "green", "red", 0.34) });
    specs.push({ x: gx - 0.5, z: gz - 0.1, yaw: -0.3, y: 0, cell: [12, 10], solid: false, tag: "pickup:gift", glow: { color: 0xffe08a, size: 0.9 }, make: (e) => M.funGift(e.kit, "pink", "yellow", 0.3) });
    const [bx, bz] = cc(12, 3);
    specs.push({ x: bx, z: bz, cell: [12, 3], tag: "pickup:balloons", glow: { color: 0xffe08a, size: 1.1 }, make: (e) => M.funBalloonCluster(e.kit, e.rng, 4) });
    // More balloons, for the look of the place.
    for (const [cx, cz] of [[3, 3], [3, 9], [11, 4]] as const) {
      const [x, z] = cc(cx, cz);
      specs.push({ x, z, cell: [cx, cz], make: (e) => M.funBalloonCluster(e.kit, e.rng, 5) });
    }
    const [dx, dz] = cc(5, 8);
    specs.push({ x: dx, z: dz, cell: [5, 8], solid: false, make: (e) => M.funPartyDebris(e.kit, e.rng, 1) });
  }

  private sceneSideRooms(specs: PropSpec[]) {
    // --- Room A2: plates and candles -------------------------------------
    const [px] = cc(3, 14);
    specs.push({ x: px, z: 14 * CELL + 0.55, cell: [3, 14], make: (e) => M.funPartyTable(e.kit, "pink", { length: 1.0, depth: 0.6, places: 1, stage: 1 }) });
    specs.push({
      x: px, z: 14 * CELL + 0.55, y: TABLE_TOP - 0.005, cell: [3, 14], solid: false, tag: "pickup:plates", glow: { color: 0xffe08a, size: 0.8 },
      make: (e) => {
        const g = new THREE.Group();
        for (let i = 0; i < 4; i++) { const p = M.funPlate(e.kit, i % 2 ? "white" : "blue").object; p.position.y = i * 0.02; g.add(p); }
        return { object: g, footprint: [] };
      },
    });
    const [cx] = cc(5, 19);
    specs.push({ x: cx, z: 20 * CELL - 0.55, cell: [5, 19], make: (e) => M.funPartyTable(e.kit, "yellow", { length: 1.0, depth: 0.6, places: 1, stage: 1 }) });
    specs.push({ x: cx, z: 20 * CELL - 0.55, y: TABLE_TOP, cell: [5, 19], solid: false, tag: "pickup:candles", glow: { color: 0xffe08a, size: 0.7 }, make: (e) => M.funCandleBox(e.kit) });
    this.onWall(specs, 2, 16, "W", 0, 1.5, (e) => M.funNote(e.kit, lines("fun.hint.service"), 5));
    this.onWall(specs, 6, 16, "E", 0.4, 1.45, (e) => M.funNote(e.kit, lines("fun.note.b"), 2));
    this.onWall(specs, 4, 14, "N", 1.3, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 3 }, 6), { to: 0 });
    this.onWall(specs, 4, 14, "N", 1.3, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 3, wrong: true }, 6), { from: 1 });
    const [ax, az] = cc(3, 17);
    tableSet(specs, ax + 0.4, az, { length: 1.4, depth: 0.8, places: 2, cloth: "pink", cell: [3, 17], tipFrom: 1 });
    const [bx, bz] = cc(6, 15);
    specs.push({ x: bx - 0.3, z: bz, cell: [6, 15], make: (e) => M.funBalloonCluster(e.kit, e.rng, 4) });

    // --- Room A3: cups and the last drawing ------------------------------
    const [ux] = cc(12, 14);
    specs.push({ x: ux, z: 14 * CELL + 0.55, cell: [12, 14], make: (e) => M.funPartyTable(e.kit, "green", { length: 1.0, depth: 0.6, places: 1, stage: 1 }) });
    specs.push({
      x: ux, z: 14 * CELL + 0.55, y: TABLE_TOP, cell: [12, 14], solid: false, tag: "pickup:cups", glow: { color: 0xffe08a, size: 0.7 },
      make: (e) => {
        const g = new THREE.Group();
        for (const [i, c] of (["red", "yellow", "blue"] as M.PartyColor[]).entries()) { const cup = M.funCup(e.kit, c).object; cup.position.set((i - 1) * 0.13, 0, 0); g.add(cup); }
        return { object: g, footprint: [] };
      },
    });
    this.onWall(specs, 13, 16, "E", 0, 1.5, (e) => M.funNote(e.kit, lines("fun.hint.last"), 7));
    this.onWall(specs, 9, 17, "W", 0, 1.5, (e) => { const l = lines("fun.poster.order"); return M.funPoster(e.kit, l[0], l.slice(1), "purple"); });
    this.onWall(specs, 11, 19, "S", -0.9, 1.4, (e) => M.funNote(e.kit, lines("fun.note.c"), 3));
    const [kx, kz] = cc(10, 18);
    specs.push({ x: kx, z: kz, cell: [10, 18], solid: false, make: (e) => M.funPartyDebris(e.kit, e.rng, 1) });
    const [wx, wz] = cc(13, 18);
    specs.push({ x: wx - 0.4, z: wz - 0.3, cell: [13, 18], make: (e) => M.funBalloonCluster(e.kit, e.rng, 3) });
  }

  private sceneHub(specs: PropSpec[]) {
    // The lock, and the hint beside it.
    const panel = wallAt(38, 8, "E", 0);
    specs.push({
      x: panel.x, z: panel.z, yaw: panel.yaw, cell: [38, 8], solid: false, tag: "panel",
      make: (e) => M.funSequencePanel(e.kit, PANEL_BUTTONS.map((b) => ({ ...b })), 4),
    });
    this.onWall(specs, 38, 4, "E", 0, 1.5, (e) => { const l = lines("fun.poster.sequence"); return M.funPoster(e.kit, l[0], l.slice(1), "orange"); });
    this.onWall(specs, 38, 3, "E", 0, 2.8, (e) => M.funBirthdayBanner(e.kit, 3.4));

    // A coloured dot by each room's corridor, so the doors read before you reach them.
    for (const [theme, gx] of [["red", 16], ["blue", 22], ["yellow", 28], ["green", 34]] as const) {
      this.onWall(specs, gx, 9, "S", 0.5, 1.5, (e) => M.funWallSymbol(e.kit, "circle", theme, 0.55));
    }
    // Windows onto nothing — with something in them, now and then.
    [20, 26, 32].forEach((gx, i) => {
      const w = wallAt(gx, 9, "S", 0);
      specs.push({ x: w.x, z: w.z, yaw: w.yaw, cell: [gx, 9], solid: false, make: (e) => backedWindow(e.kit) });
      specs.push({ x: w.x, z: w.z, y: 0, yaw: w.yaw, cell: [gx, 9], solid: false, hidden: true, tag: `pg:window:${i}`, make: (e) => windowFigure(e.kit) });
    });

    // Tables scattered down the gallery, some already turned over.
    const sets: [number, number, number, M.PartyColor][] = [[19, 4, 0, "pink"], [25, 6, 0.4, "blue"], [30, 4, 0, "yellow"], [36, 6, 0.2, "green"], [22, 3, 0, "purple"]];
    for (const [gx, gz, yaw, cloth] of sets) {
      const [x, z] = cc(gx, gz);
      tableSet(specs, x, z, { length: 1.6, depth: 0.8, places: 2, cloth, yaw, cell: [gx, gz], tipFrom: 1 });
    }
    for (const gx of [18, 27, 33]) {
      const [x, z] = cc(gx, 8);
      specs.push({ x, z, cell: [gx, 8], make: (e) => M.funBalloonCluster(e.kit, e.rng, 5) });
    }
    this.onWall(specs, 20, 2, "N", 0, 2.85, (e) => M.funBirthdayBanner(e.kit, 3.4));
    this.onWall(specs, 29, 2, "N", 0, 2.85, (e) => M.funGarland(e.kit, 3.6, 0.3));
    this.onWall(specs, 24, 2, "N", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 5 }, 11), { to: 1 });
    this.onWall(specs, 24, 2, "N", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "partygoer" }, 11), { from: 2 });
    this.onWall(specs, 16, 4, "W", 0, 1.5, (e) => M.funNote(e.kit, lines("fun.note.d"), 4));
    // Far end of the gallery: something standing where the party should be.
    const [ex, ez] = cc(37, 3);
    specs.push({ x: ex, z: ez, yaw: Math.PI / 2 + 0.2, cell: [37, 3], solid: false, hidden: true, tag: "pg:hubEnd", make: (e) => M.funPartygoer(e.kit, { silhouette: true }) });
    const [mx, mz] = cc(17, 9);
    specs.push({ x: mx, z: mz - 1.2, yaw: 0, cell: [17, 9], solid: false, hidden: true, tag: "pg:hubMouth", make: (e) => M.funPartygoer(e.kit, { silhouette: true }) });
  }

  private sceneThemedRooms(specs: PropSpec[]) {
    const rooms: { theme: FunTheme; x1: number; x2: number }[] = [
      { theme: "red", x1: 16, x2: 19 }, { theme: "blue", x1: 22, x2: 25 },
      { theme: "yellow", x1: 28, x2: 31 }, { theme: "green", x1: 34, x2: 37 },
    ];
    for (const { theme, x1, x2 } of rooms) {
      const place = this.code.position[theme];
      const cxm = (x1 + x2 + 1) * (CELL / 2);
      // The party table, laid for guests.
      tableSet(specs, cxm, 16 * CELL + 0.5, { length: 1.6, depth: 0.8, places: 2, cloth: theme, cell: [x1 + 1, 16], chairColors: [theme, "white"], tipFrom: 2 });
      // The clue: this room's symbol, drawn as many times as its place in the sequence.
      this.onWall(specs, x1 + 1, 18, "S", 0.5, 1.45, (e) => M.funDrawing(e.kit, { kind: "symbol", symbol: THEME_SYMBOL[theme], color: theme, count: place }, x1 * 3));
      // ...and the same number told as balloons. They come and go between visits.
      const [ax, az] = cc(x1, 13);
      specs.push({ x: ax + 0.3, z: az + 0.3, cell: [x1, 13], tag: `balloonsA:${theme}`, make: (e) => M.funBalloonCluster(e.kit, e.rng, place, [theme]) });
      const [bx, bz] = cc(x2, 18);
      specs.push({ x: bx - 0.3, z: bz - 0.2, cell: [x2, 18], tag: `balloonsB:${theme}`, hidden: true, make: (e) => M.funBalloonCluster(e.kit, e.rng, place, [theme]) });
      // Presents nobody opened, garlands, and the room going wrong at stage 2.
      const [gx, gz] = cc(x2, 15);
      specs.push({ x: gx - 0.5, z: gz, yaw: 0.4, cell: [x2, 15], make: (e) => M.funGift(e.kit, theme, "white", 0.34) });
      this.onWall(specs, x1 + 2, 13, "N", 1.2, 2.85, (e) => M.funGarland(e.kit, 3.0, 0.25, [theme, "white"]));
      this.onWall(specs, x1, 16, "W", 0, 1.9, (e) => M.funWallSymbol(e.kit, "smile", "red", 0.5), { from: 2 });
      this.onWall(specs, x2, 15, "E", 0, 1.5, (e) => M.funNote(e.kit, lines("fun.note.e"), x1), { from: 1, to: 1 });
      specs.push({ x: gx - 1.4, z: gz + 1.6, cell: [x2, 16], solid: false, from: 1, make: (e) => M.funPartyDebris(e.kit, e.rng, 2) });
    }
  }

  private sceneP3Corridor(specs: PropSpec[]) {
    // The long walk between the puzzles: a figure at the far end, and little else.
    const [x, z] = cc(44, 21);
    specs.push({ x, z, yaw: 0, cell: [44, 21], solid: false, hidden: true, tag: "pg:corridorEnd", make: (e) => M.funPartygoer(e.kit, { silhouette: true }) });
    const [px, pz] = cc(41, 6);
    specs.push({ x: px, z: pz, yaw: -Math.PI / 2, cell: [41, 6], solid: false, hidden: true, tag: "pg:corrG2", make: (e) => M.funPartygoer(e.kit, { silhouette: true }) });
    this.onWall(specs, 44, 10, "W", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "partygoer" }, 21));
    this.onWall(specs, 44, 15, "E", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 6, wrong: true }, 22));
    this.onWall(specs, 44, 19, "W", 0, 1.3, (e) => M.funNote(e.kit, lines("fun.note.f"), 5));
    const [bx, bz] = cc(44, 12);
    specs.push({ x: bx, z: bz, cell: [44, 12], make: (e) => M.funBalloon(e.kit, "red", { deflated: true }), solid: false });
    for (const gz of [8, 14, 20]) {
      const w = wallAt(44, gz, "W", 0);
      specs.push({ x: w.x, z: w.z, yaw: w.yaw, y: 2.85, cell: [44, gz], solid: false, make: (e) => M.funGarland(e.kit, 3.4, 0.3, ["white", "red"]) });
    }
  }

  private sceneLastHall(specs: PropSpec[]) {
    const [cx, cz] = cc(37, 32);
    const slots: [string, M.PartyItem, number][] = [["gift", "gift", -1.1], ["cake", "cake", 0], ["balloon", "balloons", 1.1]];
    // The banquet: three lengths of table end to end, far too many chairs.
    const seats: { x: number; z: number; yaw: number }[] = [];
    const perSection = 4;
    for (const off of [-2.5, 0, 2.5]) {
      const sx = cx + off;
      const seatCell: [number, number] = [Math.floor(sx / CELL), Math.floor(cz / CELL)];
      specs.push({ x: sx, z: cz, cell: seatCell, make: (e) => M.funPartyTable(e.kit, "white", { length: 2.4, depth: 1.1, places: perSection, stage: 2 }) });
      for (const side of [1, -1]) {
        for (let i = 0; i < perSection; i++) {
          const x = sx + (i - (perSection - 1) / 2) * (2.4 / perSection), z = cz + side * (1.1 / 2 + 0.3);
          const yaw = side > 0 ? Math.PI : 0;
          const idx = seats.length;
          seats.push({ x, z, yaw });
          const color = (["red", "blue", "yellow", "green", "pink", "purple", "orange"] as M.PartyColor[])[(seats.length * 3) % 7];
          const askew = ((seats.length * 37) % 11) / 11 * 0.4 - 0.2;
          specs.push({
            x, z, yaw: yaw + askew, cell: [Math.floor(x / CELL), Math.floor(z / CELL)],
            make: (e) => M.funKidChair(e.kit, color, idx % 9 === 0),
          });
        }
      }
    }
    for (const yaw of [-Math.PI / 2, Math.PI / 2]) {
      const x = cx + (yaw < 0 ? 3.9 : -3.9);
      seats.push({ x, z: cz, yaw });
      specs.push({ x, z: cz, yaw, cell: [Math.floor(x / CELL), Math.floor(cz / CELL)], make: (e) => M.funKidChair(e.kit, "purple", false) });
    }
    // The three empty places the final items belong in.
    for (const [name, item, dx] of slots) {
      specs.push({ x: cx + dx, z: cz, y: TABLE_TOP, cell: [Math.floor((cx + dx) / CELL), Math.floor(cz / CELL)], solid: false, tag: `p3slot:${name}`, make: (e) => M.funPlacementMarker(e.kit, item, 0.5) });
    }
    // A place setting in front of nearly every seat.
    seats.forEach((seat, i) => {
      if (i % 4 === 3 || seat.z === cz) return;
      const tz = seat.z + (seat.z > cz ? -0.62 : 0.62);
      specs.push({ x: seat.x, z: tz, y: TABLE_TOP, cell: [Math.floor(seat.x / CELL), Math.floor(tz / CELL)], solid: false, make: (e) => M.funPlate(e.kit, i % 2 ? "white" : "pink") });
      if (i % 3 !== 0) specs.push({ x: seat.x + 0.16, z: tz, y: TABLE_TOP, cell: [Math.floor((seat.x + 0.16) / CELL), Math.floor(tz / CELL)], solid: false, make: (e) => M.funCup(e.kit, i % 2 ? "red" : "blue", i % 5 === 0) });
    });

    // The message, and the door that is visible but not yet yours.
    this.onWall(specs, 37, 23, "N", 0, 1.75, (e) => M.funWallMessage(e.kit, 3.6));
    this.onWall(specs, 33, 23, "N", 0, 2.8, (e) => M.funBirthdayBanner(e.kit, 3.4));
    this.onWall(specs, 41, 23, "N", 0, 2.8, (e) => M.funBirthdayBanner(e.kit, 3.4));
    this.onWall(specs, 44, 30, "E", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 7, wrong: true }, 31));
    this.onWall(specs, 44, 35, "E", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "partygoer" }, 32));
    this.onWall(specs, 40, 41, "S", 0, 1.5, (e) => M.funNote(e.kit, lines("fun.note.g"), 6));
    for (const [gx, gz] of [[31, 24], [43, 24], [31, 40], [43, 40], [44, 27]] as const) {
      const [x, z] = cc(gx, gz);
      specs.push({ x, z, cell: [gx, gz], make: (e) => M.funBalloonCluster(e.kit, e.rng, 6) });
    }
    for (const [gx, gz] of [[34, 27], [40, 37], [33, 36], [42, 28]] as const) {
      const [x, z] = cc(gx, gz);
      specs.push({ x, z, cell: [gx, gz], solid: false, make: (e) => M.funPartyDebris(e.kit, e.rng, 2) });
    }
    for (const [gx, gz] of [[34, 30], [40, 34], [36, 26], [39, 39]] as const) {
      const [x, z] = cc(gx, gz);
      for (let i = 0; i < 3; i++) {
        const colors: M.PartyColor[] = ["red", "yellow", "purple"];
        specs.push({ x: x + (i - 1) * 0.4, z, y: WALL_H, cell: [gx, gz], solid: false, make: (e) => M.funStreamer(e.kit, colors[i], 1.0 + i * 0.2) });
      }
    }

    // The crowd: every seat, and standing figures packed between the tables. Hidden until the director says so.
    const rng = new FunRandom(this.env.seed + 0xc20d);
    seats.forEach((seat, i) => {
      if (i % 9 === 4) return;
      specs.push({
        x: seat.x, z: seat.z, yaw: seat.yaw, hidden: true, solid: false, tag: "crowd",
        cell: [Math.floor(seat.x / CELL), Math.floor(seat.z / CELL)], y: 0,
        make: (e) => M.funPartygoer(e.kit, { pose: "sit", silhouette: true, scale: 0.95 + (i % 5) * 0.03 }),
      });
    });
    for (let i = 0; i < 26; i++) {
      let x = 0, z = 0;
      do {
        x = rng.nextRange(30.6, 44.6) * CELL; z = rng.nextRange(23.6, 40.6) * CELL;
      } while (Math.abs(z - cz) < 2.0 && Math.abs(x - cx) < 5.2);
      const yaw = Math.atan2(cx - x, cz - z) + rng.nextRange(-0.3, 0.3);
      specs.push({
        x, z, yaw, hidden: true, solid: false, tag: "crowd", cell: [Math.floor(x / CELL), Math.floor(z / CELL)],
        make: (e) => M.funPartygoer(e.kit, { silhouette: true, scale: 0.9 + (i % 6) * 0.05 }),
      });
    }
    // One that isn't a silhouette: at the head of the table, facing the door you came in by, and one at the exit.
    specs.push({ x: cx - 4.8, z: cz, yaw: -Math.PI / 2, cell: [Math.floor((cx - 4.8) / CELL), Math.floor(cz / CELL)], hidden: true, solid: false, tag: "pg:head", make: (e) => M.funPartygoer(e.kit, { scale: 1.08 }) });
    const [exx, exz] = cc(30, 38);
    specs.push({ x: exx + 0.5, z: exz, yaw: -Math.PI / 2, cell: [30, 38], hidden: true, solid: false, tag: "pg:exit", make: (e) => M.funPartygoer(e.kit, { scale: 1.1 }) });
  }

  private sceneAnnexes(specs: PropSpec[]) {
    // --- Depot: the toy chest (the present) ---------------------------------
    const [dx] = cc(40, 14);
    const chestZ = 14 * CELL + 0.45;
    specs.push({ x: dx, z: chestZ, cell: [40, 14], tag: "container:gift", make: (e) => M.funToyChest(e.kit, "blue") });
    specs.push({ x: dx, z: chestZ, y: 0.5, yaw: 0.3, cell: [40, 14], solid: false, hidden: true, tag: "item:gift", glow: { color: 0xffe08a, size: 0.9 }, make: (e) => M.funGift(e.kit, "purple", "yellow", 0.32) });
    this.onWall(specs, 39, 17, "W", 0, 1.4, (e) => M.funNote(e.kit, lines("fun.note.h"), 8));
    const [sx, sz] = cc(41, 19);
    for (let i = 0; i < 5; i++) specs.push({ x: sx + (i % 2) * 0.3, z: sz + 0.5, y: 0, cell: [41, 19], solid: i === 0, make: (e) => M.funGift(e.kit, (["red", "green", "yellow", "pink", "blue"] as M.PartyColor[])[i], "white", 0.3 + (i % 3) * 0.05) });
    const [tx, tz] = cc(40, 18);
    tableSet(specs, tx, tz, { length: 1.4, depth: 0.7, places: 2, cloth: "blue", cell: [40, 18], tipFrom: 2 });
    this.onWall(specs, 42, 15, "E", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "family", figures: 4, wrong: true }, 41));

    // --- Kitchen: the cabinet (the cake) ------------------------------------
    const cab = wallAt(40, 45, "E", 0);
    specs.push({ x: cab.x, z: cab.z, yaw: cab.yaw, cell: [40, 45], tag: "container:cake", make: (e) => M.funCabinet(e.kit) });
    // Shelf is 0.225 m out from the wall along the cabinet's +Z (-X in the world).
    specs.push({ x: cab.x - 0.225, z: cab.z, y: 0.85 + 0.36 + 0.013, cell: [40, 45], solid: false, hidden: true, tag: "item:cake", glow: { color: 0xffe08a, size: 0.9 }, make: (e) => M.funCake(e.kit, { candles: 5, lit: false }) });
    for (const gx of [34, 38]) {
      const w = wallAt(gx, 44, "N", 0);
      specs.push({ x: w.x, z: w.z + 0.35, cell: [gx, 44], make: (e) => counterUnit(e.kit) });
    }
    const [kx, kz] = cc(36, 45);
    tableSet(specs, kx, kz, { length: 1.8, depth: 0.9, places: 2, cloth: "white", cell: [36, 45], tipFrom: 1 });
    specs.push({ x: kx, z: kz, y: TABLE_TOP, cell: [36, 45], solid: false, make: (e) => M.funCake(e.kit, { candles: 4, lit: false, rotten: true }) });
    this.onWall(specs, 33, 45, "W", 0, 1.4, (e) => M.funNote(e.kit, lines("fun.note.i"), 9));
    this.onWall(specs, 38, 46, "S", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "partygoer" }, 51), { from: 2 });
    const [dbx, dbz] = cc(34, 46);
    specs.push({ x: dbx, z: dbz, cell: [34, 46], solid: false, make: (e) => M.funPartyDebris(e.kit, e.rng, 2) });

    // --- Playroom: the ball pit of balloons (the special one) ----------------
    const [px, pz] = cc(22, 31);
    specs.push({
      x: px, z: pz, cell: [22, 31], tag: "container:balloon",
      make: (e) => {
        const g = new THREE.Group();
        const colors: M.PartyColor[] = ["red", "blue", "yellow", "green", "pink", "purple", "orange"];
        for (let i = 0; i < 34; i++) {
          const a = e.rng.nextRange(0, Math.PI * 2), d = Math.sqrt(e.rng.next()) * 1.1;
          const b = M.funBalloon(e.kit, colors[e.rng.nextInt(0, colors.length)], { height: 0 }).object;
          b.children.forEach((c) => { c.visible = c.name === "balloon"; });
          const body = b.getObjectByName("balloon");
          if (body) { body.position.set(0, 0.12, 0); body.rotation.set(e.rng.nextRange(-0.6, 0.6), e.rng.nextRange(0, 6.28), e.rng.nextRange(-1.2, 1.2)); }
          b.position.set(Math.cos(a) * d, e.rng.nextRange(0, 0.28), Math.sin(a) * d);
          g.add(b);
        }
        return { object: g, footprint: [[0, 0, 1.05]] };
      },
    });
    specs.push({ x: px, z: pz, y: 0.3, cell: [22, 31], solid: false, hidden: true, tag: "item:balloon", glow: { color: 0xffe08a, size: 1.2 }, make: (e) => M.funSpecialBalloon(e.kit, 1.1) });
    this.onWall(specs, 20, 30, "W", 0, 1.4, (e) => M.funNote(e.kit, lines("fun.note.j"), 10));
    this.onWall(specs, 23, 28, "N", 0, 1.5, (e) => M.funDrawing(e.kit, { kind: "symbol", symbol: "star", color: "yellow", count: 3 }, 61));
    const [qx, qz] = cc(24, 33);
    tableSet(specs, qx, qz, { length: 1.4, depth: 0.7, places: 2, cloth: "orange", cell: [24, 33], tipFrom: 1 });
    const [wx, wz] = cc(21, 29);
    specs.push({ x: wx, z: wz, cell: [21, 29], make: (e) => M.funBalloonCluster(e.kit, e.rng, 4) });
    this.onWall(specs, 25, 33, "E", 0, 2.85, (e) => M.funGarland(e.kit, 3.4, 0.3));
    const [pgx, pgz] = cc(25, 29);
    specs.push({ x: pgx, z: pgz, yaw: Math.PI, cell: [25, 29], solid: false, hidden: true, tag: "pg:playroom", make: (e) => M.funPartygoer(e.kit, { silhouette: true, pose: "peek" }) });
  }
}

/**
 * An interior window with a dark, opaque pane. The cell walls are flat planes
 * with no way to cut a hole in them, so the "view" is painted on: a dim
 * backdrop just in front of the wallpaper, under the frame and blinds.
 */
function backedWindow(kit: DecorKit): M.FunPiece {
  const w = M.funWindow(kit, 1.4, 1.0);
  const glass = w.object.getObjectByName("glass");
  if (glass) glass.position.z = 0.05;
  const pane = new THREE.Mesh(
    kit.geo("fun_window_pane", () => new THREE.PlaneGeometry(1.4, 1.0)),
    kit.mat("fun_window_pane", () => new THREE.MeshBasicMaterial({ color: 0x1b1a1f })),
  );
  pane.position.set(0, 1.4, 0.03);
  w.object.add(pane);
  return w;
}

/** A tall dark figure with a pale, too-wide smile, drawn flat over a window's pane. */
function windowFigure(kit: DecorKit): M.FunPiece {
  const mat = kit.mat("fun_window_figure", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#050505";
      ctx.beginPath(); ctx.ellipse(64, 84, 34, 42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(58, 120, 12, 26);
      ctx.beginPath(); ctx.moveTo(8, 256); ctx.quadraticCurveTo(14, 150, 64, 146); ctx.quadraticCurveTo(114, 150, 120, 256); ctx.fill();
      ctx.strokeStyle = "#d8d2c0"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(36, 92); ctx.quadraticCurveTo(64, 132, 92, 92); ctx.stroke();
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    kit.track(map);
    return new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.1 });
  });
  const g = new THREE.Group();
  const m = new THREE.Mesh(kit.geo("fun_window_figure", () => new THREE.PlaneGeometry(0.5, 1.0)), mat);
  m.position.set(0, 1.4, 0.045);
  g.add(m);
  return { object: g, footprint: [] };
}

/** A plain kitchen counter block. */
function counterUnit(kit: DecorKit): M.FunPiece {
  const g = new THREE.Group();
  const body = kit.mat("fun_counter_body", () => new THREE.MeshStandardMaterial({ color: 0xe9e4d2, roughness: 0.7 }));
  const top = kit.mat("fun_counter_top", () => new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6 }));
  g.add(new THREE.Mesh(kit.geo("fun_counter_a", () => new THREE.BoxGeometry(1.5, 0.86, 0.6)), body));
  g.children[0].position.set(0, 0.43, 0);
  const t2 = new THREE.Mesh(kit.geo("fun_counter_b", () => new THREE.BoxGeometry(1.56, 0.04, 0.66)), top);
  t2.position.set(0, 0.88, 0);
  g.add(t2);
  return { object: g, footprint: [[-0.45, 0, 0.42], [0.45, 0, 0.42]] };
}

export { FUN_THEMES };
