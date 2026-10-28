/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WRETCH: a hunched, skeletal, red raw-skinned sprinter with a screaming
 * skull head. A relentless, simple proximity chaser once spotted. Moved
 * verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { bake, hand, handClaws, ribcage, teeth, vertebrae } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped } from "./anim";

export const wretch: MobDefinition = {
  type: EntityType.WRETCH,
  baseSpeed: 1.45,
  baseHeight: 1.35,
  strideLength: 1.5,
  stepWeight: 0.55,
  bobFreq: 3.8, bobAmp: 0.08,
  speechBubbleLocalY: 0.9,
  forcedChaseSpeed: 3.4,

  build(ctx) {
    const V = ctx.V;
    // Flayed: raw muscle over bone, darker and wetter where it's thinnest.
    const skinMat = ctx.smat("wretch_skin", () => new THREE.MeshStandardMaterial({ color: 0x6e2722, roughness: 0.62 }));
    const headMat = ctx.smat("wretch_head", () => new THREE.MeshStandardMaterial({ color: 0x5a211c, roughness: 0.7 }));
    const boneMat = ctx.smat("wretch_bone", () => new THREE.MeshStandardMaterial({ color: 0xc9bc9c, roughness: 0.5 }));
    const voidMat = ctx.smat("wretch_void", () => new THREE.MeshStandardMaterial({ color: 0x0b0303, roughness: 1.0 }));

    // Pelvis and a sunken belly, hunched spine knuckling out of the back.
    const spine = ctx.joint("spine", 0, -0.55, -0.1);
    bake(ctx, spine, skinMat, "wretch_hips", (p) => {
      p.blob(V(0, -0.57, -0.1), 0.1, [1.5, 0.75, 1.1]);
      p.chain([V(0, -0.55, -0.11), V(0.02, -0.32, -0.06), V(0.03, -0.08, 0.02)], 0.075, 0.08);
      p.blob(V(0.02, -0.3, 0.0), 0.075, [1.1, 1.4, 0.85]);
      vertebrae(p, V(0, -0.5, -0.18), V(0.03, -0.1, -0.07), 6, 0.022);
    });

    // Chest: a narrow core with the ribcage standing out of it, collarbones
    // and bony shoulders, the vertebrae cresting into a ridge.
    const chest = ctx.joint("chest", 0.03, -0.05, 0.05, spine);
    bake(ctx, chest, skinMat, "wretch_chest", (p) => {
      p.chain([V(0.03, -0.06, 0.04), V(0.03, 0.15, 0.09), V(0.02, 0.32, 0.13)], 0.085, 0.065);
      ribcage(p, { c: V(0.03, 0.13, 0.09), w: 0.15, d: 0.1, h: 0.13, ribs: 6, r: 0.013 });
      for (const s of [-1, 1]) {
        p.limb(V(0.02, 0.31, 0.16), V(s * 0.17, 0.29, 0.1), 0.019, 0.9);
        p.blob(V(s * 0.18, 0.27, 0.08), 0.048, [1, 0.9, 1.1]);
      }
      vertebrae(p, V(0.03, -0.02, -0.04), V(0.02, 0.3, 0.05), 6, 0.02, 0.03);
      p.chain([V(0.02, 0.31, 0.12), V(0.01, 0.39, 0.17)], 0.038, 0.034);
    });

    // Arms that reach too far, ending in long-fingered, clawed hands.
    const arms: [string, string, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      ["armL", "foreL", V(-0.18, 0.27, 0.09), V(-0.33, -0.02, 0.2), V(-0.42, -0.3, 0.33)],
      ["armR", "foreR", V(0.18, 0.26, 0.09), V(0.34, -0.04, 0.2), V(0.44, -0.32, 0.31)],
    ];
    for (const [armName, foreName, shoulder, elbow, wrist] of arms) {
      const s = Math.sign(shoulder.x);
      const arm = ctx.joint(armName, shoulder.x, shoulder.y, shoulder.z, chest);
      ctx.limbIn(arm, skinMat, shoulder, elbow, 0.042, 0.8);
      const fore = ctx.joint(foreName, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, skinMat, elbow, wrist, 0.034, 0.75);
      const h = { wrist, dir: wrist.clone().sub(elbow), across: V(0, 0, s), fingers: 4, len: 0.2, r: 0.013, curl: 0.55 };
      bake(ctx, fore, skinMat, `wretch_hand_${s}`, (p) => hand(p, h));
      bake(ctx, fore, boneMat, `wretch_claws_${s}`, (p) => handClaws(p, h, 0.055));
    }

    // Digitigrade sprinter's legs: thigh, shin, a long foot up on its toes.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const hip = V(side * 0.08, -0.6, -0.1), knee = V(side * 0.12, -0.93, 0.07);
      const ankle = V(side * 0.14, -1.17, -0.12), ball = V(side * 0.15, -1.3, 0.03);
      const leg = ctx.joint(`leg${n}`, hip.x, hip.y, hip.z);
      ctx.limbIn(leg, skinMat, hip, knee, 0.07, 0.7);
      const shin = ctx.joint(`shin${n}`, knee.x, knee.y, knee.z, leg);
      bake(ctx, shin, skinMat, `wretch_shin_${side}`, (p) => {
        p.limb(knee, ankle, 0.045, 0.75);
        p.limb(ankle, ball, 0.03, 0.8);
      });
      bake(ctx, shin, boneMat, `wretch_toes_${side}`, (p) => {
        for (const t of [-1, 0, 1]) p.spike(ball, V(ball.x + t * 0.03, -1.33, ball.z + 0.07 - Math.abs(t) * 0.015), 0.012, 5);
        p.spike(ankle, V(ankle.x, ankle.y - 0.02, ankle.z - 0.06), 0.012, 5); // heel spur
      });
    }

    // Skull: long cranium, heavy brow and cheekbones, sockets sunk deep, the
    // nose gone, a lipless mouth of teeth.
    const head = ctx.joint("head", 0, 0.36, 0.16, chest);
    bake(ctx, head, headMat, "wretch_skull", (p) => {
      p.blob(V(0, 0.5, 0.17), 0.115, [0.92, 1.05, 1.15]);
      p.limb(V(-0.075, 0.525, 0.282), V(0.075, 0.525, 0.282), 0.024, 1);
      for (const s of [-1, 1]) p.blob(V(s * 0.065, 0.46, 0.255), 0.03, [1.2, 0.8, 1]);
      p.blob(V(0, 0.445, 0.275), 0.052, [1, 0.75, 1]);
    });
    bake(ctx, head, voidMat, "wretch_sockets", (p) => {
      for (const s of [-1, 1]) p.blob(V(s * 0.055, 0.495, 0.272), 0.031);
      p.blob(V(0, 0.468, 0.312), 0.015, [0.7, 1.2, 0.6]);
    });
    bake(ctx, head, boneMat, "wretch_upper_teeth", (p) => teeth(p, V(0, 0.418, 0.312), 0.045, 0.03, 8, 0.03, false));

    const jawPivot = ctx.joint("jaw", 0, 0.44, 0.22, head);
    bake(ctx, jawPivot, headMat, "wretch_jaw", (p) => p.chain([V(-0.06, 0.43, 0.22), V(-0.045, 0.39, 0.3), V(0, 0.378, 0.33), V(0.045, 0.39, 0.3), V(0.06, 0.43, 0.22)], 0.018, 0.018));
    bake(ctx, jawPivot, boneMat, "wretch_lower_teeth", (p) => teeth(p, V(0, 0.392, 0.31), 0.04, 0.03, 7, 0.026, true));

    // The only light left in it, at the back of each socket.
    const eyeMat = ctx.smat("wretch_eye", () => new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.4 }));
    const eyeGeo = ctx.sgeo("wretch_eye_geo", () => new THREE.SphereGeometry(0.016, 8, 6));
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.055, 0.497, 0.292); ctx.put(head, eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.055, 0.497, 0.292); ctx.put(head, eR);
  },

  animate(ctx) {
    animateBiped(ctx, { stride: 0.55, armSwing: 0.2, knee: 1.0, elbow: 0.3, lean: 0.5, bounce: 0.07, breathe: 0.05, reach: 0.7 });
    // Hunched chest heaves; claws flex open and shut.
    const { time, move } = ctx;
    const chest = ctx.joints.chest;
    if (chest) chest.rotation.x = Math.sin(time * 2.6) * 0.06 * (1 - move) + Math.sin(ctx.phase * 2) * 0.08 * move;
    const flex = Math.sin(time * 5.5) * 0.25;
    if (ctx.joints.foreL) ctx.joints.foreL.rotation.z = flex;
    if (ctx.joints.foreR) ctx.joints.foreR.rotation.z = -flex;
  },

  // Relentless pursuer once spotted within 16 meters.
  sense(ctx) {
    if (ctx.distanceMeters < 16.0) return { chasing: true, speed: 2.45 };
    return { chasing: false, speed: 1.45 };
  },

  speech(ctx) {
    return { key: ctx.isChasing ? "sp.wretch.chase" : "sp.wretch.idle" };
  },

  radar: { color: "#ef4444", strokeColor: "#b91c1c", labelKey: "radar.wretch" },
};
