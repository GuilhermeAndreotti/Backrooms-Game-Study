/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Anatomy kit for the mob builders: ribcages, vertebrae, clawed hands and
 * feet, skulls with sockets and teeth.
 *
 * Detail is the expensive part of a creature only when every rib and finger
 * is its own mesh. Here a body part is described as a list of primitives in
 * BODY space and `bake()` merges them into ONE geometry per (part, material),
 * cached class-wide by key like every other mob geometry: a ribcage of a
 * dozen bones is one draw call, shared by every instance of that mob.
 *
 * Baked parts are static relative to the joint they hang from; anything that
 * animates on its own (a jaw, a finger the rig curls) still gets a joint.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MobBuildCtx } from "./types";
import { roundedLimbGeometry } from "./creatureSkin";

type V3 = THREE.Vector3;
const UP = new THREE.Vector3(0, 1, 0);

/** Collects primitives (body space) to be merged into one geometry. */
export class Parts {
  readonly list: [THREE.BufferGeometry, THREE.Matrix4][] = [];

  /** Rounded tapered bone/muscle from a to b (radius at a; `taper` scales it at b). */
  limb(a: V3, b: V3, r: number, taper = 0.75, radial = 8): this {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(0.002, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    const m = new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1));
    this.list.push([roundedLimbGeometry(r, taper, len, radial), m]);
    return this;
  }

  /** A run of limbs through the points (a curved bone, a tendril). Radius eases from r0 to r1. */
  chain(points: V3[], r0: number, r1 = r0, radial = 7): this {
    for (let i = 0; i < points.length - 1; i++) {
      const ra = r0 + (r1 - r0) * (i / (points.length - 1));
      const rb = r0 + (r1 - r0) * ((i + 1) / (points.length - 1));
      this.limb(points[i], points[i + 1], ra, rb / ra, radial);
    }
    return this;
  }

  /** Ellipsoid blob (muscle, pad, pelvis, cranium). */
  blob(c: V3, r: number, scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0], seg: [number, number] = [14, 10]): this {
    const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    this.list.push([new THREE.SphereGeometry(r, seg[0], seg[1]), m]);
    return this;
  }

  /** Pointed cone from base to tip (claw, tooth, horn, spine). */
  spike(base: V3, tip: V3, r: number, radial = 6): this {
    const dir = new THREE.Vector3().subVectors(tip, base);
    const len = Math.max(0.002, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    const m = new THREE.Matrix4().compose(base.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1));
    this.list.push([new THREE.ConeGeometry(r, len, radial), m]);
    return this;
  }

  /** A flat plate from a to b (blade, fin, plate armour): `width` across, `thick` through. */
  blade(a: V3, b: V3, width: number, thick: number, roll = 0): this {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(0.002, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
    const m = new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1));
    // Tapered to an edge at b: a flattened four-sided cone.
    const geo = new THREE.CylinderGeometry(0.0005, width / 2, len, 4, 1).scale(1, 1, thick / width);
    this.list.push([geo, m]);
    return this;
  }

  /** Box (plates, buckles, blades). */
  box(c: V3, size: [number, number, number], rot: [number, number, number] = [0, 0, 0]): this {
    const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
    this.list.push([new THREE.BoxGeometry(...size), m]);
    return this;
  }

  /** A lathe profile [radius, y] around the vertical axis through `c`. */
  lathe(c: V3, profile: [number, number][], radial = 14, scale: [number, number, number] = [1, 1, 1]): this {
    const m = new THREE.Matrix4().compose(c, new THREE.Quaternion(), new THREE.Vector3(...scale));
    this.list.push([new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), radial), m]);
    return this;
  }

  /** Merges everything collected so far into one non-indexed geometry. */
  merge(): THREE.BufferGeometry {
    const baked = this.list.map(([geo, matrix]) => {
      const flat = geo.index ? geo.toNonIndexed() : geo;
      flat.applyMatrix4(matrix);
      if (flat !== geo) geo.dispose();
      return flat;
    });
    const merged = baked.length === 1 ? baked[0] : mergeGeometries(baked, false);
    if (baked.length > 1) baked.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    return merged;
  }
}

/**
 * Builds (once per key) and attaches one merged mesh to `joint`. The
 * primitives are described in body space, like every other ctx call.
 */
export function bake(ctx: MobBuildCtx, joint: THREE.Object3D, mat: THREE.Material, key: string, draw: (p: Parts) => void): THREE.Mesh {
  const geo = ctx.sgeo(`baked_${key}`, () => {
    const p = new Parts();
    draw(p);
    return p.merge();
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return ctx.put(joint, mesh);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface RibcageOpts {
  /** Centre of the chest. */
  c: V3;
  /** Half-width, half-depth and half-height of the cage. */
  w: number; d: number; h: number;
  ribs: number;
  /** Bone radius. */
  r: number;
}

/**
 * Pairs of ribs curving from the spine round the flanks to the sternum,
 * shortening towards the bottom, plus the sternum itself. Meant over a thin
 * core so the chest reads as gaunt rather than hollow.
 */
export function ribcage(p: Parts, o: RibcageOpts): Parts {
  const { c, w, d, h, ribs, r } = o;
  for (let i = 0; i < ribs; i++) {
    const t = ribs === 1 ? 0.5 : i / (ribs - 1);
    const y = c.y + h - t * 2 * h;
    const span = 1 - Math.pow(t - 0.35, 2) * 0.9; // widest a third of the way down
    const drop = 0.05 + t * 0.04; // ribs slope down towards the front
    const reach = t > 0.75 ? 0.55 : 0.95; // floating ribs stop short of the sternum
    for (const s of [-1, 1]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 4; k++) {
        const a = (k / 4) * Math.PI * reach; // 0 at the spine, PI at the sternum
        pts.push(v(c.x + s * Math.sin(a) * w * span, y - (k / 4) * drop, c.z - Math.cos(a) * d));
      }
      p.chain(pts, r, r * 0.8, 6);
    }
  }
  p.limb(v(c.x, c.y + h * 0.95, c.z + d * 0.98), v(c.x, c.y - h * 0.55, c.z + d * 0.95), r * 1.3, 0.8);
  return p;
}

/** Knobbly vertebrae along a back line from a to b. */
export function vertebrae(p: Parts, a: V3, b: V3, count: number, r: number, spines = 0): Parts {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const c = a.clone().lerp(b, t);
    p.blob(c, r, [1.1, 0.75, 1], [0, 0, 0], [8, 6]);
    if (spines > 0) p.spike(c, c.clone().add(v(0, spines * 0.4, -spines)), r * 0.55, 5);
  }
  return p;
}

export interface HandOpts {
  wrist: V3;
  /** Unit-ish direction the fingers point (down and forward for a hanging arm). */
  dir: V3;
  /** Direction across the knuckles (thumb side to little finger). */
  across: V3;
  fingers: number;
  /** Finger length (two segments). */
  len: number;
  /** Finger radius at the knuckle. */
  r: number;
  /** Curl of the second segment toward the palm (0 straight). */
  curl?: number;
  palm?: number;
}

/** `across` made perpendicular to `dir` (so the palm's basis is orthonormal). */
function orthoAcross(dir: V3, across: V3): V3 {
  const a = across.clone().addScaledVector(dir, -across.dot(dir));
  return a.lengthSq() > 1e-6 ? a.normalize() : new THREE.Vector3(1, 0, 0);
}

/** Palm and fingers (bones only) for a hand. Claws: see handClaws. */
export function hand(p: Parts, o: HandOpts): Parts {
  const dir = o.dir.clone().normalize();
  const across = orthoAcross(dir, o.across);
  const palmLen = o.palm ?? o.len * 0.45;
  const palmC = o.wrist.clone().addScaledVector(dir, palmLen * 0.5);
  const palmUp = new THREE.Vector3().crossVectors(across, dir).normalize();
  // Palm: a flattened blob along the hand's own axes.
  const basis = new THREE.Matrix4().makeBasis(across, dir, palmUp);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const pm = new THREE.Matrix4().compose(palmC, q, new THREE.Vector3(o.fingers * o.r * 1.4, palmLen * 0.6, o.r * 1.4));
  p.list.push([new THREE.SphereGeometry(1, 10, 8), pm]);
  const curl = o.curl ?? 0.5;
  for (let f = 0; f < o.fingers; f++) {
    const spread = (f - (o.fingers - 1) / 2) * o.r * 2.3;
    const splay = across.clone().multiplyScalar(spread * 0.6);
    const knuckle = o.wrist.clone().addScaledVector(dir, palmLen).addScaledVector(across, spread);
    const lenF = o.len * (f === 0 || f === o.fingers - 1 ? 0.8 : 1);
    const mid = knuckle.clone().addScaledVector(dir, lenF * 0.5).add(splay);
    const bent = dir.clone().addScaledVector(palmUp, -curl).normalize();
    const tip = mid.clone().addScaledVector(bent, lenF * 0.5);
    p.limb(knuckle, mid, o.r, 0.85, 6);
    p.limb(mid, tip, o.r * 0.85, 0.6, 6);
  }
  return p;
}

/** The claw at the end of each finger hand() made (same options). */
export function handClaws(p: Parts, o: HandOpts, clawLen: number): Parts {
  const dir = o.dir.clone().normalize();
  const across = orthoAcross(dir, o.across);
  const palmLen = o.palm ?? o.len * 0.45;
  const palmUp = new THREE.Vector3().crossVectors(across, dir).normalize();
  const curl = o.curl ?? 0.5;
  for (let f = 0; f < o.fingers; f++) {
    const spread = (f - (o.fingers - 1) / 2) * o.r * 2.3;
    const splay = across.clone().multiplyScalar(spread * 0.6);
    const lenF = o.len * (f === 0 || f === o.fingers - 1 ? 0.8 : 1);
    const knuckle = o.wrist.clone().addScaledVector(dir, palmLen).addScaledVector(across, spread);
    const mid = knuckle.clone().addScaledVector(dir, lenF * 0.5).add(splay);
    const bent = dir.clone().addScaledVector(palmUp, -curl).normalize();
    const tip = mid.clone().addScaledVector(bent, lenF * 0.5);
    const hook = bent.clone().addScaledVector(palmUp, -0.6).normalize();
    p.spike(tip, tip.clone().addScaledVector(hook, clawLen), o.r * 0.6, 5);
  }
  return p;
}

/** A row of teeth along an arc (upper row points down, lower up). */
export function teeth(p: Parts, c: V3, halfWidth: number, depth: number, count: number, len: number, up: boolean, r = 0.008): Parts {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1..1 across the mouth
    const base = v(c.x + t * halfWidth, c.y, c.z - t * t * depth);
    const l = len * (0.75 + 0.5 * (1 - Math.abs(t))) * (i % 3 === 1 ? 1.35 : 1); // a fang every third
    p.spike(base, base.clone().add(v(0, up ? l : -l, 0.004)), r, 4);
  }
  return p;
}
