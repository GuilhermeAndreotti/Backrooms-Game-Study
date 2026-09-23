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

const TERRITORY_RADIUS = 14;
/** Barely creeps outside its territory — mostly a stationary landmark. */
const STILL_SPEED = 0.15;
/** Still very slow once "advancing" — overwhelmingly avoidable; the threat is where it stands, not how fast it moves. */
const ADVANCE_SPEED = 0.9;

export const vigia: MobDefinition = {
  type: EntityType.VIGIA,
  baseSpeed: STILL_SPEED,
  baseHeight: 1.4,
  bobFreq: 0.6, bobAmp: 0.03, // almost imperceptible — reads as "immobile"
  speechBubbleLocalY: 1.1,
  forcedChaseSpeed: 2.2, // even under forced-chase rules, stays slower than the rest of the roster

  build(ctx) {
    const { group } = ctx;
    const mat = ctx.smat("vigia_body", () => new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.8 }));

    // Massive, squat torso — an immovable landmark.
    const torso = new THREE.Mesh(ctx.sgeo("vigia_torso", () => new THREE.CylinderGeometry(0.34, 0.42, 0.9, 8)), mat);
    torso.position.set(0, 0.1, 0);
    group.add(torso);

    const head = new THREE.Mesh(ctx.sgeo("vigia_head", () => new THREE.SphereGeometry(0.22, 10, 8)), mat);
    head.position.set(0, 0.75, 0);
    group.add(head);

    // Extremely long, thin limbs reaching far to either side — can span a whole corridor.
    const limbMat = ctx.smat("vigia_limb", () => new THREE.MeshStandardMaterial({ color: 0x100f14, roughness: 0.9 }));
    group.add(ctx.limbBetween(limbMat, ctx.V(-0.3, 0.4, 0), ctx.V(-2.6, -0.2, 0.3), 0.05, 0.5));
    group.add(ctx.limbBetween(limbMat, ctx.V(0.3, 0.4, 0), ctx.V(2.6, -0.2, -0.3), 0.05, 0.5));
    // Short, stout legs — it doesn't need to move fast, it's already everywhere it needs to be.
    group.add(ctx.limbBetween(mat, ctx.V(-0.15, -0.35, 0), ctx.V(-0.2, -0.85, 0), 0.14));
    group.add(ctx.limbBetween(mat, ctx.V(0.15, -0.35, 0), ctx.V(0.2, -0.85, 0), 0.14));
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
