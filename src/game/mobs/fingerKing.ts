/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FINGER_KING: Level G's exclusive stalker. A gaunt office worker in a rotten
 * pinstripe suit on stilt legs, lopsided shoulders, arms that end in hands of
 * long three-jointed fingers dragging on the carpet, a crown of upright
 * fingers (one still wearing its wedding ring) and a face that is mostly
 * holes — its "teeth" are two rows of fingertips.
 *
 * Senses further and moves faster the longer the level's aggression ramp
 * runs (see GameEngine's levelGAggression), and never chases past a
 * sprinting explorer's own top speed — the final chase is a race you can
 * win, not a death sentence.
 *
 * When an explorer looks straight at it from close by it STARES back (stops
 * dead, head tilting sideways, a hand spread over its face), then BREAKS —
 * every joint cracking in turn — and comes for them. The stare is a scripted
 * pose streamed to every client (EntityNetState.k) and doubles as a fair
 * warning window before the chase.
 *
 * Its BFS-seeking pathing (chooseFingerKingStep/fingerCanEnter's closet gate)
 * stays hardcoded in WanderingEntity.ts, by design — it's deeply tied to
 * Level G's bespoke hide/ambush system and not worth generalizing into the
 * shared mob-behavior contract for a level-exclusive boss.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobAnimCtx, MobBuildCtx, MobDefinition } from "./types";
import { rot, rx } from "./anim";
import { kingBadgeTexture, kingNailTexture, kingSkinTexture, kingSuitTexture } from "./fingerKingTextures";

/** Scripted poses (MobSenseResult.pose / EntityNetState.k). */
export const KING_POSE_STARE = 1;
export const KING_POSE_BREAK = 2;

/** Seconds it stares, then convulses, before it comes for you; then how long until it can stare again. */
const STARE_S = 1.5;
const BREAK_S = 0.85;
const STARE_COOLDOWN_S = 14;

/** Deterministic 0..1 hash (visual tics only). */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A joint "crack": 0 until `at`, then a sharp spike that decays. */
function crack(t: number, at: number): number {
  return t < at ? 0 : Math.exp(-(t - at) * 9);
}

/**
 * ctx.limbIn, but centred between `a` and `b` for any length. The shared
 * limbBetween puts a limb's centre 0.5 m from `a` (exact only for 1 m limbs,
 * close enough for the other mobs' long limbs), which scatters the King's
 * short finger segments, teeth and neck, so this nudges the result back.
 */
function limb(ctx: MobBuildCtx, joint: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, taper?: number) {
  const m = ctx.limbIn(joint, mat, a, b, radius, taper);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len > 1e-4) m.position.addScaledVector(dir.divideScalar(len), len / 2 - 0.5);
  // ~80 thin finger/teeth/crown segments: their shadows are invisible but cost a draw each.
  if (radius < 0.02) m.castShadow = false;
  return m;
}

export const fingerKing: MobDefinition = {
  type: EntityType.FINGER_KING,
  baseSpeed: 1.0,
  baseHeight: 1.4,
  strideLength: 1.7,
  stepWeight: 0.6,
  bobFreq: 3.8, bobAmp: 0.02,
  speechBubbleLocalY: 1.2,
  // Never actually reached (Finger King only ever appears on Level G, never
  // on the forced-chase levels) — kept for interface completeness.
  forcedChaseSpeed: 3.2,

  build(ctx) {
    const V = ctx.V;
    const suitMat = ctx.smat("king2_suit", () => new THREE.MeshStandardMaterial({ map: kingSuitTexture(), roughness: 0.88 }));
    const skinMat = ctx.smat("king2_skin", () => new THREE.MeshStandardMaterial({ map: kingSkinTexture(), roughness: 0.42, metalness: 0.02 }));
    const nailMat = ctx.smat("king2_nail", () => new THREE.MeshStandardMaterial({ map: kingNailTexture(), roughness: 0.35 }));
    const knuckleMat = ctx.smat("king2_knuckle", () => new THREE.MeshStandardMaterial({ map: kingSkinTexture(), color: 0xb09a8c, roughness: 0.5 }));
    const holeMat = ctx.smat("king2_hole", () => new THREE.MeshStandardMaterial({ color: 0x030101, roughness: 1 }));
    const mouthMat = ctx.smat("king2_mouth", () => new THREE.MeshStandardMaterial({ color: 0x2a0303, emissive: 0x1a0000, roughness: 0.3 }));
    const shirtMat = ctx.smat("king2_shirt", () => new THREE.MeshStandardMaterial({ color: 0xa8a08a, roughness: 0.9 }));
    const tieMat = ctx.smat("king2_tie", () => new THREE.MeshStandardMaterial({ map: kingSuitTexture(), color: 0xb02222, roughness: 0.6 }));
    const shoeMat = ctx.smat("king2_shoe", () => new THREE.MeshStandardMaterial({ color: 0x0c0b0b, roughness: 0.35 }));
    const ringMat = ctx.smat("king2_ring", () => new THREE.MeshStandardMaterial({ color: 0xc9a13b, metalness: 1, roughness: 0.3 }));
    const badgeMat = ctx.smat("king2_badge", () => new THREE.MeshStandardMaterial({ map: kingBadgeTexture(), roughness: 0.4, side: THREE.DoubleSide }));

    // --- Torso: narrow-waisted, flattened, shoulders at different heights
    const spine = ctx.joint("spine", 0, 0.04, 0);
    const torso = new THREE.Mesh(ctx.sgeo("king2_torso", () => new THREE.CylinderGeometry(0.2, 0.11, 0.7, 10)), suitMat);
    torso.position.set(0, 0.39, 0);
    torso.scale.set(1, 1, 0.7);
    ctx.put(spine, torso);
    const padGeo = ctx.sgeo("king2_pad", () => new THREE.SphereGeometry(0.075, 8, 6));
    for (const [x, y] of [[-0.17, 0.71], [0.17, 0.645]]) {
      const pad = new THREE.Mesh(padGeo, suitMat);
      pad.position.set(x, y, 0);
      pad.scale.set(1.2, 0.7, 0.9);
      ctx.put(spine, pad);
    }
    const collar = new THREE.Mesh(ctx.sgeo("king2_collar", () => new THREE.CylinderGeometry(0.05, 0.075, 0.07, 8)), shirtMat);
    collar.position.set(0, 0.76, 0);
    ctx.put(spine, collar);
    const tie = new THREE.Mesh(ctx.sgeo("king2_tie", () => new THREE.BoxGeometry(0.05, 0.46, 0.015)), tieMat);
    tie.position.set(0, 0.5, 0.125);
    tie.rotation.x = -0.1;
    tie.rotation.z = 0.06;
    ctx.put(spine, tie);
    const badge = new THREE.Mesh(ctx.sgeo("king2_badge", () => new THREE.PlaneGeometry(0.075, 0.1)), badgeMat);
    badge.position.set(-0.095, 0.5, 0.128);
    badge.rotation.set(-0.12, 0.1, 0.18);
    ctx.put(spine, badge);

    // --- Stilt legs and dress shoes
    const shoeGeo = ctx.sgeo("king2_shoe", () => new THREE.BoxGeometry(0.085, 0.06, 0.22));
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = ctx.joint(`leg${n}`, side * 0.07, 0.04, 0);
      limb(ctx, leg, suitMat, V(side * 0.07, 0.04, 0), V(side * 0.08, -0.68, 0.03), 0.055);
      const shin = ctx.joint(`shin${n}`, side * 0.08, -0.68, 0.03, leg);
      limb(ctx, shin, suitMat, V(side * 0.08, -0.68, 0.03), V(side * 0.085, -1.33, 0), 0.045);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.position.set(side * 0.085, -1.37, 0.05);
      ctx.put(shin, shoe);
    }

    // --- Arms: far too long, ending in three-jointed fingers that drag on the floor
    const knuckleGeo = ctx.sgeo("king2_knuckle", () => new THREE.SphereGeometry(0.016, 6, 5));
    const nailGeo = ctx.sgeo("king2_nailgeo", () => new THREE.SphereGeometry(0.013, 6, 5));
    const palmGeo = ctx.sgeo("king2_palm", () => new THREE.BoxGeometry(0.075, 0.11, 0.03));
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.19, side < 0 ? 0.72 : 0.655, 0);
      const elbow = V(side * 0.3, 0.24, 0.04);
      const wrist = V(side * 0.4, -0.28, 0.07);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      limb(ctx, arm, suitMat, shoulder, elbow, 0.045);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      limb(ctx, fore, suitMat, elbow, wrist, 0.038);
      const hand = ctx.joint(`hand${n}`, wrist.x, wrist.y, wrist.z, fore);
      const palm = new THREE.Mesh(palmGeo, skinMat);
      palm.position.set(wrist.x, wrist.y - 0.055, wrist.z);
      ctx.put(hand, palm);
      for (let f = 0; f < 5; f++) {
        const base = V(wrist.x + side * f * 0.008, wrist.y - 0.1, wrist.z + (f - 2) * 0.02);
        const reach = f === 0 ? 0.62 : 1; // the thumb is merely too long
        const tip = V(
          wrist.x + side * (0.06 + f * 0.022) * reach,
          wrist.y - 0.1 - (1.0 - Math.abs(f - 2) * 0.06) * reach,
          wrist.z + (f - 2) * 0.05,
        );
        const k1 = base.clone().lerp(tip, 0.42);
        const k2 = base.clone().lerp(tip, 0.74);
        const a = ctx.joint(`fing${n}${f}a`, base.x, base.y, base.z, hand);
        limb(ctx, a, skinMat, base, k1, 0.012, 0.85);
        const b = ctx.joint(`fing${n}${f}b`, k1.x, k1.y, k1.z, a);
        limb(ctx, b, skinMat, k1, k2, 0.011, 0.85);
        const c = ctx.joint(`fing${n}${f}c`, k2.x, k2.y, k2.z, b);
        limb(ctx, c, skinMat, k2, tip, 0.0095, 0.7);
        for (const [joint, at] of [[a, k1], [b, k2]] as const) {
          const k = new THREE.Mesh(knuckleGeo, knuckleMat);
          k.position.copy(at);
          ctx.put(joint, k);
        }
        const nail = new THREE.Mesh(nailGeo, nailMat);
        nail.position.copy(tip);
        nail.scale.set(0.8, 1.6, 0.6);
        ctx.put(c, nail);
      }
    }

    // --- Long neck, a stretched skull that is mostly holes
    const neck = ctx.joint("neck", 0, 0.76, 0, spine);
    limb(ctx, neck, skinMat, V(0, 0.76, 0), V(0, 0.98, 0.02), 0.034, 0.8);
    const head = ctx.joint("head", 0, 0.98, 0.02, neck);
    const skull = new THREE.Mesh(ctx.sgeo("king2_skull", () => new THREE.SphereGeometry(0.15, 16, 14)), skinMat);
    skull.position.set(0, 1.1, 0.02);
    skull.scale.set(0.8, 1.3, 0.9);
    ctx.put(head, skull);
    ctx.joint("face", 0, 1.1, 0.14, head);

    const socketGeo = ctx.sgeo("king2_socket", () => new THREE.SphereGeometry(0.038, 10, 8));
    const eyeGeo = ctx.sgeo("king2_eye", () => new THREE.SphereGeometry(0.0075, 6, 5));
    // Per-instance: its glow is driven every frame by animate() (face.userData.eyeMat).
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff1a0a, emissiveIntensity: 0.2 });
    ctx.addTintMaterial(eyeMat);
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(socketGeo, holeMat);
      socket.position.set(side * 0.048, 1.13, 0.13);
      socket.scale.set(1, 1.25, 0.45);
      ctx.put(head, socket);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.048, 1.125, 0.149);
      ctx.put(head, eye);
    }
    ctx.joints.face.userData.eyeMat = eyeMat;
    ctx.setKingEyeMaterial(eyeMat);

    // Mouth: a dark wet cavity behind two rows of fingertip "teeth"; the lower row opens.
    const cavity = new THREE.Mesh(ctx.sgeo("king2_cavity", () => new THREE.SphereGeometry(0.05, 10, 8)), mouthMat);
    cavity.position.set(0, 1.0, 0.118);
    cavity.scale.set(1.15, 0.6, 0.35);
    ctx.put(head, cavity);
    const jaw = ctx.joint("jaw", 0, 1.03, 0.1, head);
    for (let i = 0; i < 6; i++) {
      const x = (i - 2.5) * 0.017;
      const zc = 0.136 - Math.abs(i - 2.5) * 0.004;
      limb(ctx, head, skinMat, V(x, 1.04, zc), V(x, 1.004, zc + 0.004), 0.0065, 0.8);
      const upperNail = new THREE.Mesh(nailGeo, nailMat);
      upperNail.position.set(x, 1.004, zc + 0.004);
      upperNail.scale.setScalar(0.55);
      ctx.put(head, upperNail);
      limb(ctx, jaw, skinMat, V(x, 0.962, zc - 0.002), V(x, 0.996, zc + 0.004), 0.0065, 0.8);
      const lowerNail = new THREE.Mesh(nailGeo, nailMat);
      lowerNail.position.set(x, 0.996, zc + 0.004);
      lowerNail.scale.setScalar(0.55);
      ctx.put(jaw, lowerNail);
    }

    // --- Crown: seven upright two-jointed fingers; the middle one still wears a ring
    for (let f = 0; f < 7; f++) {
      const off = (f - 3) / 3; // -1..1
      const base = V(off * 0.095, 1.25 - Math.abs(off) * 0.035, 0.01);
      const mid = V(off * 0.115, 1.34 - Math.abs(off) * 0.05, 0);
      const tip = V(off * 0.135, 1.43 - Math.abs(off) * 0.08, 0.01);
      const crown = ctx.joint(`crown${f}`, base.x, base.y, base.z, head);
      limb(ctx, crown, skinMat, base, mid, 0.012, 0.85);
      const k = new THREE.Mesh(knuckleGeo, knuckleMat);
      k.position.copy(mid);
      k.scale.setScalar(0.8);
      ctx.put(crown, k);
      const crownTip = ctx.joint(`crownTip${f}`, mid.x, mid.y, mid.z, crown);
      limb(ctx, crownTip, skinMat, mid, tip, 0.01, 0.7);
      const nail = new THREE.Mesh(nailGeo, nailMat);
      nail.position.copy(tip);
      nail.scale.set(0.7, 1.4, 0.6);
      ctx.put(crownTip, nail);
      if (f === 3) {
        const ring = new THREE.Mesh(ctx.sgeo("king2_ring", () => new THREE.TorusGeometry(0.014, 0.004, 6, 12)), ringMat);
        ring.position.copy(base.clone().lerp(mid, 0.45));
        ring.rotation.x = Math.PI / 2;
        ctx.put(crown, ring);
      }
    }
  },

  animate(ctx) {
    animateKing(ctx);
  },

  // Senses further and moves faster the longer you stay on Level G. Never
  // out-runs a sprinting explorer (4.2 m/s): the final chase is a race you
  // can win, not a death sentence.
  //
  // `scratch` runs the stare: > 0 counts down the stare+break sequence,
  // < 0 counts the cooldown back up to 0 (ready to stare again).
  sense(ctx) {
    const senseRadius = 7 + 11 * ctx.aggression;
    let scratch = ctx.scratch;

    if (scratch > 0) {
      scratch -= ctx.delta;
      if (scratch > 0) {
        return { chasing: false, speed: 0, scratch, pose: scratch > BREAK_S ? KING_POSE_STARE : KING_POSE_BREAK };
      }
      scratch = -STARE_COOLDOWN_S;
    } else if (scratch < 0) {
      scratch = Math.min(0, scratch + ctx.delta);
    }

    if (ctx.hunting) {
      return { chasing: true, speed: 3.7, scratch };
    }
    if (ctx.targetHidden && ctx.distanceMeters > 2.2) {
      return { chasing: false, speed: 1.0 + 0.8 * ctx.aggression, scratch };
    }

    // Caught looking at it, close: it stares back.
    if (scratch === 0 && ctx.cameraDir && ctx.distanceMeters > 2.6 && ctx.distanceMeters < 10) {
      const dx = ctx.entityPos.x - ctx.playerX;
      const dz = ctx.entityPos.z - ctx.playerZ;
      const flat = Math.hypot(ctx.cameraDir.x, ctx.cameraDir.z) || 1;
      const dot = (ctx.cameraDir.x * dx + ctx.cameraDir.z * dz) / (flat * ctx.distanceMeters);
      if (dot > 0.85) {
        return { chasing: false, speed: 0, scratch: STARE_S + BREAK_S, pose: KING_POSE_STARE };
      }
    }

    // Right after a stare it has your scent: it chases from further away.
    const justStared = scratch < -(STARE_COOLDOWN_S - 3);
    if (ctx.distanceMeters < senseRadius + (justStared ? 6 : 0)) {
      return { chasing: true, speed: 1.9 + 1.5 * ctx.aggression, scratch };
    }
    return { chasing: false, speed: 1.0 + 0.8 * ctx.aggression, scratch };
  },

  speech() {
    // Silent — the taps, cracks and breathing (GameEngine/AudioManager) carry it.
    return { key: "" };
  },

  // Deliberately absent from the radar (Level G's design: "you don't get
  // warnings" — you have to listen for the finger taps instead). RadarHUD
  // keeps its own hardcoded skip for FINGER_KING; this key is unused.
  radar: { color: "#000000", strokeColor: "#000000", labelKey: "radar.anomaly" },
};

/**
 * The whole performance, every joint set absolutely each frame:
 * - stalking: stiff, hitching stride that lingers at the top of each step,
 *   the torso gliding too smoothly, a knee buckling sideways now and then,
 *   fingers dragging behind on the carpet;
 * - still: dead still but for the head, which snaps to new angles with no
 *   easing, and fingers crawling in place like legs;
 * - watching/staring: head tipped sideways, a hand of fingers spread over
 *   the face, crown fingers splaying open;
 * - breaking (stare end / chase start): joints crack one after another from
 *   the head down, the head thrown back;
 * - hunting: hunched low, arms trailing, head trembling, crown spasming;
 * - grab: arms shoot out further than they should, fingers fanned, jaw wide.
 */
function animateKing(ctx: MobAnimCtx) {
  const j = ctx.joints;
  const { time, move, run, observe, phase, look, seed } = ctx;
  const hunt = ctx.chasing ? 1 : 0;
  const huntRun = run * move;
  const stare = ctx.pose === KING_POSE_STARE ? Math.min(1, ctx.poseTime * 1.5) : ctx.pose === KING_POSE_BREAK ? 1 : 0;
  const grab = ctx.grab;
  const peek = Math.max(observe * 0.8, stare) * (1 - grab);

  // Break sequence: the replicated break pose, or a quick one when a chase starts on its own.
  const breakT = ctx.pose === KING_POSE_BREAK ? ctx.poseTime : ctx.chasing ? ctx.alertTime * 1.3 : 99;
  const breaking = breakT < 1.0 ? 1 : 0;

  // --- Legs: hitching stride (lingers at the top of every step)
  const gait = move * (1 + run * 0.6);
  const hp = phase + 0.45 * Math.sin(phase);
  const sin = Math.sin(hp);
  const cos = Math.cos(hp);
  const stride = 0.42 * gait;
  const step = Math.floor(phase / Math.PI);
  const stepFrac = phase / Math.PI - step;
  const buckle = hash(step + seed * 7) < 0.14 ? Math.sin(stepFrac * Math.PI) * 0.55 * move : 0;
  const leftBuckles = (step & 1) === 0;
  rx(j.legL, -sin * stride);
  rx(j.legR, sin * stride);
  rot(j.shinL, Math.max(0, cos) * gait, 0, leftBuckles ? -buckle : 0);
  rot(j.shinR, Math.max(0, -cos) * gait, 0, leftBuckles ? 0 : buckle);

  // --- Torso: rigid glide; a hunch when hunting
  const lean = 0.1 * move + 0.5 * huntRun + stare * 0.1;
  const breathe = Math.sin(time * 0.9) * 0.015 * (1 - move) * (1 - stare);
  rot(j.spine, lean + breathe + 0.5 * crack(breakT, 0.22), Math.sin(hp) * 0.05 * gait, 0.3 * crack(breakT, 0.33) - 0.04);
  ctx.body.position.y = Math.abs(sin) * 0.02 * gait;
  ctx.body.rotation.z = Math.sin(phase) * 0.03 * gait;
  ctx.body.position.x = Math.sin(time * 37) * 0.007 * hunt + Math.sin(time * 61) * 0.02 * breaking;

  // --- Neck/head
  // Idle: snaps to a new angle every couple of seconds, no easing at all.
  const snapIdx = Math.floor(time / 2.3 + seed);
  const idle = (1 - look) * (1 - move);
  const snapYaw = (hash(snapIdx) - 0.5) * 2.4 * idle;
  const snapPitch = (hash(snapIdx + 0.5) - 0.6) * 0.5 * idle;
  const jitter = Math.sign(Math.sin(time * 29 + seed)) * 0.02 * (0.3 + hunt);
  const tremor = Math.sin(time * 41) * 0.06 * hunt;
  rot(j.neck, -lean * 0.6 - 0.5 * crack(breakT, 0.1), 0, -0.5 * crack(breakT, 0.11) + stare * 0.25);
  if (j.head) {
    j.head.rotation.y = ctx.lookYaw * look + snapYaw + jitter;
    j.head.rotation.x = -ctx.lookPitch * look + snapPitch - 0.3 * huntRun + tremor - 1.1 * crack(breakT, 0) - 0.2 * grab;
    j.head.rotation.z = stare * 1.2 + observe * (1 - stare) * 0.35 * Math.sin(time * 0.5) + 0.6 * crack(breakT, 0.11);
  }
  rx(j.jaw, 0.03 + stare * 0.12 * (0.5 + 0.5 * Math.sin(time * 1.3)) + hunt * 0.16 * (0.5 + 0.5 * Math.sin(time * 13)) + grab * 0.95);

  // --- Arms: hanging, dragged behind; the right hand rises over the face to peek
  const drag = 0.12 * move + 0.55 * huntRun;
  const swing = Math.sin(hp) * 0.08 * gait;
  for (const [n, side] of [["L", -1], ["R", 1]] as const) {
    const arm = j[`arm${n}`];
    const fore = j[`fore${n}`];
    const peekArm = n === "R" ? peek : 0;
    const armX = (drag + (n === "L" ? swing : -swing)) * (1 - peekArm) - 0.1 * peekArm;
    const reachX = armX * (1 - grab) - 1.45 * grab;
    const crackZ = n === "L" ? -0.9 * crack(breakT, 0.44) : 0.9 * crack(breakT, 0.55);
    rot(arm, reachX, 0, side * (0.05 + 0.1 * huntRun + 0.25 * grab) + 0.6 * side * peekArm + crackZ);
    rx(fore, (-0.15 - 2.35 * peekArm) * (1 - grab));
    const s = 1 + 0.45 * grab;
    if (arm) arm.scale.set(s, s, s);
    rx(j[`hand${n}`], 0.3 * move * (1 + run) * (1 - grab) - 0.2 * grab - 0.6 * peekArm);

    // Fingers: dragged while walking, crawling in place while still, fanned over the face / at you.
    const nOff = n === "L" ? 0 : 1.7;
    const fan = Math.max(peekArm, grab);
    for (let f = 0; f < 5; f++) {
      const w = time * 3.1 + f * 1.2 + nOff;
      const still = 1 - move;
      rot(j[`fing${n}${f}a`], 0.3 * move + 0.3 * huntRun + still * Math.sin(w) * 0.22 * (1 - fan) - 0.3 * grab, 0, side * (f - 2) * 0.14 * fan);
      rx(j[`fing${n}${f}b`], 0.2 * move + still * Math.max(0, Math.sin(w - 0.8)) * 0.5 * (1 - fan) - 0.25 * grab);
      rx(j[`fing${n}${f}c`], 0.15 * move + still * Math.max(0, Math.sin(w - 1.6)) * 0.5 * (1 - fan) - 0.2 * grab);
    }
  }

  // --- Crown: slow flex; splays open while staring; spasms while hunting
  const crownSpeed = hunt ? 11 : stare > 0 ? 0.8 : 2.2;
  for (let f = 0; f < 7; f++) {
    const off = (f - 3) / 3;
    const w = time * crownSpeed + f * 1.3;
    rot(j[`crown${f}`], Math.sin(w) * 0.1 * (1 - stare) - 0.2 * stare, 0, Math.sin(w * 0.7 + f) * 0.1 - off * 0.45 * Math.max(stare, grab));
    rx(j[`crownTip${f}`], Math.max(0, Math.sin(w - 0.9)) * (hunt ? 0.6 : 0.3) + stare * 0.3);
  }

  // --- Eyes: two pinpricks in the dark; they flare while it stares or hunts.
  const eyeMat = j.face?.userData.eyeMat as THREE.MeshStandardMaterial | undefined;
  if (eyeMat) {
    const flicker = 0.75 + 0.25 * Math.sin(time * 23 + seed);
    eyeMat.emissiveIntensity = 0.25 + stare * 2.6 * flicker + hunt * 1.6 * flicker + grab * 3;
  }
}
