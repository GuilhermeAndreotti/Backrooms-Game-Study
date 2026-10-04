/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE ANIMATIONS (Level 94, night only): the town's cartoon people, the
 * way they look once the clock has started — black and white, grinning too
 * wide, moving like a puppet shot one frame at a time.
 *
 * Simple to read on purpose: they see whoever is in front of them with a
 * clear line (walls, house fronts and parked cars hide you), further if you
 * run or carry a lit flashlight, much closer if you crouch. They keep after
 * you for a few seconds once they lose sight of you, and never follow
 * anyone into a house (townLayout's townEntityMayEnter keeps them on the
 * streets; GameEngine marks whoever is indoors as hidden).
 */

import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateToon, buildToon, TOON_FEET } from "../levels/townFigures";
import { townSightClear } from "../levels/townLayout";

const SCALE = 1.15;
const PATROL_SPEED = 1.5;
/** Faster than a walk, slower than a sprint: running away works, if you have somewhere to go. */
const CHASE_SPEED = 3.3;
/** Seconds out of sight before they give up. */
const LOSE_SECONDS = 3.5;
/** Within this, they always notice you (sight or not). */
const FEEL_RANGE = 2.5;

function sightRange(state: string, flashlight: boolean): number {
  const base = state === "running" ? 17 : state === "walking" ? 11 : state === "crouching" ? 5 : 7;
  return base + (flashlight ? 5 : 0);
}

export const animation: MobDefinition = {
  type: EntityType.ANIMATION,
  baseSpeed: PATROL_SPEED,
  baseHeight: TOON_FEET * SCALE,
  strideLength: 1.4,
  stepWeight: 0.35,
  bobFreq: 3.0, bobAmp: 0.02,
  speechBubbleLocalY: 1.25,
  forcedChaseSpeed: CHASE_SPEED,
  catchRadius: 1.5,

  build(ctx) {
    buildToon(ctx, {
      key: "anim", scale: SCALE, body: 0x0d0d0d, face: "animation", coat: null,
      hat: "top", hatColor: 0x161616, limbs: 0.85,
    });
  },

  animate(ctx) {
    // Twelve poses a second, like the old shorts.
    animateToon(ctx, 12, ctx.chasing ? 1.4 : 1);
  },

  sense(ctx) {
    // scratch: 0 calm; otherwise chasing, 1 + seconds since they last saw you.
    if (ctx.targetHidden) return { chasing: false, speed: PATROL_SPEED, agitated: false, scratch: 0 };
    const d = ctx.distanceMeters;
    const seen = d < FEEL_RANGE || (d < sightRange(ctx.playerState, !!ctx.isFlashlightOn)
      && townSightClear(ctx.entityPos.x, ctx.entityPos.z, ctx.playerX, ctx.playerZ, (x, z) => ctx.map.checkCollision(x, z, 0.08)));
    let scratch = ctx.scratch;
    if (seen) scratch = 1;
    else if (scratch > 0) scratch += ctx.delta;
    if (scratch > 1 + LOSE_SECONDS) scratch = 0;
    return scratch > 0
      ? { chasing: true, speed: CHASE_SPEED, agitated: true, scratch }
      : { chasing: false, speed: PATROL_SPEED, agitated: false, scratch: 0 };
  },

  speech(ctx) {
    if (ctx.distanceMeters > 16) return { key: "" };
    const r = ctx.random();
    if (ctx.isAgitated) return { key: r < 0.5 ? `mob.anim.chase.${Math.floor(r * 8)}` : "" };
    return { key: r < 0.25 ? `mob.anim.calm.${Math.floor(r * 8)}` : "" };
  },

  radar: { color: "#e5e5e5", strokeColor: "#fafafa", labelKey: "radar.animation" },
};
