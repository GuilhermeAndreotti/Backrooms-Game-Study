/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HOUND: low crawling dog-thing. Freezes/backs off if the player holds eye
 * contact on it; otherwise a fast, persistent hearing/proximity chaser.
 * Moved verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";

export const hound: MobDefinition = {
  type: EntityType.HOUND,
  baseSpeed: 1.25,
  baseHeight: 1.05, // crawling dog
  bobFreq: 5.5, bobAmp: 0.04, // fast canine shivering
  speechBubbleLocalY: 0.55,
  forcedChaseSpeed: 3.65,

  build(ctx) {
    const { group } = ctx;
    const bodyMat = ctx.smat("hound_body", () => new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95 }));
    group.add(ctx.limbBetween(bodyMat, ctx.V(-0.32, 0.02, -0.22), ctx.V(0.3, 0.05, 0.22), 0.17, 0.9));
    // 4 crooked legs
    const legs: [THREE.Vector3, THREE.Vector3][] = [
      [ctx.V(-0.28, -0.05, -0.2), ctx.V(-0.38, -0.75, -0.28)],
      [ctx.V(-0.1, -0.02, -0.25), ctx.V(-0.16, -0.75, -0.35)],
      [ctx.V(0.14, -0.02, 0.22), ctx.V(0.22, -0.7, 0.32)],
      [ctx.V(0.3, 0.0, 0.18), ctx.V(0.42, -0.72, 0.26)],
    ];
    for (const [a, b] of legs) group.add(ctx.limbBetween(bodyMat, a, b, 0.05));

    const headMat = ctx.smat("hound_head", () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1.0 }));
    const head = new THREE.Mesh(ctx.sgeo("hound_head_geo", () => new THREE.IcosahedronGeometry(0.19, 0)), headMat);
    head.position.set(-0.4, 0.12, -0.24);
    group.add(head);

    const eyeMat = ctx.smat("hound_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xeab308, emissiveIntensity: 1.4 }));
    const eyeGeo = ctx.sgeo("hound_eye_geo", () => new THREE.SphereGeometry(0.022, 6, 6));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.46, 0.15, -0.14); group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(-0.46, 0.15, -0.34); group.add(eyeR);

    const jawMat = ctx.smat("hound_jaw", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.8 }));
    const jaw = new THREE.Mesh(ctx.sgeo("hound_jaw_geo", () => new THREE.BoxGeometry(0.08, 0.05, 0.13)), jawMat);
    jaw.position.set(-0.52, 0.06, -0.24);
    group.add(jaw);
  },

  // Intimidation Gaze logic! Compute player gaze orientation against the
  // Hound's relative direction. ctx.scratch is the gaze-freeze timer
  // (formerly `intimidatedTimer`).
  sense(ctx) {
    const pPos3 = new THREE.Vector3(ctx.playerX, 1.6, ctx.playerZ);
    const toHoundDir = new THREE.Vector3().subVectors(ctx.entityPos, pPos3).normalize();
    const isGazedAt = ctx.cameraDir ? ctx.cameraDir.dot(toHoundDir) > 0.81 : false;

    if (isGazedAt && ctx.distanceMeters < 16.0) {
      // Player maintains high-tension eye contact! Hound freezes or retreats.
      return { chasing: false, speed: 0.25, scratch: 1.2 };
    }

    let scratch = ctx.scratch;
    if (scratch > 0.0) scratch -= ctx.delta;

    if (ctx.distanceMeters < 15.0 && scratch <= 0.0) {
      return { chasing: true, speed: 3.25, scratch }; // fast chase sprint!
    }
    return { chasing: false, speed: 1.25, scratch }; // leisurely crawl pace
  },

  speech(ctx) {
    if (ctx.scratch > 0.1) return { key: "sp.hound.scared" };
    if (ctx.isChasing) return { key: "sp.hound.chase" };
    return { key: "sp.hound.idle" };
  },

  radar: { color: "#f97316", strokeColor: "#c2410c", labelKey: "radar.hound" },
};
