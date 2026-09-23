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
import { animateQuadruped } from "./anim";

export const hound: MobDefinition = {
  type: EntityType.HOUND,
  baseSpeed: 1.25,
  baseHeight: 0.75, // crawling dog: feet on the floor
  strideLength: 1.4,
  stepWeight: 0.35,
  bobFreq: 5.5, bobAmp: 0.04, // fast canine shivering
  speechBubbleLocalY: 0.55,
  forcedChaseSpeed: 3.65,

  build(ctx) {
    const V = ctx.V;
    const bodyMat = ctx.smat("hound_body", () => new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95 }));

    // Spine: the whole trunk pivots here, so the back flexes when it gallops.
    const spine = ctx.joint("spine", 0, 0, 0);
    ctx.limbIn(spine, bodyMat, V(0, -0.02, -0.36), V(0, 0.04, 0.3), 0.17, 0.9);
    // Ribs showing through the hide
    for (let i = 0; i < 3; i++) {
      ctx.limbIn(spine, bodyMat, V(-0.15, 0.05, -0.1 + i * 0.12), V(-0.12, -0.12, -0.06 + i * 0.12), 0.025);
      ctx.limbIn(spine, bodyMat, V(0.15, 0.05, -0.1 + i * 0.12), V(0.12, -0.12, -0.06 + i * 0.12), 0.025);
    }

    // 4 crooked, two-segment legs — hips/shoulders pivot, knees fold.
    const legs: [string, string, number, number][] = [
      ["legFL", "shinFL", -0.13, 0.22],
      ["legFR", "shinFR", 0.13, 0.22],
      ["legBL", "shinBL", -0.14, -0.28],
      ["legBR", "shinBR", 0.14, -0.28],
    ];
    for (const [legName, shinName, x, z] of legs) {
      const splay = Math.sign(x) * 0.05;
      const hip = ctx.joint(legName, x, -0.04, z, spine);
      const knee = V(x + splay, -0.38, z + (z > 0 ? 0.05 : -0.07));
      ctx.limbIn(hip, bodyMat, V(x, -0.04, z), knee, 0.055);
      const shin = ctx.joint(shinName, knee.x, knee.y, knee.z, hip);
      ctx.limbIn(shin, bodyMat, knee, V(x + splay * 1.4, -0.7, z + 0.03), 0.042);
    }

    // Head on a neck pivot, with a hinged jaw.
    const head = ctx.joint("head", 0, 0.1, 0.32, spine);
    ctx.limbIn(head, bodyMat, V(0, 0.1, 0.32), V(0, 0.14, 0.42), 0.09);
    const headMat = ctx.smat("hound_head", () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1.0 }));
    const skull = new THREE.Mesh(ctx.sgeo("hound_head_geo", () => new THREE.IcosahedronGeometry(0.19, 0)), headMat);
    skull.position.set(0, 0.16, 0.48);
    ctx.put(head, skull);

    const eyeMat = ctx.smat("hound_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xeab308, emissiveIntensity: 1.4 }));
    const eyeGeo = ctx.sgeo("hound_eye_geo", () => new THREE.SphereGeometry(0.022, 6, 6));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.09, 0.2, 0.64); ctx.put(head, eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.09, 0.2, 0.64); ctx.put(head, eyeR);

    const jawMat = ctx.smat("hound_jaw", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.8 }));
    const jawPivot = ctx.joint("jaw", 0, 0.08, 0.5, head);
    const jaw = new THREE.Mesh(ctx.sgeo("hound_jaw_geo", () => new THREE.BoxGeometry(0.13, 0.05, 0.2)), jawMat);
    jaw.position.set(0, 0.06, 0.62);
    ctx.put(jawPivot, jaw);

    // A thin, two-segment tail.
    const tail = ctx.joint("tail", 0, 0.04, -0.36, spine);
    ctx.limbIn(tail, bodyMat, V(0, 0.04, -0.36), V(0, 0.04, -0.58), 0.035);
    const tail2 = ctx.joint("tail2", 0, 0.04, -0.58, tail);
    ctx.limbIn(tail2, bodyMat, V(0, 0.04, -0.58), V(0, 0.04, -0.8), 0.028, 0.4);
  },

  animate(ctx) {
    animateQuadruped(ctx, { stride: 0.5, knee: 0.7, bounce: 0.06, breathe: 0.035 });
    // Frozen by eye contact: a low, trembling crouch instead of a calm stand.
    if (ctx.observe > 0.01) {
      ctx.body.position.y -= 0.08 * ctx.observe;
      ctx.body.rotation.z = Math.sin(ctx.time * 40) * 0.012 * ctx.observe;
    }
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
    return { key: "" };
  },

  radar: { color: "#f97316", strokeColor: "#c2410c", labelKey: "radar.hound" },
};
