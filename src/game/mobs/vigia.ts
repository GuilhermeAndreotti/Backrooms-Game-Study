/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O VIGIA: an enormous creature with extremely long limbs, the Poolrooms'
 * keeper. One lives in each of the level's three parts. Its behaviour there —
 * patrolling, listening, chasing, losing you and searching, stalking the foot
 * of whatever you climbed, shadowing a diver along the edge — is its own
 * state machine, mobs/vigiaBrain.ts, which WanderingEntity runs instead of
 * sense() below. This file is its body: build, animation and the poses the
 * brain streams to every client (MobSenseResult.pose):
 *
 *   0 calm · 1 listening (head cocked) · 2 hunting (the grab cycle) ·
 *   3 reaching up at someone out of its reach; +4 once Part 1's valve puzzle
 *   has "transformed" it (the second pair of arms unfolds).
 *
 * sense() remains only as a fallback for a Vigia outside the Poolrooms.
 */

import * as THREE from "three";
import { sculptedHead } from "./sculpt";
import { bake, teeth } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped, rot } from "./anim";

/** Fallback sense() (outside the Poolrooms): how far it notices someone. */
const INITIAL_VISION_RANGE = 24;
const INTELLECT_VISION_GAIN = 14;
/** Fast enough to follow a walking explorer, but sprinting can still create space. */
const INITIAL_CHASE_SPEED = 2.25;
const INTELLECT_SPEED_GAIN = 0.75;
/** Idle movement is still slow when the player leaves its vision range. */
const STILL_SPEED = 0.15;

export const vigia: MobDefinition = {
  type: EntityType.VIGIA,
  baseSpeed: STILL_SPEED,
  baseHeight: 1.65,
  strideLength: 0.9,
  stepWeight: 1,
  // On its rounds it looks where it walks; once it's onto someone it turns to them.
  calmIgnoresViewer: true,
  // Long arms: it grabs from a little further than most (its height reach is VIGIA_REACH_UP).
  catchRadius: 1.7,
  bobFreq: 0.6, bobAmp: 0.03, // almost imperceptible — reads as "immobile"
  speechBubbleLocalY: 1.1,
  forcedChaseSpeed: 2.2, // even under forced-chase rules, stays slower than the rest of the roster

  build(ctx) {
    const V = ctx.V;
    const mat = ctx.smat("vigia_body", () => new THREE.MeshStandardMaterial({ color: 0x151b20, roughness: 0.72, metalness: 0.12 }));

    // Massive, squat torso — an immovable landmark: a hunched slab of muscle
    // with a hump between the shoulders, a heavy gut sagging over the hips
    // and folds of hide where it bends.
    const spine = ctx.joint("spine", 0, -0.35, 0);
    bake(ctx, spine, mat, "vigia_trunk", (p) => {
      p.lathe(V(0, 0.1, 0), [[0.3, -0.45], [0.42, -0.36], [0.44, -0.15], [0.4, 0.1], [0.42, 0.3], [0.32, 0.43], [0.14, 0.48]], 16, [1, 1, 0.85]);
      p.blob(V(0, 0.42, -0.12), 0.28, [1.15, 0.75, 0.9]); // hump
      for (const s of [-1, 1]) p.blob(V(s * 0.3, 0.42, 0), 0.15, [1, 0.85, 1]);
      p.blob(V(0, -0.14, 0.14), 0.3, [1.1, 0.8, 0.85]); // gut
      for (let i = 0; i < 3; i++) p.lathe(V(0, -0.02 + i * 0.07, 0.02), [[0.43, -0.012], [0.445, 0], [0.43, 0.012]], 16, [1, 1, 0.86]);
      p.limb(V(0, 0.45, 0.02), V(0, 0.6, 0.08), 0.13, 0.9); // a short, thick neck
    });

    // A broad, flat skull pushed forward on the neck: heavy brow, cheek
    // ridges, and a wide lipless mouth of uneven teeth.
    const head = ctx.joint("head", 0, 0.55, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("vigia_head", () => sculptedHead(0.22)), mat);
    skull.position.set(0, 0.75, 0);
    skull.scale.set(1.15, 0.85, 1);
    ctx.put(head, skull);
    bake(ctx, head, mat, "vigia_face", (p) => {
      p.limb(V(-0.16, 0.82, 0.17), V(0.16, 0.82, 0.17), 0.04, 1);
      for (const s of [-1, 1]) p.blob(V(s * 0.15, 0.69, 0.14), 0.06, [1, 0.6, 0.8]);
      p.blob(V(0, 0.62, 0.12), 0.12, [1.3, 0.55, 0.8]); // jaw
    });
    const vigiaBone = ctx.smat("vigia_teeth", () => new THREE.MeshStandardMaterial({ color: 0xa79d84, roughness: 0.5 }));
    bake(ctx, head, vigiaBone, "vigia_teeth", (p) => {
      teeth(p, V(0, 0.665, 0.215), 0.11, 0.07, 11, 0.035, false, 0.011);
      teeth(p, V(0, 0.625, 0.205), 0.1, 0.07, 10, 0.03, true, 0.011);
    });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x5ee9dc, emissive: 0x0b5958, emissiveIntensity: 1.1, roughness: 0.25 });
    eyeMat.name = "vigia_eye";
    ctx.addTintMaterial(eyeMat);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(ctx.sgeo("vigia_eye", () => new THREE.SphereGeometry(0.055, 8, 6)), eyeMat);
      eye.position.set(side * 0.09, 0.76, 0.2);
      ctx.put(head, eye);
    }

    // Extremely long limbs fold toward the front of its body. Each ends in a
    // three-jointed hand rather than a blunt tip, so the threat reads as an
    // attempt to seize the explorer instead of a wide static silhouette.
    const limbMat = ctx.smat("vigia_limb", () => new THREE.MeshStandardMaterial({ color: 0x100f14, roughness: 0.9 }));
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const zs = side < 0 ? 1 : -1;
      const shoulder = V(side * 0.3, 0.4, 0);
      const elbow = V(side * 1.2, 0.35, 0.12 * zs);
      const wrist = V(side * 2.0, 0.05, 0.22 * zs);
      const hand = V(side * 3.15, -0.2, 0.34 * zs);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, limbMat, shoulder, elbow, 0.05, 0.8);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, limbMat, elbow, wrist, 0.04, 0.75);
      const claw = ctx.joint(`hand${n}`, wrist.x, wrist.y, wrist.z, fore);
      ctx.limbIn(claw, limbMat, wrist, hand, 0.03, 0.5);
      for (let finger = 0; finger < 4; finger++) {
        const spread = (finger - 1.5) * 0.11;
        const base = V(hand.x + side * 0.03, hand.y + 0.02, hand.z + spread);
        const knuckle = V(hand.x + side * 0.18, hand.y - 0.18 - Math.abs(spread) * 0.3, hand.z + spread * 1.25);
        const joint = V(hand.x + side * 0.28, hand.y - 0.4, hand.z + spread * 1.45);
        const tip = V(hand.x + side * 0.2, hand.y - 0.65, hand.z + spread * 1.6);
        const a = ctx.joint(`finger${n}${finger}a`, base.x, base.y, base.z, claw);
        ctx.limbIn(a, limbMat, base, knuckle, 0.022, 0.78);
        const b = ctx.joint(`finger${n}${finger}b`, knuckle.x, knuckle.y, knuckle.z, a);
        ctx.limbIn(b, limbMat, knuckle, joint, 0.018, 0.72);
        const c = ctx.joint(`finger${n}${finger}c`, joint.x, joint.y, joint.z, b);
        ctx.limbIn(c, limbMat, joint, tip, 0.013, 0.55);
      }
    }
    // The second pair remains folded into its back until the Vigia transforms.
    // They are built up front so the transformation is replica-safe: pose 3 is
    // already part of the streamed entity state.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.24, 0.2, -0.18);
      const elbow = V(side * 0.95, -0.08, -0.38);
      const wrist = V(side * 1.7, -0.42, -0.6);
      const tip = V(side * 2.15, -0.62, -0.82);
      const arm = ctx.joint(`extraArm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      arm.visible = false;
      arm.userData.visualSwitch = true;
      ctx.limbIn(arm, limbMat, shoulder, elbow, 0.045, 0.8);
      const fore = ctx.joint(`extraFore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, limbMat, elbow, wrist, 0.035, 0.7);
      const hand = ctx.joint(`extraHand${n}`, wrist.x, wrist.y, wrist.z, fore);
      ctx.limbIn(hand, limbMat, wrist, tip, 0.025, 0.5);
    }
    // Short, stout legs — it doesn't need to move fast, it's already
    // everywhere it needs to be — on broad, short-toed feet.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = ctx.joint(`leg${n}`, side * 0.17, -0.35, 0);
      ctx.limbIn(leg, mat, V(side * 0.17, -0.35, 0), V(side * 0.19, -0.87, 0.03), 0.16, 0.8);
      const shin = ctx.joint(`shin${n}`, side * 0.19, -0.87, 0.03, leg);
      bake(ctx, shin, mat, `vigia_shin_${side}`, (p) => {
        p.limb(V(side * 0.19, -0.87, 0.03), V(side * 0.2, -1.3, 0), 0.12, 0.85);
        p.blob(V(side * 0.21, -1.36, 0.08), 0.11, [1.1, 0.45, 1.5]);
        for (const t of [-1, 0, 1]) p.blob(V(side * 0.21 + t * 0.06, -1.37, 0.23), 0.035, [1, 0.7, 1.3]);
      });
    }
  },

  animate(ctx) {
    // Barely moves its body; the long limbs creep along the walls instead,
    // each segment flexing out of step, and its head never leaves you.
    animateBiped(ctx, { stride: 0.2, armSwing: 0, knee: 0.4, elbow: 0, lean: 0.05, bounce: 0.02, breathe: 0.015, headReach: 1.3 });
    const j = ctx.joints;
    const { time, move, observe, pose, chasing } = ctx;
    const transformed = pose >= 4;
    const mood = pose & 3;
    // Listening: the head cocks to one side and holds there.
    if (mood === 1 && j.head) j.head.rotation.z += 0.28 + Math.sin(time * 0.6) * 0.05;
    const intelligenceReach = (mood === 3 ? 1.2 : mood === 2 ? 1 : mood === 1 ? 0.3 : 0) + (transformed ? 0.3 : 0);
    // Reaching up the side of a block at someone it can't get to: both arms raised, fingers working.
    const lift = mood === 3 ? 0.75 + Math.sin(time * 1.4) * 0.12 : 0;
    // A slow, asymmetric grab cycle. It only fully extends after the Vigia
    // has learned enough from the valves, making the escalation readable.
    const grabCycle = chasing || mood === 3 ? Math.max(0, Math.sin(time * (1.7 + intelligenceReach * 0.8))) : 0;
    const reach = intelligenceReach * (0.45 + grabCycle * 0.55);
    for (const [n, s] of [["L", 1], ["R", -1]] as const) {
      const creep = Math.sin(time * 0.9 + (s > 0 ? 0 : 2.4));
      const armReach = reach * (s > 0 ? 1 : 0.78); // one arm always leads the grab
      // Rotating opposite shoulders inward swings their long X-axis limbs to
      // +Z, directly in front of the torso. The forearms then fold together
      // like a closing trap instead of remaining spread across the corridor.
      const forwardFold = 0.58 + armReach * 0.38;
      rot(j[`arm${n}`], creep * 0.06 - armReach * 0.28 - lift * 0.4, s * (forwardFold + creep * 0.06), -s * (0.12 + observe * 0.1 + armReach * 0.28 + lift));
      rot(j[`fore${n}`], -0.18 - armReach * 0.58, s * (0.28 + Math.sin(time * 1.3 + s) * 0.07), -s * (0.16 + armReach * 0.52));
      rot(j[`hand${n}`], 0.16 + armReach * 0.42, 0, -s * (0.28 + armReach * 0.4));
      for (let finger = 0; finger < 4; finger++) {
        const phase = time * (4.6 + finger * 0.23) + finger * 1.7 + s;
        const curl = 0.16 + armReach * 0.95 + Math.sin(phase) * (0.08 + armReach * 0.12);
        rot(j[`finger${n}${finger}a`], -curl * 0.35, 0, s * (finger - 1.5) * 0.06);
        rot(j[`finger${n}${finger}b`], -curl * 0.75, 0, 0);
        rot(j[`finger${n}${finger}c`], -curl * 0.65, 0, 0);
      }
      const extraArm = j[`extraArm${n}`];
      if (extraArm) extraArm.visible = transformed;
      if (transformed) {
        const lash = Math.sin(time * 3.4 + s * 1.8);
        rot(extraArm, -0.2 + lash * 0.22, s * (0.55 + lash * 0.18), -s * 0.48);
        rot(j[`extraFore${n}`], -0.45 - lash * 0.28, s * 0.18, -s * 0.42);
        rot(j[`extraHand${n}`], 0.3 + Math.sin(time * 6.8 + s) * 0.18, 0, -s * 0.32);
      }
    }
  },

  sense(ctx) {
    // Fallback only (see the file comment): a plain sight-range watcher.
    const intellect = ctx.map.poolVigiaIntellect;
    const transformed = intellect >= 0.64 || ctx.map.poolroomsSolved;
    const awareness = INITIAL_VISION_RANGE + intellect * INTELLECT_VISION_GAIN;
    if (ctx.distanceMeters < awareness) {
      return {
        chasing: true,
        speed: transformed ? 3.0 : INITIAL_CHASE_SPEED + intellect * INTELLECT_SPEED_GAIN,
        agitated: true,
        pose: 2 + (transformed ? 4 : 0),
      };
    }
    return { chasing: false, speed: STILL_SPEED + intellect * 0.25, agitated: false, pose: transformed ? 4 : 0 };
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#78716c", strokeColor: "#44403c", labelKey: "radar.vigia" },
};
