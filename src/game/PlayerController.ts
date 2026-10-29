/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { ProceduralMap } from "./ProceduralMap";
import { GAME_KEYS, isTypingInField, lockGameInput } from "../utils/input";
import { PoolLadder, poolLadderFrom } from "./levels/poolLayout";

/**
 * Eye height (`position.y`) while standing/crouching. Shared with GameEngine
 * so remote player visuals can convert the eye-height Y broadcast over the
 * network back into a floor-level Y for the hazmat model.
 */
// The hazmat visor center is at 1.33m above the floor. Keep the first-person
// viewpoint and replicated player positions aligned with that actual eye line.
export const PLAYER_STANDING_HEIGHT = 1.33;
export const PLAYER_CROUCH_HEIGHT = 1.13;

/** Everyone's pace on foot, cheats aside (the speed cheat multiplies on top of it). */
const BASE_SPEED_SCALE = 1.2;

/** How high a ledge you step onto without jumping (m) — the lip of a pool, a stair step. */
const STEP_UP = 0.56;
/** A drop deeper than this is a fall (you leave the ground), not a step down. */
const FALL_DROP = 0.65;
/** Pulling yourself out of the water: how far above the surface a ledge can be. */
const HOIST_UP = 0.5;
/** Swimming speeds (m/s) at the surface and under it, before sprinting. */
const SWIM_SPEED = 2.2;
const DIVE_SPEED = 1.9;
const CLIMB_SPEED = 1.45;

/** Something the body did in the Poolrooms' water or on its structures (sound, ripples, noise for the Vigia). */
export type PlayerBodyEvent = "stroke" | "dive" | "surface" | "splash" | "land" | "climb" | "hoist";

export class PlayerController {
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private map: ProceduralMap;

  // Movement speed configuration (meters per second), all scaled by BASE_SPEED_SCALE.
  private walkSpeed = 2.4 * BASE_SPEED_SCALE;
  private runSpeed = 4.8 * BASE_SPEED_SCALE;
  private crouchSpeed = 1.3 * BASE_SPEED_SCALE;

  // Stamina parameters
  public maxStamina = 1.0; // 0.0 to 1.0 representation
  public stamina = 1.0;
  /** 0..1 multiplier on stamina regen; the engine lowers it as sanity falls. */
  public staminaRegenScale = 1.0;
  private staminaDrainRate = 0.28; // drains dry in ~3.5 seconds of full sprinting
  private staminaRegenRate = 0.16; // recharges completely in ~6 seconds

  // Controller states
  public isLocked = false;
  public isOverrideActive = false;
  public isSpectating = false;
  private isDragging = false;
  private prevMouseX = 0;
  private prevMouseY = 0;
  public position = new THREE.Vector3(10, PLAYER_STANDING_HEIGHT, 10); // Start spawn point
  public rotation = new THREE.Euler(0, 0, 0, "YXZ"); // pitch, yaw, roll
  public isFlashlightOn = false;
  public state: 'idle' | 'walking' | 'running' | 'crouching' = 'idle';

  // Loading and movement states
  public mapFullyLoaded = false;

  // Jumping kinematics ("ficar pulando sem parar")
  public jumpOffset = 0;
  public jumpVelocity = 0;
  private gravity = 15.0;
  public spacePressCount = 0;
  /** Horizontal velocity of the last frame (m/s), for kicking the lobby ball. */
  public velX = 0;
  public velZ = 0;

  // --- Lobby cheat codes (see GameEngine.submitCheatCode) ------------------
  /** MVJM: 120% faster on foot, in every state (walk/run/crouch). */
  public speedCheat = false;
  /** UHUM: stamina never drains. */
  public infiniteStaminaCheat = false;
  /** Liquid Pain adrenaline: seconds left of undrained stamina and a slightly faster sprint. */
  public adrenalineTimer = 0;
  /** CLIP: holding V phases through walls while unlocked. */
  public clipCheat = false;
  /** True this frame while CLIP is unlocked and held — GameHUD shows it. */
  public isNoclipping = false;

  // Input states
  private keys: { [key: string]: boolean } = {};
  private verticalVelocity = 0;
  private moveDirection = new THREE.Vector3();
  private mouseSensitivity = 0.0022;

  /**
   * Elevation (metres) of the floor under the player, smoothed toward
   * `map.getFloorHeightAt()`. 0 everywhere except Level 1's stacked sectors
   * and ramps, where it makes climbing feel continuous even though the
   * underlying geometry is stepped.
   */
  private floorY = 0;

  // Camera bobbing configuration
  private bobTime = 0;
  private bobFrequency = 14; // steps pace
  private bobAmplitude = 0.04;
  private baseHeight = PLAYER_STANDING_HEIGHT;
  private currentHeight = PLAYER_STANDING_HEIGHT;

  // New breathing effect timer
  private breathingTime = 0;

  // Footstep timing variables
  private footstepTimer = 0;
  private onPlayFootstep: (speed: 'walk' | 'run' | 'crouch') => void;

  // --- The Poolrooms' body: climbing, falling and swimming ------------------
  // Only used where the map has real vertical terrain (map.verticalTerrain);
  // every other level keeps the floor-following model above.
  /** Feet height (world Y) while on vertical terrain. */
  public footY = 0;
  private vy = 0;
  private grounded = true;
  /** Highest point of the current fall, for its landing. */
  private fallTopY = 0;
  /** Deep water: the eye moves freely between the bottom and the surface. */
  public swimming = false;
  /** The eye is under the surface. */
  public submerged = false;
  /** Water surface at the player's position, or null (dry). */
  public waterSurface: number | null = null;
  /** The ladder being climbed, if any. */
  public climbing: PoolLadder | null = null;
  private strokeTimer = 0;
  private climbSoundTimer = 0;
  /** Callback for PlayerBodyEvent (strength 0..1.5, or metres fallen for "land"). */
  public onBodyEvent: ((kind: PlayerBodyEvent, strength: number) => void) | null = null;

  constructor(
    camera: THREE.Camera, 
    domElement: HTMLElement, 
    map: ProceduralMap,
    onPlayFootstep: (speed: 'walk' | 'run' | 'crouch') => void
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.map = map;
    this.onPlayFootstep = onPlayFootstep;

    this.initEvents();
    // Level transitions replace the controller while the canvas can remain
    // pointer-locked, so no new pointerlockchange event is guaranteed.
    this.onLockChange();
  }

  private initEvents() {
    this.domElement.addEventListener("click", this.requestLock);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseKeys);
  }

  public removeEvents() {
    this.domElement.removeEventListener("click", this.requestLock);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.releaseKeys);
  }

  /**
   * Alt-tabbing (or any focus loss) while holding a key swallows its keyup,
   * which left the explorer walking/sprinting on their own once back.
   */
  private releaseKeys = () => {
    this.keys = {};
    this.isDragging = false;
  };

  private requestLock = () => {
    if (!this.isSpectating && !this.isLocked && !this.isOverrideActive) {
      lockGameInput(this.domElement);
    }
  };

  private onLockChange = () => {
    this.isLocked = document.pointerLockElement === this.domElement;
    if (this.isLocked) {
      this.isOverrideActive = false;
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.isSpectating || this.isLocked) return;
    this.isDragging = true;
    this.prevMouseX = e.clientX;
    this.prevMouseY = e.clientY;
  };

  private onMouseUp = () => {
    this.isDragging = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.isSpectating) return;
    if (this.isLocked) {
      // Pitch (Y rotation look up/down) and Yaw (X rotation look left/right)
      this.rotation.y -= e.movementX * this.mouseSensitivity;
      this.rotation.x -= e.movementY * this.mouseSensitivity;
      this.rotation.x = Math.max(-Math.PI / 2.05, Math.min(Math.PI / 2.05, this.rotation.x));
    } else if (this.isOverrideActive && this.isDragging) {
      const movementX = e.clientX - this.prevMouseX;
      const movementY = e.clientY - this.prevMouseY;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;

      // Pitch (Y rotation look up/down) and Yaw (X rotation look left/right)
      this.rotation.y -= movementX * this.mouseSensitivity * 1.5;
      this.rotation.x -= movementY * this.mouseSensitivity * 1.5;
      this.rotation.x = Math.max(-Math.PI / 2.05, Math.min(Math.PI / 2.05, this.rotation.x));
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // The chat input (and any other text field) is focused: let the browser
    // handle the keystroke as text instead of driving the player.
    if (isTypingInField()) return;

    const key = e.key.toLowerCase();
    if (this.isSpectating) return;
    this.keys[key] = true;

    // While playing, keep game keys from triggering browser shortcuts
    // (Ctrl+D bookmark, Ctrl+F find, Space scroll...). Ctrl+W itself is only
    // catchable in fullscreen + Keyboard Lock — see lockGameInput.
    if ((this.isLocked || this.isOverrideActive) && GAME_KEYS.has(key)) {
      e.preventDefault();
    }

    // Flashlight toggle key
    if (e.key === "f" || e.key === "F") {
      this.isFlashlightOn = !this.isFlashlightOn;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    // Always release, even if focus moved to a text field mid-press —
    // otherwise a key held while opening chat would look stuck on afterward.
    const key = e.key.toLowerCase();
    this.keys[key] = false;
  };

  public setMouseSensitivity(sens: number) {
    this.mouseSensitivity = sens * 0.0022; // Scale based on config
  }

  /** Disable local controls while the camera is following a teammate. */
  public setSpectating(spectating: boolean) {
    this.isSpectating = spectating;
    if (spectating) {
      this.keys = {};
      this.isDragging = false;
      if (document.pointerLockElement === this.domElement) document.exitPointerLock?.();
    }
  }

  public getMoveDirection(): THREE.Vector3 {
    return this.moveDirection;
  }

  /**
   * Spawns the player on a safe cell coordinates which is not solid.
   */
  public spawnSafely() {
    const startX = this.map.spawnGridX;
    const startZ = this.map.spawnGridZ;
    const cSize = this.map.cellSize;
    
    // Position center of that start tile
    this.floorY = this.map.getFloorHeightAt(startX * cSize + cSize / 2, startZ * cSize + cSize / 2);
    this.position.set(startX * cSize + cSize / 2, this.floorY + PLAYER_STANDING_HEIGHT, startZ * cSize + cSize / 2);
    this.rotation.set(0, -Math.PI / 4, 0); // diagonal spawn perspective look
    this.stamina = 1.0;
    this.resetBody();
  }

  /** Puts the player standing on the floor at (x, z) — a checkpoint, a rescue from the water. */
  public placeAt(x: number, z: number) {
    this.floorY = this.map.getFloorHeightAt(x, z);
    this.position.set(x, this.floorY + PLAYER_STANDING_HEIGHT, z);
    this.resetBody();
  }

  private resetBody() {
    this.footY = this.floorY;
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    this.submerged = false;
    this.climbing = null;
    this.jumpOffset = 0;
    this.jumpVelocity = 0;
  }

  /**
   * Primary frame tick updates positioning, stamina, collision, height changes, camera bobbing, and footsteps.
   */
  public update(delta: number) {
    if (!this.mapFullyLoaded) {
      this.state = "idle";
      return;
    }

    if (!this.isLocked && !this.isOverrideActive) {
      this.state = "idle";
      return;
    }

    // Limit delta time to guard against giant frame drops warping position
    const dt = Math.min(delta, 0.1);

    // 1. EVALUATE RUNNING, CROUCHING, WALKING STATUS
    const wantsMove = this.keys["w"] || this.keys["s"] || this.keys["a"] || this.keys["d"] || this.keys["arrowup"] || this.keys["arrowdown"] || this.keys["arrowleft"] || this.keys["arrowright"];
    const wantsRun = this.keys["shift"] && wantsMove && this.stamina > 0.05 && !this.keys["c"] && !this.keys["control"];
    const wantsCrouch = this.keys["c"] || this.keys["control"];

    let currentSpeed = this.walkSpeed;
    if (wantsCrouch) {
      currentSpeed = this.crouchSpeed;
      this.state = wantsMove ? "crouching" : "idle";
    } else if (wantsRun) {
      currentSpeed = this.runSpeed;
      this.state = "running";
    } else {
      this.state = wantsMove ? "walking" : "idle";
    }

    // Cheat: MVJM — flat speed multiplier, on top of whichever state applies.
    if (this.speedCheat) currentSpeed *= 2.2;

    if (this.map.verticalTerrain) {
      this.updatePoolBody(dt, wantsMove, wantsRun, wantsCrouch, currentSpeed);
      return;
    }

    // Wading through the Poolrooms' flooded cells drags at your legs.
    if (this.map.isWaterAt(this.position.x, this.position.z)) currentSpeed *= 0.72;

    if (this.adrenalineTimer > 0) {
      this.adrenalineTimer = Math.max(0, this.adrenalineTimer - dt);
      if (this.state === "running") currentSpeed *= 1.15;
    }

    // 2. STAMINA MANAGEMENT
    if (this.infiniteStaminaCheat || this.adrenalineTimer > 0) {
      // Cheat: UHUM / Liquid Pain adrenaline — never drains, regardless of state.
      this.stamina = this.maxStamina;
    } else if (this.state === "running") {
      this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * dt);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * this.staminaRegenScale * dt);
    }

    // Force walking if stamina runs dry completely
    if (this.stamina <= 0.01 && this.state === "running") {
      currentSpeed = this.walkSpeed;
      this.state = "walking";
    }

    // 3. APPLY SMOOTH FPS MOVEMENT
    this.moveDirection.set(0, 0, 0);

    // Coordinate inputs on local camera rotation
    if (this.keys["w"] || this.keys["arrowup"]) this.moveDirection.z -= 1;
    if (this.keys["s"] || this.keys["arrowdown"]) this.moveDirection.z += 1;
    if (this.keys["a"] || this.keys["arrowleft"]) this.moveDirection.x -= 1;
    if (this.keys["d"] || this.keys["arrowright"]) this.moveDirection.x += 1;

    this.moveDirection.normalize();

    // Rotate move inputs aligned to yaw look angle
    const yaw = this.rotation.y;
    const strideX = (this.moveDirection.x * Math.cos(yaw) + this.moveDirection.z * Math.sin(yaw)) * currentSpeed * dt;
    const strideZ = (this.moveDirection.z * Math.cos(yaw) - this.moveDirection.x * Math.sin(yaw)) * currentSpeed * dt;

    // 4. SLIDING WALL COLLISION - COLLIDE X AND Z SEPARATELY (PRO GLIDE COLLISION!)
    // Test X Axis position change
    const originalX = this.position.x;
    const originalZ = this.position.z;
    const playerRadius = 0.42; // slightly less than cell boundaries to fit easily through pathways

    // Cheat: CLIP — holding V phases straight through walls (no collision test at all).
    this.isNoclipping = this.clipCheat && this.keys["v"];

    this.position.x += strideX;
    if (!this.isNoclipping && this.map.checkCollision(this.position.x, originalZ, playerRadius)) {
      this.position.x = originalX; // undo X translation due to wall impact
    }

    // Test Z Axis position change
    this.position.z += strideZ;
    if (!this.isNoclipping && this.map.checkCollision(this.position.x, this.position.z, playerRadius)) {
      this.position.z = originalZ; // undo Z translation due to wall impact
    }

    this.velX = (this.position.x - originalX) / dt;
    this.velZ = (this.position.z - originalZ) / dt;
    // Pushing into a wall: no steps, no bob, no sprint drain.
    const moving = wantsMove && this.velX * this.velX + this.velZ * this.velZ > 0.04;
    // (Crouching stays crouching: teammates read it to lower the model.)
    if (!moving && (this.state === "walking" || this.state === "running")) {
      if (this.state === "running" && !this.infiniteStaminaCheat && this.adrenalineTimer <= 0) {
        this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaDrainRate * dt); // undo this frame's drain
      }
      this.state = "idle";
    }

    // 5. JUMPING SIMULATION ("pulando sem parar")
    const spacePressed = this.keys[" "];
    const isOnGround = this.jumpOffset <= 0.01;

    if (spacePressed && isOnGround && !wantsCrouch) {
      this.jumpVelocity = 4.8; // Vertical thrust force
      this.jumpOffset = 0.01;
      this.spacePressCount++; // Increment jump ticks for escaping
    }

    if (this.jumpOffset > 0) {
      this.jumpVelocity -= this.gravity * dt;
      this.jumpOffset += this.jumpVelocity * dt;
      if (this.jumpOffset <= 0) {
        this.jumpOffset = 0;
        this.jumpVelocity = 0;
      }
    }

    // 5b. SMOOTH CAMERA CROUCH TRANSITION
    const targetHeight = wantsCrouch ? PLAYER_CROUCH_HEIGHT : this.baseHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * 12 * dt;

    // 5c. FOLLOW THE FLOOR'S ELEVATION (Level 1's stacked sectors/ramps).
    // Smoothed rather than snapped so a stepped ramp still feels like a climb.
    const targetFloorY = this.map.getFloorHeightAt(this.position.x, this.position.z);
    this.floorY += (targetFloorY - this.floorY) * Math.min(1, 10 * dt);

    this.position.y = this.floorY + this.currentHeight + this.jumpOffset;

    this.updateCamera(dt, moving);
  }

  /**
   * The Poolrooms' body. Same controls, real heights: ledges higher than a
   * step need a jump, a ladder or a staircase; walking off a high block is a
   * fall; deep water is swum in (Space up, C/Ctrl down, W follows your look
   * while under), and the surface is where you breathe.
   */
  private updatePoolBody(dt: number, wantsMove: boolean, wantsRun: boolean, wantsCrouch: boolean, landSpeed: number) {
    const map = this.map;
    const x0 = this.position.x, z0 = this.position.z;
    const ground = map.getFloorHeightAt(x0, z0);
    const surface = map.waterSurfaceAt(x0, z0);
    const deep = surface !== null && surface - ground > map.swimDepth;
    // A body falling into deep water swims once its chest reaches the surface.
    const eyeNow = this.footY + this.currentHeight;
    this.swimming = !this.climbing && deep && surface !== null && eyeNow < surface + 0.4;
    this.waterSurface = surface;
    const pitch = this.rotation.x;
    const drain = !this.infiniteStaminaCheat && this.adrenalineTimer <= 0;

    // --- Climbing a ladder -------------------------------------------------
    if (!this.climbing) {
      const ladder = wantsMove && (this.keys["w"] || this.keys["arrowup"]) ? this.ladderInReach() : null;
      if (ladder) {
        this.climbing = ladder;
        this.swimming = false;
        this.grounded = false;
        this.vy = 0;
      }
    }
    if (this.climbing) {
      const l = this.climbing;
      const cs = map.cellSize;
      // Hug the rungs: half a metre off the face, centred on it.
      const faceX = (l.x + 0.5 + l.dx * 0.5) * cs - l.dx * 0.45;
      const faceZ = (l.z + 0.5 + l.dz * 0.5) * cs - l.dz * 0.45;
      const k = Math.min(1, 10 * dt);
      this.position.x += ((l.dx !== 0 ? faceX : (l.x + 0.5) * cs) - this.position.x) * k;
      this.position.z += ((l.dz !== 0 ? faceZ : (l.z + 0.5) * cs) - this.position.z) * k;
      const up = this.keys["w"] || this.keys["arrowup"] ? 1 : this.keys["s"] || this.keys["arrowdown"] ? -1 : 0;
      this.footY += up * CLIMB_SPEED * dt;
      this.climbSoundTimer -= up !== 0 ? dt : 0;
      if (up !== 0 && this.climbSoundTimer <= 0) {
        this.climbSoundTimer = 0.42;
        this.onBodyEvent?.("climb", 0.6);
      }
      this.state = up !== 0 ? "walking" : "idle";
      const bottom = map.getFloorHeightAt(this.position.x, this.position.z);
      if (this.footY >= l.top - 0.02) {
        // Over the top: step onto it.
        this.footY = l.top;
        this.position.x = (l.x + 0.5 + l.dx * 0.85) * cs;
        this.position.z = (l.z + 0.5 + l.dz * 0.85) * cs;
        this.position.x = Math.max((l.x + l.dx) * cs + 0.45, Math.min((l.x + l.dx + 1) * cs - 0.45, this.position.x));
        this.position.z = Math.max((l.z + l.dz) * cs + 0.45, Math.min((l.z + l.dz + 1) * cs - 0.45, this.position.z));
        this.climbing = null;
        this.grounded = true;
      } else if (this.keys[" "] || (up < 0 && this.footY <= Math.max(bottom, (surface ?? -99) - 1.2))) {
        // Let go (or climbed back down to the floor / into the water).
        this.climbing = null;
        this.grounded = false;
        this.fallTopY = this.footY;
        this.vy = 0;
      }
      this.velX = this.velZ = 0;
      this.position.y = this.footY + this.currentHeight;
      this.updateCamera(dt, false, 0);
      return;
    }

    // --- Horizontal movement -----------------------------------------------
    let speed = landSpeed;
    if (this.swimming) {
      speed = (this.submerged ? DIVE_SPEED : SWIM_SPEED) * BASE_SPEED_SCALE * 0.85;
      if (wantsRun) speed *= 1.45;
      if (this.speedCheat) speed *= 2.2;
    } else if (surface !== null && surface - ground > 0.05) {
      // Wading drags at your legs: Part 1's knee-deep halls as they always were, ankle-deep water less.
      speed *= map.poolPartAt(x0, z0) === 1 ? 0.72 : Math.max(0.6, 0.9 - (surface - ground) * 0.45);
    }
    if (this.adrenalineTimer > 0) {
      this.adrenalineTimer = Math.max(0, this.adrenalineTimer - dt);
      if (this.state === "running") speed *= 1.15;
    }

    if (wantsCrouch && !this.swimming) this.state = wantsMove ? "crouching" : "idle";
    else if (wantsRun) this.state = "running";
    else this.state = wantsMove ? "walking" : "idle";

    if (!drain) this.stamina = this.maxStamina;
    else if (this.state === "running") this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * dt);
    else this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * this.staminaRegenScale * dt);
    if (this.stamina <= 0.01 && this.state === "running") {
      speed = this.swimming ? speed / 1.45 : this.walkSpeed;
      this.state = "walking";
    }

    this.moveDirection.set(0, 0, 0);
    if (this.keys["w"] || this.keys["arrowup"]) this.moveDirection.z -= 1;
    if (this.keys["s"] || this.keys["arrowdown"]) this.moveDirection.z += 1;
    if (this.keys["a"] || this.keys["arrowleft"]) this.moveDirection.x -= 1;
    if (this.keys["d"] || this.keys["arrowright"]) this.moveDirection.x += 1;
    this.moveDirection.normalize();

    // Under water you swim where you look (a slight tilt doesn't count).
    let swimClimb = 0;
    let horizontal = 1;
    if (this.swimming && this.submerged && this.moveDirection.z !== 0 && Math.abs(pitch) > 0.22) {
      swimClimb = Math.sin(pitch) * -this.moveDirection.z;
      horizontal = Math.cos(pitch);
    }
    const yaw = this.rotation.y;
    const strideX = (this.moveDirection.x * Math.cos(yaw) + this.moveDirection.z * Math.sin(yaw) * horizontal) * speed * dt;
    const strideZ = (this.moveDirection.z * Math.cos(yaw) * horizontal - this.moveDirection.x * Math.sin(yaw)) * speed * dt;

    const radius = 0.42;
    this.isNoclipping = this.clipCheat && this.keys["v"];
    const eye = this.footY + this.currentHeight;
    // What you can get onto: a step on foot, a ledge just above the water when swimming at the surface.
    const atSurface = this.swimming && surface !== null && eye > surface - 0.15;
    const probeY = atSurface ? surface! : this.footY;
    const rise = atSurface ? HOIST_UP : STEP_UP;
    const blocked = (x: number, z: number) =>
      !this.isNoclipping && (map.checkCollision(x, z, radius) || map.blocksBody(x, z, radius, probeY + rise, eye + 0.14));
    // Came down beside a ledge too high to get onto (a jump that fell short, a
    // walk off a block) and the body overlaps it: every step would still
    // overlap, pinning you in the corner. Slide out to the nearest clear spot.
    if (blocked(this.position.x, this.position.z)) this.slideClear(blocked, dt);
    const sx = this.position.x, sz = this.position.z;
    this.position.x += strideX;
    if (blocked(this.position.x, sz)) this.position.x = sx;
    this.position.z += strideZ;
    if (blocked(this.position.x, this.position.z)) this.position.z = sz;
    this.velX = (this.position.x - sx) / dt;
    this.velZ = (this.position.z - sz) / dt;
    const moving = wantsMove && this.velX * this.velX + this.velZ * this.velZ > 0.04;
    if (!moving && !this.swimming && (this.state === "walking" || this.state === "running")) {
      if (this.state === "running" && drain) this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaDrainRate * dt);
      this.state = "idle";
    }

    // --- Vertical ----------------------------------------------------------
    const newGround = map.getFloorHeightAt(this.position.x, this.position.z);
    const newSurface = map.waterSurfaceAt(this.position.x, this.position.z);
    const ceiling = map.ceilingAt(this.position.x, this.position.z);
    const wasSubmerged = this.submerged;
    const targetHeight = wantsCrouch && !this.swimming ? PLAYER_CROUCH_HEIGHT : this.baseHeight;
    this.currentHeight += (targetHeight - this.currentHeight) * 12 * dt;

    if (this.swimming && newSurface !== null && newSurface - newGround > map.swimDepth) {
      // Space rises, C/Ctrl dives, otherwise you float up to the surface.
      const up = this.keys[" "] ? 1 : 0;
      const down = wantsCrouch ? 1 : 0;
      let want: number;
      if (up || down || swimClimb !== 0) want = (up - down) * 1.7 + swimClimb * speed;
      else want = eye > newSurface - 0.35 ? (newSurface + 0.1 - eye) * 3 : 0.32;
      this.vy += (want - this.vy) * Math.min(1, 5 * dt);
      let nextEye = eye + this.vy * dt;
      const top = Math.min(newSurface + 0.12, ceiling - 0.24);
      const bottom = newGround + 0.4;
      if (nextEye > top) { nextEye = top; this.vy = Math.min(0, this.vy); }
      if (nextEye < bottom) { nextEye = bottom; this.vy = Math.max(0, this.vy); }
      this.footY = nextEye - this.currentHeight;
      this.grounded = false;
      this.fallTopY = this.footY;
      // A stroke every so often you're actually moving: what the water (and the Vigia) hear.
      if (moving || Math.abs(this.vy) > 0.5) {
        this.strokeTimer -= dt * (this.state === "running" ? 1.5 : 1);
        if (this.strokeTimer <= 0) {
          this.strokeTimer = 0.85;
          this.onBodyEvent?.("stroke", this.state === "running" ? 1 : 0.55);
        }
      }
    } else {
      // On foot (or wading, or a body falling).
      if (this.grounded) {
        if (newGround < this.footY - FALL_DROP) {
          // Walked off an edge.
          this.grounded = false;
          this.fallTopY = this.footY;
          this.vy = 0;
        } else {
          this.footY += (newGround - this.footY) * Math.min(1, 14 * dt);
          if (this.keys[" "] && !wantsCrouch) {
            this.vy = 4.8;
            this.grounded = false;
            this.fallTopY = this.footY;
            this.spacePressCount++;
          }
        }
      }
      if (!this.grounded) {
        this.vy -= this.gravity * dt;
        this.footY += this.vy * dt;
        this.fallTopY = Math.max(this.fallTopY, this.footY);
        const eyeAfter = this.footY + this.currentHeight;
        if (newSurface !== null && newSurface - newGround > map.swimDepth && eyeAfter < newSurface + 0.3) {
          // Into deep water: the fall ends in a splash, and you're swimming.
          const fell = this.fallTopY - newSurface;
          if (fell > 0.3) this.onBodyEvent?.("splash", Math.min(1.5, 0.4 + fell * 0.35));
          this.vy *= 0.25;
          this.swimming = true;
        } else if (this.footY <= newGround) {
          const fell = this.fallTopY - newGround;
          this.vy = 0;
          this.grounded = true;
          if (newGround - this.footY > 0.3) {
            // Coming up from below: pulled out of the water onto a ledge (the grounded step eases it).
            this.onBodyEvent?.("hoist", 0.6);
          } else {
            this.footY = newGround;
            if (fell > 1.0) this.onBodyEvent?.("land", fell);
          }
        }
      }
    }

    const eyeY = this.footY + this.currentHeight;
    this.waterSurface = newSurface;
    this.submerged = this.swimming && newSurface !== null && eyeY < newSurface - 0.06;
    if (this.submerged && !wasSubmerged) this.onBodyEvent?.("dive", Math.min(1, Math.abs(this.vy) + 0.3));
    if (!this.submerged && wasSubmerged) this.onBodyEvent?.("surface", 1);
    this.floorY = newGround;
    this.jumpOffset = Math.max(0, this.footY - newGround);
    this.position.y = eyeY;

    // Footsteps only while actually walking on something.
    const onFoot = this.grounded && !this.swimming;
    this.updateCamera(dt, moving && onFoot, onFoot ? 1 : 0);
    if (this.swimming) {
      // A slow roll with the water instead of a walking bob.
      this.camera.position.y += Math.sin(this.breathingTime * 0.7) * 0.025;
      this.camera.rotation.z += Math.sin(this.breathingTime * 0.45) * 0.012;
    }
  }

  /** Eases the body toward the nearest position `blocked` lets it stand in (searching out to just over a body-width). */
  private slideClear(blocked: (x: number, z: number) => boolean, dt: number) {
    const x = this.position.x, z = this.position.z;
    for (let r = 0.05; r <= 0.9; r += 0.05) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
        if (blocked(cx, cz)) continue;
        const k = Math.min(1, (3.5 * dt) / r);
        this.position.x += (cx - x) * k;
        this.position.z += (cz - z) * k;
        return;
      }
    }
  }

  /** The ladder in front of you, close enough to grab and not yet climbed. */
  private ladderInReach(): PoolLadder | null {
    const cs = this.map.cellSize;
    const gx = Math.floor(this.position.x / cs), gz = Math.floor(this.position.z / cs);
    const lookX = -Math.sin(this.rotation.y), lookZ = -Math.cos(this.rotation.y);
    for (const l of poolLadderFrom(gx, gz)) {
      if (this.footY > l.top - 0.4) continue;
      if (lookX * l.dx + lookZ * l.dz < 0.5) continue;
      const edge = l.dx !== 0 ? (l.x + 0.5 + l.dx * 0.5) * cs : (l.z + 0.5 + l.dz * 0.5) * cs;
      const along = l.dx !== 0 ? this.position.x : this.position.z;
      const across = l.dx !== 0 ? this.position.z - (l.z + 0.5) * cs : this.position.x - (l.x + 0.5) * cs;
      if (Math.abs(edge - along) < 0.95 && Math.abs(across) < 1.1) return l;
    }
    return null;
  }

  /** Head bob, footsteps, the breathing sway, and seating the camera rig on the body. */
  private updateCamera(dt: number, moving: boolean, sway = 1) {
    // 6. HEAD BOBBING & PHYSICAL WEAVE EFFECTS WITH DYNAMIC BREATHING SWAYS
    let bobX = 0;
    let bobY = 0;

    if (moving && sway > 0) {
      const paceMultiplier = this.state === "running" ? 1.6 : (this.state === "crouching" ? 0.75 : 1.0);
      this.bobTime += dt * this.bobFrequency * paceMultiplier;

      // Vertical head bobbing bounce
      bobY = Math.sin(this.bobTime) * this.bobAmplitude * (this.state === "running" ? 1.4 : 0.85);
      // Lateral head swaying roll
      bobX = Math.cos(this.bobTime / 2) * this.bobAmplitude * 0.4;

      // 7. FOOTSTEPS PLAY TRIGGERING
      this.footstepTimer += dt * paceMultiplier;
      const stepInterval = this.state === "running" ? 0.26 : (this.state === "crouching" ? 0.65 : 0.42);

      if (this.footstepTimer >= stepInterval) {
        this.onPlayFootstep(this.state === "running" ? "run" : (this.state === "crouching" ? "crouch" : "walk"));
        this.footstepTimer = 0;
      }
    } else {
      this.bobTime = 0;
      this.footstepTimer = 0;
    }

    // A calm, continuous 'breathing' sway. It no longer grows with exhaustion:
    // the panting stays in the audio (AudioManager.updateBreathing), but an
    // out-of-breath camera shook too hard to be comfortable to play with.
    this.breathingTime += dt * 1.8;
    const breatheAmpY = 0.012; // vertical shift
    const breatheAmpX = 0.006; // horizontal shift
    const breatheRoll = 0.003 * Math.sin(this.breathingTime * 0.8); // local camera roll tilt
    const breathePitch = 0.002 * Math.sin(this.breathingTime); // local camera pitch tilt

    const breatheX = Math.cos(this.breathingTime * 0.5) * breatheAmpX;
    const breatheY = Math.sin(this.breathingTime) * breatheAmpY;

    // Combine physical movement bobbing with local breathing displacement
    const targetCamX = (moving ? bobX : this.camera.position.x * 0.9) + breatheX;
    const targetCamY = (moving ? bobY : this.camera.position.y * 0.9) + breatheY;

    this.camera.position.set(targetCamX, targetCamY, 0);

    // Apply subtle local camera rotations (independent of player mouse-look to remain high-fidelity)
    this.camera.rotation.z = breatheRoll;
    this.camera.rotation.x = breathePitch;
    this.camera.rotation.y = breatheX * 0.12; // tiny lateral yaw turn

    // 8. COMPOSE CAMERA FINAL ROTATION Matrix and translation coordinates
    this.camera.parent?.position.copy(this.position);
    this.camera.parent?.rotation.copy(this.rotation);
  }
}
