/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O ECO: a distorted, faceless humanoid silhouette with an irregular gait.
 * Answers the player's question "estou fazendo muito barulho?" — it has no
 * eyes and doesn't sense proximity directly, only sound (see noiseBus.ts):
 * running/prop-shoving is audible from far away, walking from less, and a
 * crouched footstep barely carries at all. Once triggered it chases and
 * ramps up speed the longer the chase runs.
 *
 * Scope note: it chases the player directly once triggered (reusing the
 * shared BFS-chase path every mob uses), not the remembered noise
 * position specifically — "investigate where the sound came from, not who
 * made it" would need a per-mob path-target override that doesn't exist
 * yet (only Finger King has one, and it's Level-G-bespoke). So today the
 * doc's "use objects as a distraction" weakness works only in the sense
 * that staying quiet afterward lets the chase go cold (the shared
 * search-then-patrol behavior every mob already has), not in luring it to
 * a decoy location.
 */

import * as THREE from "three";
import { bake, hand, ribcage, vertebrae } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped } from "./anim";

/** A sound this loud (0..1) is audible out to this many metres. */
const MIN_HEARING_RADIUS = 3;
const HEARING_RADIUS_PER_LOUDNESS = 15;

const BASE_SPEED = 1.15;
const CHASE_BASE_SPEED = 1.8;
const CHASE_RAMP_PER_S = 0.4;
const CHASE_MAX_SPEED = 3.6;

export const eco: MobDefinition = {
  type: EntityType.ECO,
  baseSpeed: BASE_SPEED,
  baseHeight: 1.35,
  strideLength: 1.2,
  stepWeight: 0.4,
  bobFreq: 4.6, bobAmp: 0.05, // twitchy, irregular
  speechBubbleLocalY: 0.85,
  forcedChaseSpeed: 3.5,

  build(ctx) {
    const V = ctx.V;
    const mat = ctx.smat("eco_body", () => new THREE.MeshStandardMaterial({ color: 0x1d1a22, roughness: 0.7, metalness: 0.05 }));

    // Twisted spine, tilted off-centre — an intentionally "irregular"
    // silhouette: a starved trunk, ribs pressing through, one shoulder high.
    const spine = ctx.joint("spine", -0.05, -0.32, 0.05);
    bake(ctx, spine, mat, "eco_trunk", (p) => {
      p.blob(V(-0.06, -0.32, 0.05), 0.09, [1.4, 0.7, 1]);
      p.chain([V(-0.06, -0.3, 0.05), V(-0.02, 0.0, 0.03), V(0.03, 0.18, 0.0), V(0.04, 0.3, -0.02)], 0.085, 0.1);
      ribcage(p, { c: V(0.0, 0.12, 0.02), w: 0.12, d: 0.085, h: 0.1, ribs: 5, r: 0.011 });
      p.blob(V(0.04, 0.29, -0.03), 0.05, [1, 0.8, 1]); // right shoulder, hunched up
      p.blob(V(-0.03, 0.24, -0.03), 0.045, [1, 0.8, 1]);
      vertebrae(p, V(-0.07, -0.25, -0.04), V(0.03, 0.3, -0.09), 8, 0.018);
      p.chain([V(0.04, 0.3, -0.02), V(0.035, 0.38, -0.03)], 0.04, 0.035);
    });

    // Asymmetric, oddly bent limbs — no two the same length or angle — on
    // hands with too many, too-long fingers.
    const arms: [string, string, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      ["armR", "foreR", V(0.02, 0.28, -0.02), V(0.38, 0.12, 0.18), V(0.3, -0.28, 0.35), V(1, 0, 0)],
      ["armL", "foreL", V(0.0, 0.25, -0.02), V(-0.4, -0.05, -0.22), V(-0.5, -0.5, -0.1), V(0, 0, -1)],
    ];
    for (const [armName, foreName, shoulder, elbow, wrist, across] of arms) {
      const arm = ctx.joint(armName, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, mat, shoulder, elbow, 0.045, 0.8);
      const fore = ctx.joint(foreName, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, mat, elbow, wrist, 0.04, 0.8);
      bake(ctx, fore, mat, `eco_${armName}_hand`, (p) => hand(p, { wrist, dir: wrist.clone().sub(elbow), across, fingers: 6, len: 0.17, r: 0.01, curl: 0.7 }));
    }

    // Legs, mismatched — one shorter, so it limps — with long, splayed feet.
    const legs: [string, string, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      ["legL", "shinL", V(-0.06, -0.32, 0.05), V(-0.12, -0.82, 0.08), V(-0.18, -1.3, 0.1)],
      ["legR", "shinR", V(0.0, -0.32, 0.05), V(0.1, -0.74, -0.05), V(0.14, -1.17, -0.08)],
    ];
    for (const [legName, shinName, hip, knee, ankle] of legs) {
      const leg = ctx.joint(legName, hip.x, hip.y, hip.z);
      ctx.limbIn(leg, mat, hip, knee, 0.06, 0.8);
      const shin = ctx.joint(shinName, knee.x, knee.y, knee.z, leg);
      bake(ctx, shin, mat, `eco_${legName}_shin`, (p) => {
        p.limb(knee, ankle, 0.048, 0.75);
        p.limb(ankle, V(ankle.x, ankle.y - 0.02, ankle.z + 0.14), 0.03, 0.6);
        for (const t of [-1, 1]) p.limb(V(ankle.x, ankle.y - 0.02, ankle.z + 0.1), V(ankle.x + t * 0.04, ankle.y - 0.03, ankle.z + 0.2), 0.012, 0.6);
      });
    }

    // Featureless head — smooth, elongated, no face — though the skin is
    // stretched so tight the brow and the bridge of a nose show through.
    const head = ctx.joint("head", 0.03, 0.36, -0.03, spine);
    const skull = new THREE.Mesh(ctx.sgeo("eco_head", () => new THREE.SphereGeometry(0.135, 16, 12)), mat);
    skull.position.set(0.05, 0.48, -0.04);
    skull.scale.set(0.9, 1.15, 0.95);
    ctx.put(head, skull);
    bake(ctx, head, mat, "eco_face", (p) => {
      p.limb(V(-0.0, 0.52, 0.075), V(0.1, 0.52, 0.075), 0.018, 1);
      p.limb(V(0.05, 0.51, 0.09), V(0.05, 0.45, 0.1), 0.014, 0.8);
      p.blob(V(0.05, 0.4, 0.07), 0.035, [1, 0.6, 0.8]);
    });
  },

  animate(ctx) {
    animateBiped(ctx, { stride: 0.42, armSwing: 0.25, knee: 0.8, elbow: 0.2, lean: 0.3, bounce: 0.05, breathe: 0.03 });
    // It hunts by sound: limps (short right leg), and the eyeless head jerks
    // in sudden twitches toward wherever it's "listening".
    const { time, move } = ctx;
    ctx.body.rotation.z = Math.sin(ctx.phase) * 0.09 * move;
    const twitch = Math.sin(time * 1.9) * Math.sin(time * 7.3) > 0.55 ? Math.sin(time * 31) * 0.35 : 0;
    const head = ctx.joints.head;
    if (head) {
      head.rotation.y += twitch;
      head.rotation.z += 0.35 * ctx.observe + twitch * 0.5; // the listening tilt
    }
  },

  sense(ctx) {
    const events = ctx.noiseBus?.near(ctx.entityPos.x, ctx.entityPos.z, MIN_HEARING_RADIUS + HEARING_RADIUS_PER_LOUDNESS) ?? [];
    const heard = events.some((e) => {
      const dx = e.x - ctx.entityPos.x, dz = e.z - ctx.entityPos.z;
      const radius = MIN_HEARING_RADIUS + HEARING_RADIUS_PER_LOUDNESS * e.loudness;
      return dx * dx + dz * dz <= radius * radius;
    });

    if (heard) {
      const chaseTime = ctx.scratch + ctx.delta;
      const speed = Math.min(CHASE_MAX_SPEED, CHASE_BASE_SPEED + CHASE_RAMP_PER_S * chaseTime);
      return { chasing: true, speed, scratch: chaseTime };
    }
    return { chasing: false, speed: BASE_SPEED, scratch: 0 };
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#22d3ee", strokeColor: "#0e7490", labelKey: "radar.eco" },
};
