/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { ProceduralMap } from "./ProceduralMap";
import { isTypingInField } from "../utils/input";

/**
 * Eye height (`position.y`) while standing/crouching. Shared with GameEngine
 * so remote player visuals can convert the eye-height Y broadcast over the
 * network back into a floor-level Y for the hazmat model.
 */
export const PLAYER_STANDING_HEIGHT = 1.6;
export const PLAYER_CROUCH_HEIGHT = 0.95;

export class PlayerController {
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private map: ProceduralMap;

  // Movement speed configuration (meters per second)
  private walkSpeed = 2.4;
  private runSpeed = 4.2;
  private crouchSpeed = 1.3;

  // Stamina parameters
  public maxStamina = 1.0; // 0.0 to 1.0 representation
  public stamina = 1.0;
  private staminaDrainRate = 0.28; // drains dry in ~3.5 seconds of full sprinting
  private staminaRegenRate = 0.16; // recharges completely in ~6 seconds

  // Controller states
  public isLocked = false;
  public isOverrideActive = false;
  private isDragging = false;
  private prevMouseX = 0;
  private prevMouseY = 0;
  public position = new THREE.Vector3(10, 1.6, 10); // Start spawn point
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

  // Input states
  private keys: { [key: string]: boolean } = {};
  private verticalVelocity = 0;
  private moveDirection = new THREE.Vector3();
  private mouseSensitivity = 0.0022;

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
  }

  private initEvents() {
    this.domElement.addEventListener("click", this.requestLock);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  public removeEvents() {
    this.domElement.removeEventListener("click", this.requestLock);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private requestLock = () => {
    if (!this.isLocked && !this.isOverrideActive) {
      this.domElement.requestPointerLock();
    }
  };

  private onLockChange = () => {
    this.isLocked = document.pointerLockElement === this.domElement;
    if (this.isLocked) {
      this.isOverrideActive = false;
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.isLocked) return;
    this.isDragging = true;
    this.prevMouseX = e.clientX;
    this.prevMouseY = e.clientY;
  };

  private onMouseUp = () => {
    this.isDragging = false;
  };

  private onMouseMove = (e: MouseEvent) => {
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
    this.keys[key] = true;

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

  public getMoveDirection(): THREE.Vector3 {
    return this.moveDirection;
  }

  /**
   * Spawns the player on a safe cell coordinates which is not solid.
   */
  public spawnSafely() {
    const startX = 2;
    const startZ = 2;
    const cSize = this.map.cellSize;
    
    // Position center of that start tile
    this.position.set(startX * cSize + cSize / 2, 1.6, startZ * cSize + cSize / 2);
    this.rotation.set(0, -Math.PI / 4, 0); // diagonal spawn perspective look
    this.stamina = 1.0;
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

    // 2. STAMINA MANAGEMENT
    if (this.state === "running") {
      this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * dt);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * dt);
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

    this.position.x += strideX;
    if (this.map.checkCollision(this.position.x, originalZ, playerRadius)) {
      this.position.x = originalX; // undo X translation due to wall impact
    }

    // Test Z Axis position change
    this.position.z += strideZ;
    if (this.map.checkCollision(this.position.x, this.position.z, playerRadius)) {
      this.position.z = originalZ; // undo Z translation due to wall impact
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
    this.position.y = this.currentHeight + this.jumpOffset;

    // 6. HEAD BOBBING & PHYSICAL WEAVE EFFECTS WITH DYNAMIC BREATHING SWAYS
    let bobX = 0;
    let bobY = 0;

    if (wantsMove) {
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

    // Dynamic, continuous visual 'breathing' sway
    // Stamina level directly controls the speed (frequency) and breadth (amplitude) of the breathing movement
    const staminaFactor = 1.0 - this.stamina; // 0.0 at full, 1.0 at depleted
    const breatheFrequency = 1.8 + staminaFactor * 3.7; // From 1.8 rad/s (calm) up to 5.5 rad/s (panting)
    this.breathingTime += dt * breatheFrequency;

    // Amplitude scale based on exhaustion tension
    const breatheAmpY = 0.012 + staminaFactor * 0.048; // vertical shift
    const breatheAmpX = 0.006 + staminaFactor * 0.024; // horizontal shift
    const breatheRoll = (0.003 + staminaFactor * 0.022) * Math.sin(this.breathingTime * 0.8); // local camera roll tilt
    const breathePitch = (0.002 + staminaFactor * 0.012) * Math.sin(this.breathingTime); // local camera pitch tilt

    const breatheX = Math.cos(this.breathingTime * 0.5) * breatheAmpX;
    const breatheY = Math.sin(this.breathingTime) * breatheAmpY;

    // Combine physical movement bobbing with local breathing displacement
    const targetCamX = (wantsMove ? bobX : this.camera.position.x * 0.9) + breatheX;
    const targetCamY = (wantsMove ? bobY : this.camera.position.y * 0.9) + breatheY;

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
