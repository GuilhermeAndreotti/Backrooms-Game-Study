/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pose helpers for MobDefinition.animate(). Every helper sets joint
 * transforms absolutely (never accumulates), so a frame fully describes the
 * pose and nothing drifts; resetRig() only matters when a pooled mob is
 * reused.
 *
 * Sign conventions (joints hang limbs along -Y, the face looks along +Z):
 * - a hip/shoulder rotation.x < 0 swings the limb FORWARD;
 * - a knee rotation.x > 0 folds the shin back, an elbow rotation.x < 0
 *   brings the hand forward;
 * - a spine rotation.x > 0 leans the torso forward; a head rotation.x < 0
 *   looks up.
 */

import * as THREE from "three";
import { MobAnimCtx, MobJoints } from "./types";

type J = THREE.Object3D | undefined;

export function rx(j: J, x: number) { if (j) j.rotation.x = x; }
export function rot(j: J, x: number, y: number, z: number) { if (j) j.rotation.set(x, y, z); }

/** Joint back to its build-time position with no rotation/scale (pool reuse). */
export function resetRig(joints: MobJoints) {
  for (const name in joints) {
    const j = joints[name];
    j.rotation.set(0, 0, 0);
    j.scale.set(1, 1, 1);
    const rest = j.userData.rest as THREE.Vector3 | undefined;
    if (rest) j.position.copy(rest);
  }
}

/** Offsets a joint from its build-time position. */
export function offset(j: J, x: number, y: number, z: number) {
  if (!j) return;
  const rest = j.userData.rest as THREE.Vector3 | undefined;
  if (rest) j.position.set(rest.x + x, rest.y + y, rest.z + z);
}

/** Head tracking toward the player (plus an idle glance around while it isn't looking). */
export function lookAtPlayer(ctx: MobAnimCtx, head: J, reach = 1, idleGlance = 0.35) {
  if (!head) return;
  const glance = Math.sin(ctx.time * 0.37) * idleGlance * (1 - ctx.look) * (1 - ctx.move * 0.6);
  head.rotation.y = ctx.lookYaw * ctx.look * reach + glance;
  head.rotation.x = -ctx.lookPitch * ctx.look * reach;
  // Slow, uncanny head tilt while it stands there staring.
  head.rotation.z = Math.sin(ctx.time * 0.55) * 0.18 * ctx.observe;
}

export interface BipedStyle {
  /** Hip swing at a full walk (rad). */
  stride: number;
  /** Arm swing at a full walk (rad). */
  armSwing: number;
  /** Knee fold during the swing phase (rad). */
  knee: number;
  /** Elbow bend at rest (rad); running adds more. */
  elbow: number;
  /** Forward torso lean at a full run (rad). */
  lean: number;
  /** Vertical body bounce per step (m). */
  bounce: number;
  /** Idle breathing amplitude (rad on the spine). */
  breathe: number;
  /** Arms held forward while chasing/agitated (rad, reaching). */
  reach?: number;
  /** Multiplier on head tracking. */
  headReach?: number;
}

/**
 * A two-legged gait over the standard joint names: spine, head, jaw,
 * armL/foreL, armR/foreR, legL/shinL, legR/shinR (any may be missing).
 */
export function animateBiped(ctx: MobAnimCtx, s: BipedStyle) {
  const j = ctx.joints;
  const { move, run, observe, phase, time } = ctx;
  const gait = move * (1 + run * 0.7);
  const sin = Math.sin(phase);
  const cos = Math.cos(phase);

  // Legs: opposite swings; the knee folds while the leg travels forward.
  const stride = s.stride * gait;
  rx(j.legL, -sin * stride);
  rx(j.legR, sin * stride);
  rx(j.shinL, Math.max(0, cos) * s.knee * gait);
  rx(j.shinR, Math.max(0, -cos) * s.knee * gait);

  // Arms: counter-swing to the legs, elbows bend more when running.
  const reach = (s.reach ?? 0) * (ctx.chasing || ctx.agitated ? 1 : 0) * move;
  const swing = s.armSwing * gait;
  const breath = Math.sin(time * 1.7) * s.breathe;
  // z flares the hand outward: -z for the left arm (at -X), +z for the right.
  rot(j.armL, sin * swing - reach + breath * 0.5, 0, -0.05 - breath * 0.4);
  rot(j.armR, -sin * swing - reach + breath * 0.5, 0, 0.05 + breath * 0.4);
  rx(j.foreL, -(s.elbow + run * move * 0.7));
  rx(j.foreR, -(s.elbow + run * move * 0.7));

  // Torso: running lean, shoulder counter-twist, breathing, a lean toward
  // the player while observing.
  if (j.spine) {
    j.spine.rotation.x = s.lean * run * move + breath + observe * 0.1;
    j.spine.rotation.y = sin * 0.12 * gait;
    j.spine.rotation.z = Math.sin(time * 0.8) * 0.03 * (1 - move);
  }

  // Two bounces per stride cycle.
  ctx.body.position.y = Math.abs(sin) * s.bounce * gait - s.bounce * 0.5 * gait;

  lookAtPlayer(ctx, j.head, s.headReach ?? 1);
  // Jaw hangs open while running / agitated.
  rx(j.jaw, (ctx.agitated || ctx.chasing ? 0.35 : 0.05) * (0.5 + 0.5 * Math.sin(time * 9)) + run * move * 0.2);
}

export interface QuadStyle {
  stride: number;
  knee: number;
  bounce: number;
  breathe: number;
}

/**
 * A four-legged trot/gallop over legFL/shinFL, legFR/shinFR, legBL/shinBL,
 * legBR/shinBR, spine, head, jaw, tail/tail2.
 */
export function animateQuadruped(ctx: MobAnimCtx, s: QuadStyle) {
  const j = ctx.joints;
  const { move, run, phase, time } = ctx;
  const gait = move * (1 + run * 0.8);
  const stride = s.stride * gait;
  // Trot (diagonal pairs) blending into a gallop (front pair / back pair) as it runs.
  const gallop = run * move;
  const legPhase = (base: number, gallopOffset: number) => phase + base * (1 - gallop) + gallopOffset * gallop;
  const legs: [string, string, number, number][] = [
    ["legFL", "shinFL", 0, 0],
    ["legBR", "shinBR", 0, Math.PI * 0.9],
    ["legFR", "shinFR", Math.PI, 0.35],
    ["legBL", "shinBL", Math.PI, Math.PI * 0.9 + 0.35],
  ];
  for (const [leg, shin, base, gal] of legs) {
    const p = legPhase(base, gal);
    rx(j[leg], -Math.sin(p) * stride);
    rx(j[shin], Math.max(0, Math.cos(p)) * s.knee * gait);
  }

  const breath = Math.sin(time * 2.2) * s.breathe;
  if (j.spine) {
    // Galloping: the back flexes; idling: breathing.
    j.spine.rotation.x = Math.sin(phase * 2) * 0.08 * gallop + breath;
    j.spine.rotation.z = Math.sin(phase) * 0.05 * gait;
  }
  ctx.body.position.y = Math.abs(Math.sin(phase)) * s.bounce * gait;
  ctx.body.rotation.x = Math.sin(phase * 2) * 0.05 * gait;

  // Head: tracks the player; sniffs the floor while idling alone.
  const sniff = (1 - move) * (1 - ctx.look) * Math.max(0, Math.sin(time * 0.6)) * 0.45;
  lookAtPlayer(ctx, j.head, 1, 0.3);
  if (j.head) j.head.rotation.x += sniff + Math.sin(time * 14) * 0.03 * sniff;
  rx(j.jaw, (ctx.chasing || ctx.agitated ? 0.45 : 0.08) * (0.6 + 0.4 * Math.sin(time * 11)) + run * move * 0.15);

  // Tail: wags slowly when calm, streams out behind while running.
  if (j.tail) j.tail.rotation.set(0.5 - run * move * 0.4, Math.sin(time * (2 + gait * 6)) * 0.35, 0);
  if (j.tail2) j.tail2.rotation.set(0.3 - run * move * 0.3, Math.sin(time * (2 + gait * 6) - 0.8) * 0.4, 0);
}
