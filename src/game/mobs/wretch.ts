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

export const wretch: MobDefinition = {
  type: EntityType.WRETCH,
  baseSpeed: 1.45,
  baseHeight: 1.35,
  bobFreq: 3.8, bobAmp: 0.08,
  speechBubbleLocalY: 0.9,
  forcedChaseSpeed: 3.4,

  build(ctx) {
    const { group } = ctx;
    const skinMat = ctx.smat("wretch_skin", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.85 }));
    // Hunched spine: pelvis low and back, curving up and forward to the head
    group.add(ctx.limbBetween(skinMat, ctx.V(0, -0.55, 0.1), ctx.V(-0.05, -0.05, -0.05), 0.11));
    group.add(ctx.limbBetween(skinMat, ctx.V(-0.05, -0.05, -0.05), ctx.V(0, 0.35, -0.15), 0.09));
    // Reaching claws
    group.add(ctx.limbBetween(skinMat, ctx.V(-0.03, 0.15, -0.1), ctx.V(-0.42, 0.05, -0.3), 0.05));
    group.add(ctx.limbBetween(skinMat, ctx.V(-0.42, 0.05, -0.3), ctx.V(-0.6, -0.1, -0.42), 0.04));
    group.add(ctx.limbBetween(skinMat, ctx.V(0, 0.0, -0.08), ctx.V(0.35, -0.15, 0.1), 0.05));
    group.add(ctx.limbBetween(skinMat, ctx.V(0.35, -0.15, 0.1), ctx.V(0.5, -0.42, 0.22), 0.04));
    // Sprinting legs
    group.add(ctx.limbBetween(skinMat, ctx.V(-0.06, -0.6, 0.12), ctx.V(-0.16, -1.3, 0.05), 0.065));
    group.add(ctx.limbBetween(skinMat, ctx.V(0.06, -0.6, 0.1), ctx.V(0.2, -1.3, 0.2), 0.065));

    const headMat = ctx.smat("wretch_head", () => new THREE.MeshStandardMaterial({ color: 0x581c1c, roughness: 0.9 }));
    const head = new THREE.Mesh(ctx.sgeo("wretch_head_geo", () => new THREE.SphereGeometry(0.14, 10, 8)), headMat);
    head.position.set(0, 0.48, -0.18);
    group.add(head);

    const jawMat = ctx.smat("wretch_jaw", () => new THREE.MeshStandardMaterial({ color: 0x020101, roughness: 1.0 }));
    const jaw = new THREE.Mesh(ctx.sgeo("wretch_jaw_geo", () => new THREE.SphereGeometry(0.04, 6, 6)), jawMat);
    jaw.position.set(0, 0.42, -0.28);
    jaw.scale.set(0.8, 1.4, 1);
    group.add(jaw);

    const eyeMat = ctx.smat("wretch_eye", () => new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.4 }));
    const eyeGeo = ctx.sgeo("wretch_eye_geo", () => new THREE.SphereGeometry(0.02, 6, 6));
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.06, 0.51, -0.28); group.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.06, 0.51, -0.28); group.add(eR);
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
