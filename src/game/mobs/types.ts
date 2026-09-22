/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The data-driven mob registry's shape. WanderingEntity.ts owns all runtime
 * state (pooling, grid/transition state machine, net-state (de)serialization,
 * BFS pathing) and calls into a MobDefinition for the parts that differ per
 * EntityType: body geometry, base stats, and sensing/speech logic.
 *
 * `build()`/`sense()`/`speech()` are moved VERBATIM from the old per-type
 * switch/if-chains in WanderingEntity.ts, not reinterpreted — see the git
 * history for src/game/WanderingEntity.ts for the pre-migration originals.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";

export type PlayerMoveState = "idle" | "walking" | "running" | "crouching";

// ---------------------------------------------------------------------------
// build()
// ---------------------------------------------------------------------------

/**
 * Everything a mob's build() needs, without exposing WanderingEntity's
 * private geometry/material caches directly. Constructed by WanderingEntity
 * (bound closures over its own private `sgeo`/`smat`/etc.), so the caches
 * stay private and shared class-wide across every live instance — the whole
 * point of them (40+ concurrent monsters of one type must not duplicate GPU
 * buffers). The lobby's SKIN cheat (WanderingEntity.buildSkinMesh) builds
 * this same ctx from a bare `Object.create`'d instance, which is why these
 * closures must not depend on constructor-initialized state beyond the
 * per-instance scratch fields (`tintMaterials` etc.) they write into.
 */
export interface MobBuildCtx {
  group: THREE.Group;
  /** Cached-by-key geometry, shared class-wide across every instance of any type. */
  sgeo<T extends THREE.BufferGeometry>(key: string, build: () => T): T;
  /** Cached-by-key material, shared class-wide across every instance of any type. */
  smat<T extends THREE.Material>(key: string, build: () => T): T;
  /** A tapered limb/spike mesh running from world-local point `a` to `b`. */
  limbBetween(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, taper?: number): THREE.Mesh;
  V(x: number, y: number, z: number): THREE.Vector3;
  /** Registers a per-instance material whose colour/emissive changes with AI state (agitation, chase). */
  addTintMaterial(m: THREE.MeshStandardMaterial): void;
  /** Skin-Stealer's calm (black) vs hostile (red) eye groups — only one visible at a time, toggled by updateVisual(). */
  setCalmHostileEyes(calm: THREE.Object3D, hostile: THREE.Object3D): void;
  /** Finger King's eye material, retinted red by updateVisual() while hunting/chasing. */
  setKingEyeMaterial(m: THREE.MeshStandardMaterial): void;
}

// ---------------------------------------------------------------------------
// sense() / speech()
// ---------------------------------------------------------------------------

/**
 * Per-frame inputs to a mob's sense()/speech(). Built once per frame by
 * WanderingEntity.update() and passed to whichever of the two runs.
 *
 * `isAgitated` and `scratch` are READ-ONLY snapshots of the entity's current
 * state, not live accessors — sense()/speech() are pure functions of ctx that
 * return their desired next state via MobSenseResult/MobSpeechResult, which
 * WanderingEntity then applies. This is deliberate: the pre-migration code
 * had SKIN_STEALER's speech block mutate `isAgitated` as a side effect
 * picked up later, in the same frame, by the separately-run sensing block —
 * an easy-to-miss coupling during a verbatim code move. Modelling both as
 * pure functions with explicit return values makes that coupling impossible
 * to silently drop.
 */
export interface MobSenseCtx {
  delta: number;
  distanceMeters: number;
  playerState: PlayerMoveState;
  /** Player's look direction (world space, normalized), when known. */
  cameraDir?: THREE.Vector3;
  /** Player's world XZ (ground position, not eye height) — see entityPos doc for why raw coords are exposed rather than a precomputed vector. */
  playerX: number;
  playerZ: number;
  /** This entity's current world position (mesh.position) — for gaze-direction math (HOUND, Observador each build their own direction vector from this + playerX/Z, at their own assumed eye height, matching the pre-migration code exactly). */
  entityPos: THREE.Vector3;
  isFlashlightOn?: boolean;
  /** True on levels where every mob force-chases (2 and 3 today) — sense() is not called in that case, but forcedChaseSpeed is read instead. Exposed here for mobs whose speech() wants to know. */
  levelForcedChase: boolean;
  /** Finger-King-only elsewhere 0/false; carried generically so future mobs can reuse the same ramp. */
  aggression: number;
  hunting: boolean;
  targetHidden: boolean;
  /** Current value going into this frame (see class doc above: read-only). */
  isAgitated: boolean;
  /**
   * isChasing as of the END of the PREVIOUS frame's sense() call — speech()
   * runs before this frame's sense() (matching the pre-migration execution
   * order, where the speech block ran before the sensing block within the
   * same update()), so this is deliberately one frame stale when read from
   * speech(). sense() itself computes and returns the current frame's value
   * fresh; it should not need to read this field.
   */
  isChasing: boolean;
  /** Generic persistent scalar (e.g. HOUND's gaze-freeze timer) going into this frame — see MobSenseResult.scratch. */
  scratch: number;
}

export interface MobSenseResult {
  chasing: boolean;
  speed: number;
  /** Omit to leave isAgitated unchanged this frame. */
  agitated?: boolean;
  /** New value for ctx.scratch on the next frame; omit to leave unchanged. */
  scratch?: number;
}

export interface MobSpeechResult {
  /** i18n key for the speech bubble, or "" for none. */
  key: string;
  /** Omit to leave isAgitated unchanged (see MobSenseCtx doc: this is how SKIN_STEALER's reveal is expressed). */
  agitated?: boolean;
}

// ---------------------------------------------------------------------------
// updateVisual()
// ---------------------------------------------------------------------------

/** Mutable references to the per-instance visual bits set up by build(); updateVisual() mutates them in place. */
export interface MobVisualCtx {
  isAgitated: boolean;
  isChasing: boolean;
  hunting: boolean;
  calmEyes: THREE.Object3D | null;
  hostileEyes: THREE.Object3D | null;
  tintMaterials: THREE.MeshStandardMaterial[];
  kingEyeMaterial: THREE.MeshStandardMaterial | null;
}

// ---------------------------------------------------------------------------
// MobDefinition
// ---------------------------------------------------------------------------

export interface MobDefinition {
  type: EntityType;
  /** m/s, before any level/agitation override. */
  baseSpeed: number;
  /** Local-origin height above the floor the body is centred at (was duplicated across syncWorldPosition/animate/skinAnchorY). */
  baseHeight: number;
  bobFreq: number;
  bobAmp: number;
  /** How high above baseHeight the speech bubble floats. */
  speechBubbleLocalY: number;
  /** m/s on levels where every mob force-chases (2 and 3 today). */
  forcedChaseSpeed: number;

  build(ctx: MobBuildCtx): void;
  sense(ctx: MobSenseCtx): MobSenseResult;
  /** Only mobs with a speech-bubble pattern need this (all 6 current types do). */
  speech?(ctx: MobSenseCtx): MobSpeechResult;
  /** Only mobs whose 3D look reacts to AI state beyond bob/scale need this (SKIN_STEALER, FINGER_KING today). */
  updateVisual?(ctx: MobVisualCtx): void;

  /** Radar HUD identity. */
  radar: { color: string; strokeColor: string; labelKey: string };
}
