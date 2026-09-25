/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O VIGIA: an enormous, near-stationary creature with extremely long limbs,
 * that treats a region of the map as its territory. Answers "qual rota devo
 * usar?" — it barely moves and is trivially outrun; the threat is
 * positional (its reach spans whatever corridor it's planted in), not
 * speed.
 *
 * Scope note: the design doc's real attack — closing/blocking corridors,
 * pulling the player off their route — needs the existing MovableProp/
 * obstacle-registration system plus a new server-validated message (the
 * same shape as the box_push relay), which is GameEngine/server
 * orchestration work, not something a MobDefinition's sense() can express
 * on its own (sense() only returns movement/state, no side-effect
 * messages). Deliberately left for the level that actually gives it a
 * corridor worth blocking. For now, proximity behaves like every other
 * mob (the engine's catch check is a flat per-frame distance test with no
 * per-type override yet) — a slow-advancing, always-avoidable landmark.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped, rot } from "./anim";

const TERRITORY_RADIUS = 14;
/** Barely creeps outside its territory — mostly a stationary landmark. */
const STILL_SPEED = 0.15;
/** Still very slow once "advancing" — overwhelmingly avoidable; the threat is where it stands, not how fast it moves. */
const ADVANCE_SPEED = 0.9;

export const vigia: MobDefinition = {
  type: EntityType.VIGIA,
  baseSpeed: STILL_SPEED,
  baseHeight: 1.65,
  strideLength: 0.9,
  stepWeight: 1,
  facesViewer: true,
  bobFreq: 0.6, bobAmp: 0.03, // almost imperceptible — reads as "immobile"
  speechBubbleLocalY: 1.1,
  forcedChaseSpeed: 2.2, // even under forced-chase rules, stays slower than the rest of the roster

  build(ctx) {
    const V = ctx.V;
    const mat = ctx.smat("vigia_body", () => new THREE.MeshStandardMaterial({ color: 0x151b20, roughness: 0.72, metalness: 0.12 }));

    // Massive, squat torso — an immovable landmark.
    const spine = ctx.joint("spine", 0, -0.35, 0);
    const torso = new THREE.Mesh(ctx.sgeo("vigia_torso", () => new THREE.CylinderGeometry(0.34, 0.42, 0.9, 8)), mat);
    torso.position.set(0, 0.1, 0);
    ctx.put(spine, torso);

    const head = ctx.joint("head", 0, 0.55, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("vigia_head", () => new THREE.SphereGeometry(0.22, 10, 8)), mat);
    skull.position.set(0, 0.75, 0);
    ctx.put(head, skull);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x5ee9dc, emissive: 0x0b5958, emissiveIntensity: 1.1, roughness: 0.25 });
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
      ctx.limbIn(arm, limbMat, shoulder, elbow, 0.045, 0.8);
      const fore = ctx.joint(`extraFore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, limbMat, elbow, wrist, 0.035, 0.7);
      const hand = ctx.joint(`extraHand${n}`, wrist.x, wrist.y, wrist.z, fore);
      ctx.limbIn(hand, limbMat, wrist, tip, 0.025, 0.5);
    }
    // Short, stout legs — it doesn't need to move fast, it's already everywhere it needs to be.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = ctx.joint(`leg${n}`, side * 0.15, -0.35, 0);
      ctx.limbIn(leg, mat, V(side * 0.15, -0.35, 0), V(side * 0.18, -0.87, 0.03), 0.14);
      const shin = ctx.joint(`shin${n}`, side * 0.18, -0.87, 0.03, leg);
      ctx.limbIn(shin, mat, V(side * 0.18, -0.87, 0.03), V(side * 0.2, -1.38, 0), 0.12);
    }
  },

  animate(ctx) {
    // Barely moves its body; the long limbs creep along the walls instead,
    // each segment flexing out of step, and its head never leaves you.
    animateBiped(ctx, { stride: 0.2, armSwing: 0, knee: 0.4, elbow: 0, lean: 0.05, bounce: 0.02, breathe: 0.015, headReach: 1.3 });
    const j = ctx.joints;
    const { time, move, observe, pose, chasing } = ctx;
    const transformed = pose === 3;
    const intelligenceReach = transformed ? 1.3 : pose === 2 ? 1 : pose === 1 ? 0.55 : 0;
    // A slow, asymmetric grab cycle. It only fully extends after the Vigia
    // has learned enough from the valves, making the escalation readable.
    const grabCycle = chasing ? Math.max(0, Math.sin(time * (1.7 + intelligenceReach * 0.8))) : 0;
    const reach = intelligenceReach * (0.45 + grabCycle * 0.55);
    for (const [n, s] of [["L", 1], ["R", -1]] as const) {
      const creep = Math.sin(time * 0.9 + (s > 0 ? 0 : 2.4));
      const armReach = reach * (s > 0 ? 1 : 0.78); // one arm always leads the grab
      // Rotating opposite shoulders inward swings their long X-axis limbs to
      // +Z, directly in front of the torso. The forearms then fold together
      // like a closing trap instead of remaining spread across the corridor.
      const forwardFold = 0.58 + armReach * 0.38;
      rot(j[`arm${n}`], creep * 0.06 - armReach * 0.28, s * (forwardFold + creep * 0.06), -s * (0.12 + observe * 0.1 + armReach * 0.28));
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
    // Every wheel teaches it a little; a botched sequence exposes the whole
    // route. At higher intellect it patrols beyond its original basin and
    // stops being a stationary landmark.
    const intellect = ctx.map.poolVigiaIntellect;
    // Mistakes can awaken it early; draining the final sector guarantees the
    // transformation even for a flawless team.
    const transformed = intellect >= 0.64 || ctx.map.poolroomsSolved;
    const awareness = TERRITORY_RADIUS + intellect * 14 + (transformed ? 6 : 0);
    if (ctx.distanceMeters < awareness) {
      return {
        chasing: true,
        speed: transformed ? 3.35 : ADVANCE_SPEED + intellect * 1.15,
        agitated: intellect > 0.28,
        pose: transformed ? 3 : intellect > 0.72 ? 2 : intellect > 0.35 ? 1 : 0,
      };
    }
    return { chasing: false, speed: STILL_SPEED + intellect * 0.25, agitated: transformed, pose: transformed ? 3 : 0 };
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#78716c", strokeColor: "#44403c", labelKey: "radar.vigia" },
};
