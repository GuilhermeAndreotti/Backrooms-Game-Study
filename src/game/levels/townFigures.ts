/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94's people: rubber-hose cartoon figures, the way a 1930s short drew
 * them — round heads, pie-cut eyes, hose limbs, white gloves, big shoes.
 *
 * One builder ({@link buildToon}) serves everybody. It only needs the rig
 * calls a MobDefinition's build() gets, so the night's Animations and the
 * King (mobs/animation.ts, mobs/townKing.ts) are built by it inside
 * WanderingEntity, and the daytime townsfolk here are built by it through a
 * small standalone context ({@link standaloneToonCtx}).
 *
 * Townsfolk are purely cosmetic and local: each loops one small motion
 * forever (sweeping, reading, pacing...), turns its head to watch whoever
 * walks by, and freezes when the clock starts. Nothing here is replicated.
 */

import * as THREE from "three";
import type { DecorKit } from "../LevelDecor";
import { animateBiped, rot, rx } from "../mobs/anim";
import type { MobAnimCtx, MobBuildCtx, MobJoints } from "../mobs/types";
import { NO_SCRIPTED_POSE } from "../mobs/types";
import type { TownsfolkRole, TownsfolkSpot } from "./townLayout";

export type ToonBuild = Pick<MobBuildCtx, "joint" | "limbIn" | "put" | "sgeo" | "smat" | "V">;

export type ToonFace = "towns" | "animation" | "king";

export interface ToonLook {
  /** Cache-key prefix for this look's own materials. */
  key: string;
  /** 1 = a 1.6 m townsperson. */
  scale: number;
  /** Rubber-hose limbs and body. */
  body: number;
  face: ToonFace;
  /** Coat/shorts colour (null: bare cartoon body). */
  coat: number | null;
  hat: "bowler" | "cap" | "bonnet" | "top" | "crown" | "none";
  hatColor: number;
  /** Limb thickness multiplier. */
  limbs: number;
  /** Extra arm length (the King's reach). */
  reach?: number;
}

/** Feet sit this far below the rig's origin, times the look's scale (a mob's baseHeight). */
export const TOON_FEET = 0.95;

const faceCache = new Map<string, THREE.CanvasTexture>();

/**
 * Head texture, laid out for SphereGeometry's UVs: the face is centred at
 * u = 0.25, which three.js wraps onto the sphere's +z side (the front).
 */
export function toonFaceTexture(kind: ToonFace, skin: string): THREE.CanvasTexture {
  const key = `${kind}_${skin}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = kind === "towns" ? skin : "#111111";
  g.fillRect(0, 0, 512, 256);
  const cx = 128, cy = 132;
  // The face mask (rubber-hose characters wear their face like a plate on a black head).
  g.fillStyle = kind === "animation" ? "#f4efe2" : kind === "king" ? "#efe2c4" : skin;
  g.beginPath();
  g.ellipse(cx, cy + 10, 78, 80, 0, 0, Math.PI * 2);
  g.fill();
  if (kind !== "towns") {
    // Two lobes over the eyes, like the old studios drew it.
    g.beginPath(); g.ellipse(cx - 30, cy - 38, 34, 44, -0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 30, cy - 38, 34, 44, 0.2, 0, Math.PI * 2); g.fill();
  }
  // Pie-cut eyes.
  for (const side of [-1, 1]) {
    const ex = cx + side * 24, ey = cy - 30;
    g.fillStyle = "#0b0b0b";
    g.beginPath(); g.ellipse(ex, ey, 13, kind === "animation" ? 26 : 22, 0, 0, Math.PI * 2); g.fill();
    if (kind === "animation") {
      // Pinprick pupils, staring.
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(ex + side * 2, ey + 4, 3.2, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = "#ffffff";
      g.beginPath(); g.moveTo(ex + 2, ey - 6); g.arc(ex + 2, ey - 6, 9, -1.9, -1.0); g.closePath(); g.fill();
    }
  }
  // Nose.
  g.fillStyle = kind === "king" ? "#7a2a2a" : "#151515";
  g.beginPath(); g.ellipse(cx, cy + 2, 12, 8, 0, 0, Math.PI * 2); g.fill();
  // Mouth: a polite smile in town; too wide, all teeth, at night and on the King.
  g.strokeStyle = "#0b0b0b";
  g.lineWidth = 5;
  if (kind === "towns") {
    g.beginPath(); g.arc(cx, cy + 14, 26, 0.35, Math.PI - 0.35); g.stroke();
    g.fillStyle = "rgba(230,110,110,0.45)";
    g.beginPath(); g.arc(cx - 42, cy + 14, 11, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + 42, cy + 14, 11, 0, Math.PI * 2); g.fill();
  } else {
    const w = kind === "king" ? 66 : 58;
    g.fillStyle = "#0b0b0b";
    g.beginPath(); g.moveTo(cx - w, cy + 6); g.quadraticCurveTo(cx, cy + 86, cx + w, cy + 6); g.quadraticCurveTo(cx, cy + 40, cx - w, cy + 6); g.fill();
    g.fillStyle = "#f8f4e8";
    for (let i = -4; i <= 4; i++) {
      const tx = cx + i * (w / 5.2);
      const ty = cy + 20 + (16 - Math.abs(i) * 3);
      g.fillRect(tx - 4, ty - 6, 8, 11);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  faceCache.set(key, tex);
  return tex;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/**
 * Builds a rubber-hose figure over the standard joint names (spine, head,
 * armL/foreL, armR/foreR, legL/shinL, legR/shinR), so animateBiped can drive
 * it. Body space: +z forward, origin TOON_FEET * scale above the feet.
 */
export function buildToon(ctx: ToonBuild, look: ToonLook) {
  const s = look.scale;
  const V = (x: number, y: number, z: number) => ctx.V(x * s, y * s, z * s);
  const k = look.key;
  const body = ctx.smat(`${k}_body`, () => new THREE.MeshStandardMaterial({ color: look.body, roughness: 0.5 }));
  const glove = ctx.smat("toon_glove", () => new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.6 }));
  const shoe = ctx.smat(`${k}_shoe`, () => new THREE.MeshStandardMaterial({ color: look.face === "towns" ? 0x5a3a24 : 0x161616, roughness: 0.35 }));
  const coat = look.coat === null ? body : ctx.smat(`${k}_coat`, () => new THREE.MeshStandardMaterial({ color: look.coat!, roughness: 0.7 }));
  const sphere = ctx.sgeo("toon_sphere", () => new THREE.SphereGeometry(1, 18, 14));
  const lr = 0.045 * look.limbs * s;

  const ball = (parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(sphere, mat);
    m.position.copy(V(x, y, z));
    m.scale.set(sx * s, sy * s, sz * s);
    m.castShadow = true;
    return ctx.put(parent, m);
  };

  // Hips and the pear-shaped body.
  const spine = ctx.joint("spine", 0, -0.36 * s, 0);
  ball(spine, coat, 0, -0.12, 0, 0.27, 0.34, 0.23);
  ball(spine, coat === body ? body : coat, 0, -0.32, 0, 0.25, 0.14, 0.21);
  if (look.coat !== null && look.face === "towns") {
    // Two big buttons.
    const btn = ctx.smat("toon_button", () => new THREE.MeshStandardMaterial({ color: 0xf2e6b8, roughness: 0.4 }));
    ball(spine, btn, 0, -0.06, 0.22, 0.035, 0.035, 0.02);
    ball(spine, btn, 0, -0.2, 0.215, 0.035, 0.035, 0.02);
  }
  if (look.hat === "crown") {
    // The King's robe and cape: a cone around the legs, a sheet behind.
    const robe = ctx.smat(`${k}_robe`, () => new THREE.MeshStandardMaterial({ color: 0x7a1424, roughness: 0.8, side: THREE.DoubleSide }));
    const cone = new THREE.Mesh(ctx.sgeo("toon_robe", () => new THREE.CylinderGeometry(0.2, 0.36, 0.55, 16, 1, true)), robe);
    cone.position.copy(V(0, -0.5, 0));
    cone.scale.setScalar(s);
    ctx.put(spine, cone);
    const ermine = ctx.smat("toon_ermine", () => new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.9 }));
    const collar = new THREE.Mesh(ctx.sgeo("toon_collar", () => new THREE.TorusGeometry(0.2, 0.06, 8, 20)), ermine);
    collar.position.copy(V(0, 0.16, 0));
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(s);
    ctx.put(spine, collar);
    const cape = new THREE.Mesh(ctx.sgeo("toon_cape", () => new THREE.PlaneGeometry(0.62, 1.05)), robe);
    cape.position.copy(V(0, -0.28, -0.24));
    cape.rotation.x = 0.12;
    cape.scale.setScalar(s);
    ctx.put(spine, cape);
  }

  // Head: a sphere wearing the face texture, then the hat.
  const head = ctx.joint("head", 0, 0.2 * s, 0, spine);
  const faceMat = ctx.smat(`${k}_face`, () => new THREE.MeshStandardMaterial({ map: toonFaceTexture(look.face, hex(0xf3d2b0)), roughness: 0.55 }));
  ball(head, faceMat, 0, 0.47, 0.02, 0.28, 0.27, 0.27);
  const hatMat = ctx.smat(`${k}_hat`, () => new THREE.MeshStandardMaterial({ color: look.hatColor, roughness: look.hat === "crown" ? 0.25 : 0.6, metalness: look.hat === "crown" ? 0.85 : 0 }));
  const hatY = 0.66;
  switch (look.hat) {
    case "bowler": {
      ball(head, hatMat, 0, hatY, 0, 0.2, 0.15, 0.2);
      const brim = new THREE.Mesh(ctx.sgeo("toon_brim", () => new THREE.CylinderGeometry(0.29, 0.29, 0.025, 20)), hatMat);
      brim.position.copy(V(0, hatY - 0.03, 0));
      brim.scale.setScalar(s);
      ctx.put(head, brim);
      break;
    }
    case "cap": {
      ball(head, hatMat, 0, hatY - 0.02, -0.02, 0.27, 0.11, 0.27);
      const peak = new THREE.Mesh(ctx.sgeo("toon_peak", () => new THREE.BoxGeometry(0.3, 0.02, 0.18)), hatMat);
      peak.position.copy(V(0, hatY - 0.05, 0.25));
      peak.scale.setScalar(s);
      ctx.put(head, peak);
      break;
    }
    case "bonnet": {
      ball(head, hatMat, 0, hatY - 0.03, -0.05, 0.3, 0.17, 0.27);
      ball(head, hatMat, 0.16, hatY + 0.06, 0, 0.07, 0.07, 0.07);
      break;
    }
    case "top": {
      // Bent, the way the night ones wear it.
      const tall = new THREE.Mesh(ctx.sgeo("toon_top", () => new THREE.CylinderGeometry(0.15, 0.17, 0.42, 16)), hatMat);
      tall.position.copy(V(0.03, hatY + 0.17, 0));
      tall.rotation.z = -0.22;
      tall.scale.setScalar(s);
      ctx.put(head, tall);
      const brim = new THREE.Mesh(ctx.sgeo("toon_brim", () => new THREE.CylinderGeometry(0.29, 0.29, 0.025, 20)), hatMat);
      brim.position.copy(V(0, hatY - 0.02, 0));
      brim.rotation.z = -0.1;
      brim.scale.setScalar(s);
      ctx.put(head, brim);
      break;
    }
    case "crown": {
      const band = new THREE.Mesh(ctx.sgeo("toon_crown", () => new THREE.CylinderGeometry(0.2, 0.18, 0.12, 12, 1, true)), hatMat);
      band.position.copy(V(0, hatY + 0.02, 0));
      band.scale.setScalar(s);
      ctx.put(head, band);
      const spike = ctx.sgeo("toon_spike", () => new THREE.ConeGeometry(0.035, 0.16, 6));
      const jewel = ctx.smat("toon_jewel", () => new THREE.MeshStandardMaterial({ color: 0xc81e3a, emissive: 0x5a0010, roughness: 0.2 }));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const sp = new THREE.Mesh(spike, hatMat);
        sp.position.copy(V(Math.sin(a) * 0.19, hatY + 0.15, Math.cos(a) * 0.19));
        sp.scale.setScalar(s);
        ctx.put(head, sp);
        if (i % 2 === 0) ball(head, jewel, Math.sin(a) * 0.2, hatY + 0.02, Math.cos(a) * 0.2, 0.025, 0.025, 0.025);
      }
      break;
    }
    case "none":
      break;
  }

  // Arms: hose limbs ending in big white gloves.
  const reach = 1 + (look.reach ?? 0);
  for (const side of [-1, 1]) {
    const n = side < 0 ? "L" : "R";
    const arm = ctx.joint(`arm${n}`, side * 0.22 * s, 0.08 * s, 0, spine);
    const elbow = V(side * 0.34, -0.14 * reach, 0.02);
    ctx.limbIn(arm, body, V(side * 0.22, 0.08, 0), elbow, lr * 0.95);
    const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
    const wrist = V(side * 0.4, -0.37 * reach, 0.05);
    ctx.limbIn(fore, body, elbow, wrist, lr * 0.9);
    const hand = new THREE.Mesh(sphere, glove);
    hand.position.copy(wrist).add(V(side * 0.01, -0.05, 0.01));
    hand.scale.set(0.085 * s, 0.075 * s, 0.07 * s);
    ctx.put(fore, hand);
    const cuff = new THREE.Mesh(ctx.sgeo("toon_cuff", () => new THREE.CylinderGeometry(0.06, 0.07, 0.06, 12)), glove);
    cuff.position.copy(wrist).add(V(0, 0.03, 0));
    cuff.scale.setScalar(s);
    ctx.put(fore, cuff);
    if (look.hat === "crown" && side > 0) {
      // The sceptre.
      const rod = new THREE.Mesh(ctx.sgeo("toon_rod", () => new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8)), hatMat);
      rod.position.copy(wrist).add(V(0.02, 0.12, 0.04));
      rod.scale.setScalar(s);
      ctx.put(fore, rod);
      ball(fore, hatMat, wrist.x / s + 0.02, wrist.y / s + 0.48, wrist.z / s + 0.04, 0.05, 0.05, 0.05);
    }
  }

  // Legs: hose legs in oversized shoes.
  for (const side of [-1, 1]) {
    const n = side < 0 ? "L" : "R";
    const leg = ctx.joint(`leg${n}`, side * 0.1 * s, -0.4 * s, 0);
    const knee = V(side * 0.11, -0.66, 0.02);
    ctx.limbIn(leg, body, V(side * 0.1, -0.4, 0), knee, lr * 1.05);
    const shin = ctx.joint(`shin${n}`, knee.x, knee.y, knee.z, leg);
    const ankle = V(side * 0.11, -0.89, 0);
    ctx.limbIn(shin, body, knee, ankle, lr);
    ball(shin, shoe, side * 0.11, -0.9, 0.07, 0.11, 0.075, 0.19);
  }
}

/**
 * The rubber-hose walk: animateBiped's gait, played like a stop-motion
 * puppet (`fps` snaps time and stride to that many poses a second) with the
 * idle bounce cartoon characters never stop doing.
 */
export function animateToon(ctx: MobAnimCtx, fps: number, swagger = 1) {
  const step = (v: number, rate: number) => (fps > 0 ? Math.floor(v * rate) / rate : v);
  const time = step(ctx.time, fps);
  const phase = fps > 0 ? Math.floor(ctx.phase / (Math.PI / 5)) * (Math.PI / 5) : ctx.phase;
  animateBiped({ ...ctx, time, phase }, {
    stride: 0.75, armSwing: 0.95 * swagger, knee: 1.1, elbow: 0.35, lean: 0.3, bounce: 0.1, breathe: 0.03, reach: 1.0, headReach: 1,
  });
  // Idle: bounce to a tune only they can hear; squash and stretch with it.
  const idle = 1 - ctx.move;
  const beat = Math.sin(time * 6.5);
  ctx.body.position.y += Math.abs(beat) * 0.045 * idle * swagger;
  const squash = 1 + beat * 0.035 * swagger;
  ctx.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  if (ctx.joints.head) ctx.joints.head.rotation.z += Math.sin(time * 3.25) * 0.12 * idle * swagger;
}

// ---------------------------------------------------------------------------
// Standalone rigs (townsfolk, the secret ending's figure)
// ---------------------------------------------------------------------------

/** A ToonBuild over plain groups, caching through the level's kit (so it's disposed with the map). */
export function standaloneToonCtx(kit: DecorKit, root: THREE.Group): { ctx: ToonBuild; joints: MobJoints } {
  const joints: MobJoints = {};
  const origin = (o: THREE.Object3D): THREE.Vector3 => {
    const v = new THREE.Vector3();
    for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) v.add(n.position);
    return v;
  };
  const limb = (mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, taper = 1) => {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geo = kit.geo(`toon_limb_${radius.toFixed(3)}_${taper}`, () => new THREE.CylinderGeometry(radius * taper, radius, 1, 8));
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(1, len, 1);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };
  const ctx: ToonBuild = {
    sgeo: (key, build) => kit.geo(`tg_${key}`, build),
    smat: (key, build) => kit.mat(`tm_${key}`, build),
    V: (x, y, z) => new THREE.Vector3(x, y, z),
    joint: (name, x, y, z, parent = root) => {
      const j = new THREE.Group();
      j.name = name;
      j.position.set(x, y, z).sub(origin(parent));
      j.userData.rest = j.position.clone();
      parent.add(j);
      joints[name] = j;
      return j;
    },
    limbIn: (joint, mat, a, b, radius, taper) => {
      const o = origin(joint);
      const m = limb(mat, a.clone().sub(o), b.clone().sub(o), radius, taper);
      joint.add(m);
      return m;
    },
    put: (joint, obj) => {
      obj.position.sub(origin(joint));
      joint.add(obj);
      return obj;
    },
  };
  return { ctx, joints };
}

/** A rigged townsperson-shaped body, posed by {@link poseToon}. Feet at y = 0 of the returned group. */
export function buildStandaloneToon(kit: DecorKit, look: ToonLook): { group: THREE.Group; body: THREE.Group; joints: MobJoints } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = TOON_FEET * look.scale;
  group.add(body);
  const { ctx, joints } = standaloneToonCtx(kit, body);
  buildToon(ctx, look);
  return { group, body, joints };
}

/**
 * Sits a toon down: thighs forward, shins down, hands in the lap. Rubber-hose
 * legs are short, so on a seat higher than its knees the figure's feet dangle.
 */
export function poseSeated(joints: MobJoints, body: THREE.Group, scale: number, time = 0, seatHeight = 0) {
  body.position.y = TOON_FEET * scale - 0.26 * scale + Math.max(0, seatHeight - 0.29 * scale);
  for (const n of ["L", "R"]) {
    rx(joints[`leg${n}`], -1.5);
    rx(joints[`shin${n}`], 1.45);
    rot(joints[`arm${n}`], -0.5, 0, n === "L" ? -0.12 : 0.12);
    rx(joints[`fore${n}`], -0.9);
  }
  if (joints.spine) joints.spine.rotation.set(-0.05, 0, 0);
  if (joints.head) joints.head.rotation.set(0.05 + Math.sin(time * 0.4) * 0.02, 0, Math.sin(time * 0.3) * 0.04);
}

// ---------------------------------------------------------------------------
// Townsfolk
// ---------------------------------------------------------------------------

const ROLE_LOOK: Record<TownsfolkRole, ToonLook["hat"]> = {
  sweeper: "cap", reader: "bowler", postman: "cap", kid: "cap", lady: "bonnet",
  waver: "bowler", painter: "cap", dancer: "bowler", hatman: "bowler",
};

export class Townsfolk {
  readonly group: THREE.Group;
  readonly spot: TownsfolkSpot;
  private readonly body: THREE.Group;
  private readonly joints: MobJoints;
  private readonly prop: THREE.Object3D | null;
  private time: number;
  private look = 0;
  private lookYaw = 0;
  private frozen = false;
  private frozenTime = 0;
  /** Faces the clock tower once the clock starts. */
  private stareYaw: number | null = null;
  private readonly baseYaw: number;
  private paceX = 0;

  constructor(kit: DecorKit, spot: TownsfolkSpot, index: number) {
    this.spot = spot;
    const scale = spot.role === "kid" ? 0.72 : 1;
    const built = buildStandaloneToon(kit, {
      key: `folk${index}`, scale, body: 0x141414, face: "towns", coat: spot.coat,
      hat: ROLE_LOOK[spot.role], hatColor: spot.hat, limbs: 1,
    });
    this.group = built.group;
    this.body = built.body;
    this.joints = built.joints;
    this.group.position.set(spot.x, 0, spot.z);
    this.group.rotation.y = spot.yaw;
    this.baseYaw = spot.yaw;
    this.time = index * 1.7;
    this.prop = this.buildProp(kit);
  }

  private buildProp(kit: DecorKit): THREE.Object3D | null {
    const wood = kit.mat("tf_wood", () => new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 }));
    const g = new THREE.Group();
    switch (this.spot.role) {
      case "sweeper": {
        const handle = new THREE.Mesh(kit.geo("tf_handle", () => new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6)), wood);
        handle.position.y = -0.35;
        g.add(handle);
        const bristles = new THREE.Mesh(kit.geo("tf_bristle", () => new THREE.BoxGeometry(0.3, 0.16, 0.08)), kit.mat("tf_straw", () => new THREE.MeshStandardMaterial({ color: 0xd9b860, roughness: 1 })));
        bristles.position.y = -1.02;
        g.add(bristles);
        // The forearm joint sits at the elbow; the hand is a little below it.
        this.joints.foreR?.add(g);
        g.position.set(0.06, -0.26, 0.05);
        return g;
      }
      case "reader": {
        const paper = new THREE.Mesh(kit.geo("tf_paper", () => new THREE.PlaneGeometry(0.5, 0.36)), kit.mat("tf_newspaper", () => new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 1, side: THREE.DoubleSide })));
        paper.position.set(0, 0.25, 0.42);
        this.joints.spine?.add(paper);
        return paper;
      }
      case "kid": {
        const ball = new THREE.Mesh(kit.geo("tf_ball", () => new THREE.SphereGeometry(0.13, 12, 10)), kit.mat("tf_ballmat", () => new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.5 })));
        this.group.add(ball);
        return ball;
      }
      case "painter": {
        const brush = new THREE.Mesh(kit.geo("tf_brush", () => new THREE.BoxGeometry(0.06, 0.25, 0.04)), wood);
        brush.position.set(0.06, -0.3, 0.08);
        this.joints.foreR?.add(brush);
        return brush;
      }
      case "postman": {
        const bag = new THREE.Mesh(kit.geo("tf_bag", () => new THREE.BoxGeometry(0.3, 0.26, 0.12)), kit.mat("tf_leather", () => new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 })));
        bag.position.set(-0.3, -0.35, 0);
        this.joints.spine?.add(bag);
        return bag;
      }
      default:
        return null;
    }
  }

  /** The clock has started: stop dead and face the tower. */
  freeze(towerX: number, towerZ: number) {
    if (this.frozen) return;
    this.frozen = true;
    this.frozenTime = 0;
    this.stareYaw = Math.atan2(towerX - this.group.position.x, towerZ - this.group.position.z);
  }

  /** Back to the loop, as if the clock had never started. */
  unfreeze() {
    this.frozen = false;
    this.stareYaw = null;
  }

  /** `px, pz`: the local player (they watch whoever walks by). */
  update(delta: number, px: number, pz: number) {
    if (this.frozen) {
      // One last head turn towards the tower, then nothing at all.
      this.frozenTime += delta;
      if (this.stareYaw !== null && this.frozenTime < 1.2) {
        const want = this.stareYaw - this.group.rotation.y;
        const d = Math.atan2(Math.sin(want), Math.cos(want));
        if (this.joints.head) this.joints.head.rotation.y = THREE.MathUtils.clamp(d, -1.3, 1.3) * Math.min(1, this.frozenTime * 3);
      }
      return;
    }
    this.time += delta;
    const t = this.time;
    const g = this.group;
    const dx = px - g.position.x, dz = pz - g.position.z;
    const dist = Math.hypot(dx, dz);
    // Watching: some keep at it while they stare, the rest stop to look.
    const watch = dist < 7;
    this.look = THREE.MathUtils.damp(this.look, watch ? 1 : 0, 3, delta);
    const toPlayer = Math.atan2(dx, dz) - g.rotation.y;
    this.lookYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(toPlayer), Math.cos(toPlayer)), -1.4, 1.4);
    const stops = this.spot.role === "lady" || this.spot.role === "hatman" || this.spot.role === "postman" || this.spot.role === "sweeper";
    const busy = stops ? 1 - this.look : 1;

    let move = 0;
    if (this.spot.role === "postman") {
      // Three steps east, three steps west, forever.
      const want = Math.sin(t * 0.55) * 3;
      const v = (want - this.paceX) * busy;
      this.paceX += v * Math.min(1, delta * 2);
      move = Math.min(1, Math.abs(v) * 0.9);
      g.position.x = this.spot.x + this.paceX;
      g.rotation.y = this.baseYaw + (Math.cos(t * 0.55) >= 0 ? 0 : Math.PI);
    }

    this.body.position.set(0, TOON_FEET * (this.spot.role === "kid" ? 0.72 : 1), 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    const phase = t * 5.5;
    animateBiped({
      joints: this.joints, body: this.body, time: t, delta, phase, move, run: 0,
      observe: this.look, look: this.look, lookYaw: this.lookYaw, lookPitch: 0,
      agitated: false, chasing: false, ...NO_SCRIPTED_POSE,
    }, { stride: 0.5, armSwing: 0.6, knee: 0.9, elbow: 0.3, lean: 0.1, bounce: 0.06, breathe: 0.03 });
    this.body.position.y += TOON_FEET * (this.spot.role === "kid" ? 0.72 : 1);
    this.roleMotion(t, busy);
  }

  /** Each role's loop, layered on the idle pose. */
  private roleMotion(t: number, busy: number) {
    const j = this.joints;
    const k = busy;
    switch (this.spot.role) {
      case "sweeper":
        rot(j.armR, -0.6 + Math.sin(t * 3.2) * 0.45 * k, 0, 0.3);
        rot(j.armL, -0.7 + Math.sin(t * 3.2) * 0.35 * k, 0, -0.2);
        if (j.spine) j.spine.rotation.x = 0.25 * k;
        break;
      case "reader": {
        // Sat on the bench, turning the same page over and over.
        poseSeated(j, this.body, 1, t, 0.47);
        const flip = Math.max(0, Math.sin(t * 0.9)) ** 8;
        rot(j.armL, -1.1, 0, -0.25 + flip * 0.5 * k);
        rot(j.armR, -1.1, 0, 0.25);
        rx(j.foreL, -0.6);
        rx(j.foreR, -0.6);
        if (j.head) j.head.rotation.x = 0.25 * (1 - this.look);
        break;
      }
      case "kid": {
        const bounce = Math.abs(Math.sin(t * 3.4));
        rot(j.armR, -0.6 - (1 - bounce) * 0.5 * k, 0, 0.2);
        if (this.prop) this.prop.position.set(0.25, 0.13 + bounce * 0.75 * k, 0.35);
        break;
      }
      case "lady":
        rot(j.armL, -0.2, 0, -0.1);
        rot(j.armR, -0.25 + Math.sin(t * 0.7) * 0.05, 0, 0.1);
        break;
      case "waver":
        rot(j.armR, -2.6, 0, 0.35 + Math.sin(t * 7) * 0.45 * k);
        rx(j.foreR, -0.3);
        break;
      case "painter":
        rot(j.armR, -1.2 + Math.sin(t * 2.6) * 0.5 * k, 0, 0.15);
        rx(j.foreR, -0.5);
        break;
      case "dancer": {
        // The Charleston: knees in, arms out, the same eight counts.
        const c = Math.sin(t * 6.3);
        rot(j.legL, -0.25 * c * k, 0, 0);
        rot(j.legR, 0.25 * c * k, 0, 0);
        rx(j.shinL, 0.5 + 0.3 * c * k);
        rx(j.shinR, 0.5 - 0.3 * c * k);
        rot(j.armL, -0.6 + c * 0.7 * k, 0, -0.6);
        rot(j.armR, -0.6 - c * 0.7 * k, 0, 0.6);
        this.body.position.y += Math.abs(c) * 0.06 * k;
        break;
      }
      case "hatman": {
        // Tips his hat. Again. And again.
        const tip = Math.max(0, Math.sin(t * 1.4)) ** 3;
        rot(j.armR, -0.3 - tip * 2.2, 0, 0.15);
        rx(j.foreR, -0.4 - tip * 0.9);
        break;
      }
      default:
        break;
    }
  }
}
