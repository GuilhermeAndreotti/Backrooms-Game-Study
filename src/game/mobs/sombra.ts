/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A SOMBRA: a featureless black humanoid mass that all but disappears in
 * the dark (deliberately low-detail, near-black, unlit-looking geometry).
 * Answers "tenho luz suficiente?" — weak and fleeing when standing in a lit
 * spot itself, only a real threat to a player who is themselves in the
 * dark (flashlight off, standing outside every light source's reach).
 *
 * Scope note: the design doc also has it actively interfering with light
 * fixtures (killing bulbs, flickering them) to lure the player into
 * darkness. That needs a server-validated message and GameEngine-side
 * proximity-to-fixture orchestration — deliberately left for later (this
 * file is the self-contained sensing/avoidance half, which is already a
 * complete, playable mechanic on its own: manage your own light, don't
 * walk into the dark near it).
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { isPointLit } from "../systems/lightQuery";

const DARK_SENSE_RADIUS = 16;
/** Much weaker reach when the player themselves is lit — flashlight or standing in a fixture's glow. */
const LIT_SENSE_RADIUS = 4;
const IDLE_SPEED = 1.0;
const CHASE_SPEED_DARK = 3.4;
/** Sluggish, reluctant, on the rare occasion it dares close in on lit ground at all. */
const CHASE_SPEED_LIT = 1.0;
/** Standing in the light itself: give up ground rather than press the attack. */
const RETREAT_SPEED = 2.0;

export const sombra: MobDefinition = {
  type: EntityType.SOMBRA,
  baseSpeed: IDLE_SPEED,
  baseHeight: 1.35,
  bobFreq: 1.2, bobAmp: 0.06,
  speechBubbleLocalY: 0.9,
  forcedChaseSpeed: 3.4,

  build(ctx) {
    const { group } = ctx;
    const mat = ctx.smat("sombra_body", () => new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 1.0, metalness: 0 }));

    // A simple, featureless humanoid mass — deliberately low detail, so it
    // reads as a shapeless dark blob rather than a creature with anatomy.
    group.add(ctx.limbBetween(mat, ctx.V(0, 0.45, 0), ctx.V(0, -0.4, 0), 0.19, 0.85));
    group.add(ctx.limbBetween(mat, ctx.V(-0.02, 0.35, 0), ctx.V(-0.28, -0.3, 0.05), 0.09));
    group.add(ctx.limbBetween(mat, ctx.V(0.02, 0.35, 0), ctx.V(0.28, -0.3, 0.05), 0.09));
    group.add(ctx.limbBetween(mat, ctx.V(-0.06, -0.4, 0), ctx.V(-0.1, -1.15, 0), 0.11));
    group.add(ctx.limbBetween(mat, ctx.V(0.06, -0.4, 0), ctx.V(0.1, -1.15, 0), 0.11));

    const head = new THREE.Mesh(ctx.sgeo("sombra_head", () => new THREE.SphereGeometry(0.17, 8, 6)), mat);
    head.position.set(0, 0.58, 0);
    group.add(head);
  },

  sense(ctx) {
    if (isPointLit(ctx.map, ctx.entityPos.x, ctx.entityPos.z)) {
      // Standing in the light itself: retreat rather than press an attack.
      return { chasing: false, speed: RETREAT_SPEED };
    }

    const playerLit = !!ctx.isFlashlightOn || isPointLit(ctx.map, ctx.playerX, ctx.playerZ);
    const radius = playerLit ? LIT_SENSE_RADIUS : DARK_SENSE_RADIUS;
    if (ctx.distanceMeters < radius) {
      return { chasing: true, speed: playerLit ? CHASE_SPEED_LIT : CHASE_SPEED_DARK };
    }
    return { chasing: false, speed: IDLE_SPEED };
  },

  speech(ctx) {
    return { key: ctx.isChasing ? "sp.sombra.chase" : "sp.sombra.lurk" };
  },

  radar: { color: "#4c1d95", strokeColor: "#2e1065", labelKey: "radar.sombra" },
};
