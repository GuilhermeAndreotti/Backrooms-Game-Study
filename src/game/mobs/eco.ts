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
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";

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
  bobFreq: 4.6, bobAmp: 0.05, // twitchy, irregular
  speechBubbleLocalY: 0.85,
  forcedChaseSpeed: 3.5,

  build(ctx) {
    const { group } = ctx;
    const mat = ctx.smat("eco_body", () => new THREE.MeshStandardMaterial({ color: 0x1a1620, roughness: 0.9, metalness: 0.05 }));

    // Twisted spine, tilted off-centre — an intentionally "irregular" silhouette.
    group.add(ctx.limbBetween(mat, ctx.V(0.04, 0.32, -0.02), ctx.V(-0.06, -0.32, 0.05), 0.1));
    // Asymmetric, oddly bent limbs — no two the same length or angle.
    group.add(ctx.limbBetween(mat, ctx.V(0.02, 0.28, -0.02), ctx.V(0.38, 0.12, 0.18), 0.045));
    group.add(ctx.limbBetween(mat, ctx.V(0.38, 0.12, 0.18), ctx.V(0.3, -0.28, 0.35), 0.04));
    group.add(ctx.limbBetween(mat, ctx.V(0.0, 0.25, -0.02), ctx.V(-0.4, -0.05, -0.22), 0.045));
    group.add(ctx.limbBetween(mat, ctx.V(-0.4, -0.05, -0.22), ctx.V(-0.5, -0.5, -0.1), 0.04));
    // Legs, mismatched (irregular gait)
    group.add(ctx.limbBetween(mat, ctx.V(-0.05, -0.32, 0.05), ctx.V(-0.18, -0.95, 0.1), 0.06));
    group.add(ctx.limbBetween(mat, ctx.V(-0.05, -0.32, 0.05), ctx.V(0.14, -0.8, -0.08), 0.06));

    // Featureless head — smooth, elongated, no face.
    const head = new THREE.Mesh(ctx.sgeo("eco_head", () => new THREE.SphereGeometry(0.135, 10, 8)), mat);
    head.position.set(0.05, 0.48, -0.04);
    head.scale.set(0.9, 1.15, 0.95);
    group.add(head);
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
