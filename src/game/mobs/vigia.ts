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
  baseHeight: 1.4,
  strideLength: 0.9,
  facesViewer: true,
  bobFreq: 0.6, bobAmp: 0.03, // almost imperceptible — reads as "immobile"
  speechBubbleLocalY: 1.1,
  forcedChaseSpeed: 2.2, // even under forced-chase rules, stays slower than the rest of the roster

  build(ctx) {
    const V = ctx.V;
    const mat = ctx.smat("vigia_body", () => new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.8 }));

    // Massive, squat torso — an immovable landmark.
    const spine = ctx.joint("spine", 0, -0.35, 0);
    const torso = new THREE.Mesh(ctx.sgeo("vigia_torso", () => new THREE.CylinderGeometry(0.34, 0.42, 0.9, 8)), mat);
    torso.position.set(0, 0.1, 0);
    ctx.put(spine, torso);

    const head = ctx.joint("head", 0, 0.55, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("vigia_head", () => new THREE.SphereGeometry(0.22, 10, 8)), mat);
    skull.position.set(0, 0.75, 0);
    ctx.put(head, skull);

    // Extremely long, thin limbs reaching far to either side — can span a
    // whole corridor. Three segments each, like a spider's.
    const limbMat = ctx.smat("vigia_limb", () => new THREE.MeshStandardMaterial({ color: 0x100f14, roughness: 0.9 }));
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const zs = side < 0 ? 1 : -1;
      const shoulder = V(side * 0.3, 0.4, 0);
      const elbow = V(side * 1.2, 0.35, 0.12 * zs);
      const wrist = V(side * 2.0, 0.05, 0.22 * zs);
      const hand = V(side * 2.6, -0.2, 0.3 * zs);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, limbMat, shoulder, elbow, 0.05, 0.8);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, limbMat, elbow, wrist, 0.04, 0.75);
      const claw = ctx.joint(`hand${n}`, wrist.x, wrist.y, wrist.z, fore);
      ctx.limbIn(claw, limbMat, wrist, hand, 0.03, 0.5);
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
    const { time, move, observe } = ctx;
    for (const [n, s] of [["L", 1], ["R", -1]] as const) {
      const creep = Math.sin(time * 0.9 + (s > 0 ? 0 : 2.4));
      rot(j[`arm${n}`], creep * 0.08, creep * 0.12 * s + move * 0.2 * s, -s * (0.05 + observe * 0.15));
      rot(j[`fore${n}`], 0, Math.sin(time * 1.3 + s) * 0.15 * s, -s * (creep * 0.1 + observe * 0.25));
      // Finger-tips tap the wall
      rot(j[`hand${n}`], 0, 0, -s * Math.max(0, Math.sin(time * 4 + s * 2)) * 0.3);
    }
  },

  sense(ctx) {
    if (ctx.distanceMeters < TERRITORY_RADIUS) {
      return { chasing: true, speed: ADVANCE_SPEED };
    }
    return { chasing: false, speed: STILL_SPEED };
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#78716c", strokeColor: "#44403c", labelKey: "radar.vigia" },
};
