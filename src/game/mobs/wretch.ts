/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WRETCH: a hunched, skeletal, red raw-skinned sprinter with a screaming
 * skull head. A relentless, simple proximity chaser once spotted. Moved
 * verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
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
    const skinMat = ctx.smat("wretch_skin", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.85 }));
    // Hunched spine: pelvis low and back, curving up and forward to the head
    const spine = ctx.joint("spine", 0, -0.55, -0.1);
    ctx.limbIn(spine, skinMat, V(0, -0.55, -0.1), V(0.05, -0.05, 0.05), 0.11);
    const chest = ctx.joint("chest", 0.05, -0.05, 0.05, spine);
    ctx.limbIn(chest, skinMat, V(0.05, -0.05, 0.05), V(0, 0.35, 0.15), 0.09);

    // Reaching claws, from the chest
    const armL = ctx.joint("armL", -0.03, 0.15, 0.1, chest);
    ctx.limbIn(armL, skinMat, V(-0.03, 0.15, 0.1), V(-0.42, 0.05, 0.3), 0.05);
    const foreL = ctx.joint("foreL", -0.42, 0.05, 0.3, armL);
    ctx.limbIn(foreL, skinMat, V(-0.42, 0.05, 0.3), V(-0.6, -0.1, 0.42), 0.04);
    const armR = ctx.joint("armR", 0.03, 0.12, 0.1, chest);
    ctx.limbIn(armR, skinMat, V(0.03, 0.12, 0.1), V(0.4, 0.0, 0.28), 0.05);
    const foreR = ctx.joint("foreR", 0.4, 0.0, 0.28, armR);
    ctx.limbIn(foreR, skinMat, V(0.4, 0.0, 0.28), V(0.56, -0.2, 0.36), 0.04);

    // Sprinting legs
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = ctx.joint(`leg${n}`, side * 0.06, -0.6, -0.12);
      ctx.limbIn(leg, skinMat, V(side * 0.06, -0.6, -0.12), V(side * 0.12, -0.95, 0.02), 0.065);
      const shin = ctx.joint(`shin${n}`, side * 0.12, -0.95, 0.02, leg);
      ctx.limbIn(shin, skinMat, V(side * 0.12, -0.95, 0.02), V(side * 0.17, -1.33, -0.08), 0.055);
    }

    const head = ctx.joint("head", 0, 0.35, 0.15, chest);
    const headMat = ctx.smat("wretch_head", () => new THREE.MeshStandardMaterial({ color: 0x581c1c, roughness: 0.9 }));
    const skull = new THREE.Mesh(ctx.sgeo("wretch_head_geo", () => new THREE.SphereGeometry(0.14, 10, 8)), headMat);
    skull.position.set(0, 0.48, 0.18);
    ctx.put(head, skull);

    const jawPivot = ctx.joint("jaw", 0, 0.44, 0.24, head);
    const jawMat = ctx.smat("wretch_jaw", () => new THREE.MeshStandardMaterial({ color: 0x020101, roughness: 1.0 }));
    const jaw = new THREE.Mesh(ctx.sgeo("wretch_jaw_geo", () => new THREE.SphereGeometry(0.04, 6, 6)), jawMat);
    jaw.position.set(0, 0.42, 0.28);
    jaw.scale.set(0.8, 1.4, 1);
    ctx.put(jawPivot, jaw);

    const eyeMat = ctx.smat("wretch_eye", () => new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.4 }));
    const eyeGeo = ctx.sgeo("wretch_eye_geo", () => new THREE.SphereGeometry(0.02, 6, 6));
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.06, 0.51, 0.28); ctx.put(head, eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.06, 0.51, 0.28); ctx.put(head, eR);
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
