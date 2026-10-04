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
import { NoiseBus } from "../systems/noiseBus";
import { VisitTracker } from "../systems/visitTracker";
import { ProceduralMap } from "../ProceduralMap";

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

  // --- Rig (see animate()) ------------------------------------------------
  // Every coordinate below is in BODY space (the same space `group` and
  // limbBetween use), whatever the parent: the ctx converts it into the
  // parent joint's local space. Joints carry no rotation at build time, so
  // a whole body can be laid out in one coordinate system and then animated
  // by rotating pivots. Convention: +Z is forward (the face), +Y up.
  /** Joints created so far, by name — what animate() receives. */
  readonly joints: MobJoints;
  /** A named pivot at body-space (x, y, z), parented to `parent` (the body root when omitted). */
  joint(name: string, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Group;
  /** limbBetween with body-space endpoints, parented to `joint` so it moves with it. */
  limbIn(joint: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, taper?: number): THREE.Mesh;
  /** Parents `obj` (positioned in body space) to `joint`, keeping where it sits. */
  put<T extends THREE.Object3D>(joint: THREE.Object3D, obj: T): T;
}

/** A mob's animatable pivots, by name (see MobBuildCtx.joint). */
export type MobJoints = Record<string, THREE.Group>;

// ---------------------------------------------------------------------------
// animate()
// ---------------------------------------------------------------------------

/**
 * Per-frame inputs to a mob's animate(). Purely visual and local: nothing
 * here feeds back into the AI or the replicated state, so the authority and
 * the replicas can each animate from what they already know.
 *
 * The four weights are smoothed 0..1 blends (never snap), so a mob that
 * stops, starts chasing or notices the player eases between poses.
 */
export interface MobAnimCtx {
  joints: MobJoints;
  /** The body root below the viewer/heading-facing mesh — for whole-body bounce, lean and squash. */
  body: THREE.Group;
  /** Seconds since spawn. */
  time: number;
  delta: number;
  /** Stride phase in radians: advances with ground speed, so feet keep pace with the motion. */
  phase: number;
  /** 0 standing .. 1 walking. */
  move: number;
  /** 0 walking .. 1 running (only meaningful while move > 0). */
  run: number;
  /** 0 .. 1: stopped close to the player and staring at them. */
  observe: number;
  /** 0 .. 1: how much the head should track the player. */
  look: number;
  /** Where the player is relative to the body's forward, in radians (already clamped to a neck's reach). */
  lookYaw: number;
  lookPitch: number;
  agitated: boolean;
  chasing: boolean;
  /** Replicated scripted pose (see MobSenseResult.pose); 0 = none. */
  pose: number;
  /** Seconds since `pose` last changed (local). */
  poseTime: number;
  /** Seconds since it last switched from calm to chasing (local; large when it never has). */
  alertTime: number;
  /** Seconds since it last stopped walking (0 while it walks). */
  stillTime: number;
  /** 0 .. 1: local-only "it has you" lunge, driven by GameEngine's catch sequence. */
  grab: number;
  /** Stable per-entity number for de-synchronising idle tics between instances. */
  seed: number;
}

/** MobAnimCtx's scripted-pose inputs for rigs driven outside WanderingEntity (skins, NPCs). */
export const NO_SCRIPTED_POSE = { pose: 0, poseTime: 0, alertTime: 99, stillTime: 0, grab: 0, seed: 0 } as const;

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
  /** Stable per-entity random source owned by the world authority. */
  random: () => number;
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
  /** Whether the entity's current grid cell is CellType.SOLID (DULLER regularly noclips through walls). */
  inSolidCell: boolean;
  isFlashlightOn?: boolean;
  /** True on levels where every mob force-chases (2 and secret Level 6) — sense() is not called in that case, but forcedChaseSpeed is read instead. */
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
  /** The level's map — for mobs that need spatial queries (A Sombra's light-query helpers, grid/cell lookups). */
  map: ProceduralMap;
  /** O Eco's noise-event feed. Null until GameEngine wires it onto the map (always populated once the game is running). */
  noiseBus: NoiseBus | null;
  /** O Ceifador's route-memory. Null until GameEngine wires it onto the map (always populated once the game is running). */
  visitTracker: VisitTracker | null;
}

export interface MobSenseResult {
  chasing: boolean;
  speed: number;
  /** Omit to leave isAgitated unchanged this frame. */
  agitated?: boolean;
  /** New value for ctx.scratch on the next frame; omit to leave unchanged. */
  scratch?: number;
  /**
   * Scripted pose streamed to every client (EntityNetState.k) so a moment
   * like the Finger King's stare reads the same for everyone. 0..7, 0 = none;
   * omitted means 0.
   */
  pose?: number;
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
  /** m/s on levels where every mob force-chases (2 and secret Level 6). */
  forcedChaseSpeed: number;
  /** SKIN_STEALER also flips agitated (its "mask slipped" reveal) the moment forced-chase kicks in. */
  forcedChaseAgitated?: boolean;

  build(ctx: MobBuildCtx): void;
  sense(ctx: MobSenseCtx): MobSenseResult;
  /** Only mobs with a speech-bubble pattern need this (all 6 current types do). */
  speech?(ctx: MobSenseCtx): MobSpeechResult;
  /** Only mobs whose 3D look reacts to AI state beyond bob/scale need this (SKIN_STEALER, FINGER_KING today). */
  updateVisual?(ctx: MobVisualCtx): void;

  /** Poses the rig built by build() for this frame: idle / walk / run / observe (see MobAnimCtx). */
  animate(ctx: MobAnimCtx): void;
  /** Meters covered per full stride cycle (two steps) — sets how fast `phase` turns. */
  strideLength: number;
  /** Footfall loudness/heaviness 0..1 (0 = no footsteps: it floats); defaults to 0.5. */
  stepWeight?: number;
  /** Always turns its whole body to face the player instead of its walking direction (watchers). */
  facesViewer?: boolean;
  /**
   * While calm (not chasing or agitated) it neither turns nor looks toward the
   * player, so a patrol never reads as following anyone (O Alien).
   */
  calmIgnoresViewer?: boolean;
  /** How close (metres) it has to get to catch someone; 1.45 when unset. */
  catchRadius?: number;

  /** Radar HUD identity. */
  radar: { color: string; strokeColor: string; labelKey: string };
}
