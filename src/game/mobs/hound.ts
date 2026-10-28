/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HOUND: low crawling dog-thing. Freezes/backs off if the player holds eye
 * contact on it; otherwise a fast, persistent hearing/proximity chaser.
 * Moved verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { bake, teeth, vertebrae } from "./anatomy";
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
    // Hairless, half-starved hide stretched over bone.
    const bodyMat = ctx.smat("hound_body", () => new THREE.MeshStandardMaterial({ color: 0x141211, roughness: 0.7 }));
    const headMat = ctx.smat("hound_head", () => new THREE.MeshStandardMaterial({ color: 0x0f0d0c, roughness: 0.75 }));
    const boneMat = ctx.smat("hound_bone", () => new THREE.MeshStandardMaterial({ color: 0xb8ad94, roughness: 0.5 }));
    const gumMat = ctx.smat("hound_jaw", () => new THREE.MeshStandardMaterial({ color: 0x5c1616, roughness: 0.55 }));

    // Spine: the whole trunk pivots here, so the back flexes when it gallops.
    // A deep, narrow chest tucking up into a wasp waist and bony haunches,
    // every rib showing, the spine cresting in a ridge of knuckles.
    const spine = ctx.joint("spine", 0, 0, 0);
    bake(ctx, spine, bodyMat, "hound_trunk", (p) => {
      p.blob(V(0, -0.02, 0.17), 0.16, [0.8, 1.05, 1.25]);
      p.limb(V(0, 0.02, 0.05), V(0, 0.05, -0.26), 0.1, 0.9);
      for (const s of [-1, 1]) {
        p.blob(V(s * 0.08, 0.03, -0.3), 0.095, [0.9, 1.1, 1.2]);
        p.blob(V(s * 0.1, 0.0, 0.24), 0.07, [0.8, 1.2, 1]); // shoulder blades
        for (let i = 0; i < 5; i++) {
          const z = 0.26 - i * 0.07;
          p.chain([V(s * 0.03, 0.13, z), V(s * 0.135, 0.02 + i * 0.012, z - 0.01), V(s * 0.08, -0.15 + i * 0.03, z + 0.03)], 0.016, 0.012);
        }
      }
      vertebrae(p, V(0, 0.15, 0.3), V(0, 0.12, -0.38), 10, 0.028, 0.035);
    });

    // 4 crooked, two-segment legs — hips/shoulders pivot, knees fold — on
    // splayed paws with claws.
    const legs: [string, string, number, number][] = [
      ["legFL", "shinFL", -0.11, 0.22],
      ["legFR", "shinFR", 0.11, 0.22],
      ["legBL", "shinBL", -0.12, -0.3],
      ["legBR", "shinBR", 0.12, -0.3],
    ];
    for (const [legName, shinName, x, z] of legs) {
      const splay = Math.sign(x) * 0.05;
      const front = z > 0;
      const hip = ctx.joint(legName, x, -0.04, z, spine);
      const knee = V(x + splay, -0.38, z + (front ? 0.05 : -0.09));
      ctx.limbIn(hip, bodyMat, V(x, -0.04, z), knee, front ? 0.055 : 0.07, 0.7);
      const shin = ctx.joint(shinName, knee.x, knee.y, knee.z, hip);
      const foot = V(x + splay * 1.4, -0.66, z + 0.03);
      bake(ctx, shin, bodyMat, `hound_shin_${legName}`, (p) => {
        p.limb(knee, foot, 0.04, 0.8);
        p.blob(V(foot.x, -0.69, foot.z + 0.04), 0.04, [1, 0.55, 1.4]);
      });
      bake(ctx, shin, boneMat, `hound_claws_${legName}`, (p) => {
        for (const t of [-1, 0, 1]) p.spike(V(foot.x + t * 0.022, -0.69, foot.z + 0.08), V(foot.x + t * 0.03, -0.73, foot.z + 0.12), 0.008, 5);
      });
    }

    // Head on a neck pivot, with a hinged jaw: a long, narrow skull with a
    // heavy brow running into a tapered muzzle, ears pinned back.
    const head = ctx.joint("head", 0, 0.1, 0.32, spine);
    ctx.limbIn(head, bodyMat, V(0, 0.1, 0.32), V(0, 0.15, 0.44), 0.075, 0.9);
    bake(ctx, head, headMat, "hound_skull", (p) => {
      p.blob(V(0, 0.17, 0.46), 0.14, [0.95, 0.85, 1.25]);
      p.limb(V(0, 0.15, 0.52), V(0, 0.12, 0.7), 0.09, 0.55);
      for (const s of [-1, 1]) {
        p.limb(V(s * 0.065, 0.24, 0.5), V(s * 0.085, 0.215, 0.6), 0.035, 0.7);
        p.spike(V(s * 0.08, 0.25, 0.4), V(s * 0.13, 0.36, 0.3), 0.035, 6); // ears
      }
    });
    bake(ctx, head, boneMat, "hound_upper_teeth", (p) => teeth(p, V(0, 0.085, 0.66), 0.032, 0.06, 9, 0.035, false, 0.007));

    const eyeMat = ctx.smat("hound_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xeab308, emissiveIntensity: 1.4 }));
    const eyeGeo = ctx.sgeo("hound_eye_geo", () => new THREE.SphereGeometry(0.02, 8, 6));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.08, 0.205, 0.585); ctx.put(head, eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.08, 0.205, 0.585); ctx.put(head, eyeR);

    const jawPivot = ctx.joint("jaw", 0, 0.08, 0.5, head);
    bake(ctx, jawPivot, gumMat, "hound_jaw", (p) => p.chain([V(-0.055, 0.07, 0.5), V(-0.035, 0.045, 0.62), V(0, 0.04, 0.69), V(0.035, 0.045, 0.62), V(0.055, 0.07, 0.5)], 0.022, 0.02));
    bake(ctx, jawPivot, boneMat, "hound_lower_teeth", (p) => teeth(p, V(0, 0.058, 0.65), 0.028, 0.05, 8, 0.03, true, 0.007));

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
