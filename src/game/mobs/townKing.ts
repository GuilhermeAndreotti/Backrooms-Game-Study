/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE KING (Level 94's boss): a huge rubber-hose monarch on his throne in
 * the middle of the hall, between whoever walks in and the only door out.
 *
 * Phase 1, he sits (scripted pose 1) and only his head follows you.
 * Phase 2 starts when someone comes close, runs near him, or slips past him
 * towards the door: from then on he never stops (the awake state rides on
 * the replicated `agitated` flag, so an authority handoff keeps it), slower
 * than a sprint but long-armed. Columns and tables are how you get past him:
 * he paths around them, you can squeeze beside them.
 *
 * Phase 3 (the door, the growing, the shrinking) isn't his AI at all: it's a
 * vision each explorer has on their own (see levels/townDirector.ts), during
 * which this body is hidden for them and can't catch them.
 */

import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateToon, buildToon, TOON_FEET, type ToonLook } from "../levels/townFigures";
import { KING_THRONE, cellCenter } from "../levels/townLayout";
import { lookAtPlayer, rot, rx } from "./anim";

const SCALE = 1.85;
/** His body, shared with the vision at the door (levels/townDirector.ts). */
export const KING_LOOK: ToonLook = {
  key: "king", scale: SCALE, body: 0x121212, face: "king", coat: 0x5a0f1c,
  hat: "crown", hatColor: 0xd9a830, limbs: 1.25, reach: 0.25,
};
const WAKE_RANGE = 10;
const WAKE_RUN_RANGE = 15;
const CHASE_SPEED = 3.55;
const THRONE_Z = cellCenter(KING_THRONE.gz);
/** Scripted pose: on the throne. */
export const KING_POSE_SEATED = 1;

export const townKing: MobDefinition = {
  type: EntityType.TOWN_KING,
  baseSpeed: CHASE_SPEED,
  baseHeight: TOON_FEET * SCALE,
  strideLength: 2.5,
  stepWeight: 1,
  bobFreq: 1.4, bobAmp: 0.03,
  speechBubbleLocalY: 2.4,
  forcedChaseSpeed: CHASE_SPEED,
  calmIgnoresViewer: true,
  catchRadius: 2.4,

  build(ctx) {
    buildToon(ctx, KING_LOOK);
  },

  animate(ctx) {
    if (ctx.pose === KING_POSE_SEATED) {
      // On the throne: legs down, hands on the armrests, only the head moves.
      const j = ctx.joints;
      ctx.body.position.set(0, -0.27 * SCALE, -0.12 * SCALE);
      for (const n of ["L", "R"]) {
        rx(j[`leg${n}`], -1.5);
        rx(j[`shin${n}`], 1.45);
        rot(j[`arm${n}`], -0.75, 0, n === "L" ? -0.35 : 0.35);
        rx(j[`fore${n}`], -0.55);
      }
      if (j.spine) j.spine.rotation.set(-0.08 + Math.sin(ctx.time * 0.9) * 0.015, 0, 0);
      lookAtPlayer({ ...ctx, look: 1 }, j.head, 0.7, 0);
      return;
    }
    // Awake: a lumbering stop-motion stride, arms out for you.
    animateToon(ctx, 10, 0.7);
  },

  sense(ctx) {
    const d = ctx.distanceMeters;
    const awake = ctx.isAgitated
      // Someone turned down his offer (GameEngine sets it from the level's shared fact).
      || ctx.hunting
      || d < WAKE_RANGE
      || (ctx.playerState === "running" && d < WAKE_RUN_RANGE)
      // Someone got past him: nobody leaves.
      || (d < 40 && ctx.playerZ < THRONE_Z - 3);
    return awake
      ? { chasing: true, speed: CHASE_SPEED, agitated: true, pose: 0 }
      : { chasing: false, speed: CHASE_SPEED, agitated: false, pose: KING_POSE_SEATED };
  },

  speech() {
    return { key: "" };
  },

  // Off the radar (see RadarHUD): you have to watch for him.
  radar: { color: "#d9a830", strokeColor: "#7a1424", labelKey: "radar.anomaly" },
};
