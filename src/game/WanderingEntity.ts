/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from "../i18n";
import * as THREE from "three";
import { ProceduralMap, CellType } from "./ProceduralMap";
import { EntityType } from "../shared/entityTypes";
import { MOB_DEFS } from "./mobs/registry";
import { MobBuildCtx, MobSenseCtx } from "./mobs/types";

// Re-exported for existing import sites (GameEngine.ts etc.) — the type now
// lives in src/shared/entityTypes.ts so server.ts can share it too.
export { EntityType };

/**
 * One monster's replicated state, streamed by the level's authority client
 * (see GameEngine.isWorldAuthority). Short keys: this goes out ~10x a second.
 */
export interface EntityNetState {
  id: number;
  t: EntityType;
  gx: number; gz: number; // current cell
  tx: number; tz: number; // cell being walked into
  p: number;  // progress along gx,gz -> tx,tz (0..1)
  v: number;  // move speed (m/s), for dead-reckoning between frames
  m: boolean; // moving
  a: boolean; // agitated
  c: boolean; // chasing
  s: string;  // speech bubble text
}

export class WanderingEntity {
  // Static registry of inactive entities by type to power zero-allocation object pooling
  private static entityPool: Map<EntityType, WanderingEntity[]> = new Map();

  public mesh: THREE.Group;
  public type: EntityType;
  private map: ProceduralMap;
  /** Stable id shared by every client in the room (assigned by GameEngine). */
  public netId = -1;

  // --- Finger King (Level G) knobs, driven each frame by GameEngine on the
  // level's authority. Not replicated: only the AI reads them.
  /** 0..1, grows with time spent on Level G: senses further, moves faster. */
  public aggression = 0;
  /** Final chase (or a wrong terminal code): heads straight for the target. */
  public hunting = false;
  /** The explorer it's after is crouched in a closet it hasn't seen through yet. */
  public targetHidden = false;
  
  // Grid/logic position
  public gridX: number;
  public gridZ: number;
  public targetGridX: number;
  public targetGridZ: number;
  
  // Movement & timing
  private moveSpeed = 1.3; 
  private transitionProgress = 0.0;
  private isMoving = false;
  private pauseTimer = 0.0;
  
  // Animations and visual states
  private bobTime = 0.0;
  private glitchTimer = 0.0;

  // AI-Specific states
  private isAgitated = false; // Used for Skin-Stealer reveal, Wretch spotting, Clump alarm
  private speechBubbleTimer = 0.0;
  private currentSpeechText = "";
  private speechChangeTimer = 0.0;
  private intimidatedTimer = 0.0; // Hound frozen when gazed at
  private chaseTargetX = 0;
  private chaseTargetZ = 0;
  private isChasing = false;

  /** Seconds until this monster's next voice line (owned by GameEngine's audio pass). */
  public voiceTimer = 1 + Math.random() * 3;
  private wasAlert = false;

  /** Hunting/agitated: picks the aggressive voice. */
  public get alert(): boolean { return this.isChasing || this.isAgitated || this.hunting; }
  /** True once, on the frame the monster switches from calm to alert. */
  public consumeAlertEdge(): boolean {
    const a = this.alert;
    const edge = a && !this.wasAlert;
    this.wasAlert = a;
    return edge;
  }

  constructor(map: ProceduralMap, startX: number, startZ: number, type: EntityType) {
    this.map = map;
    this.gridX = startX;
    this.gridZ = startZ;
    this.targetGridX = startX;
    this.targetGridZ = startZ;
    this.type = type;

    // Allocate base speeds
    this.resetBaseSpeed();

    // Create custom aesthetic mesh
    this.mesh = this.createVisualMesh();
    this.syncWorldPosition();
  }

  /**
   * Assigns default speeds based on lore
   */
  private resetBaseSpeed() {
    this.moveSpeed = MOB_DEFS[this.type].baseSpeed;
  }

  // ---------------------------------------------------------------------
  // Real 3D bodies (primitives — cylinders/spheres/boxes), replacing the
  // old flat hand-drawn billboard sprite. Geometry and any material that
  // never needs per-instance tinting are cached class-wide (matCache/geoCache)
  // so 40+ concurrent monsters of the same type don't allocate duplicate
  // GPU buffers; materials that DO change per-instance (agitation tint,
  // Finger King's chase-red eyes) are built fresh per entity and tracked
  // below so state changes can retint them directly instead of redrawing.
  // ---------------------------------------------------------------------
  private static geoCache = new Map<string, THREE.BufferGeometry>();
  private static matCache = new Map<string, THREE.Material>();

  private sgeo<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
    let g = WanderingEntity.geoCache.get(key) as T | undefined;
    if (!g) { g = build(); WanderingEntity.geoCache.set(key, g); }
    return g;
  }
  private smat<T extends THREE.Material>(key: string, build: () => T): T {
    let m = WanderingEntity.matCache.get(key) as T | undefined;
    if (!m) { m = build(); WanderingEntity.matCache.set(key, m); }
    return m;
  }

  /** Frees the class-wide geometry/material caches. Call once, alongside clearPool(). */
  public static disposeSharedAssets() {
    WanderingEntity.geoCache.forEach((g) => g.dispose());
    WanderingEntity.geoCache.clear();
    WanderingEntity.matCache.forEach((m) => m.dispose());
    WanderingEntity.matCache.clear();
  }

  /** A tapered limb/spike mesh running from world-local point `a` to `b`. */
  private limbBetween(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, taper = 0.75): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 0.001;
    const geo = this.sgeo(`limb_${radius}_${taper}`, () => new THREE.CylinderGeometry(radius * taper, radius, 1, 5));
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(1, len, 1);
    m.position.copy(a).addScaledVector(dir, 0.5 / len);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    m.castShadow = true;
    return m;
  }

  private V(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z);
  }

  /** Per-instance materials whose colour/emissive changes with AI state (agitation, chase). */
  private tintMaterials: THREE.MeshStandardMaterial[] = [];
  /** Toggled between the calm and hostile look (Skin-Stealer's black vs red eyes). */
  private calmEyes: THREE.Object3D | null = null;
  private hostileEyes: THREE.Object3D | null = null;

  /** Builds a MobBuildCtx bound to this instance's caches/scratch fields — see mobs/types.ts's MobBuildCtx doc. */
  private buildCtx(group: THREE.Group): MobBuildCtx {
    return {
      group,
      sgeo: (key, build) => this.sgeo(key, build),
      smat: (key, build) => this.smat(key, build),
      limbBetween: (mat, a, b, radius, taper) => this.limbBetween(mat, a, b, radius, taper),
      V: (x, y, z) => this.V(x, y, z),
      addTintMaterial: (m) => { this.tintMaterials.push(m); },
      setCalmHostileEyes: (calm, hostile) => { this.calmEyes = calm; this.hostileEyes = hostile; },
      setKingEyeMaterial: (m) => { this.kingEyeMaterial = m; },
    };
  }

  private createVisualMesh(): THREE.Group {
    const group = new THREE.Group();
    MOB_DEFS[this.type].build(this.buildCtx(group));
    group.castShadow = true;

    // Small floating text sprite for the speech bubble — the only thing that
    // still needs a canvas texture; it starts hidden (no line spoken yet).
    const speechTex = this.getSpeechTexture();
    const speechMat = new THREE.SpriteMaterial({ map: speechTex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(speechMat);
    sprite.scale.set(1.1, 0.28, 1);
    sprite.position.set(0, this.speechBubbleLocalY(), 0);
    sprite.visible = false;
    group.add(sprite);
    this.speechSprite = sprite;

    return group;
  }

  /** How high above this type's local origin (baseHeight) the speech bubble floats. */
  private speechBubbleLocalY(): number {
    return MOB_DEFS[this.type].speechBubbleLocalY;
  }

  /** Only meaningful for Finger King — its eye material, retinted red while chasing/hunting. */
  private kingEyeMaterial: THREE.MeshStandardMaterial | null = null;

  // --- Speech bubble (tiny canvas texture, unrelated to the body now) ------

  private speechSprite: THREE.Sprite | null = null;
  private speechCanvas: HTMLCanvasElement | null = null;
  private speechTexture: THREE.CanvasTexture | null = null;

  private getSpeechTexture(): THREE.CanvasTexture {
    if (!this.speechCanvas) {
      this.speechCanvas = document.createElement("canvas");
      this.speechCanvas.width = 220;
      this.speechCanvas.height = 56;
    }
    if (!this.speechTexture) this.speechTexture = new THREE.CanvasTexture(this.speechCanvas);
    return this.speechTexture;
  }

  /** Redraws the little floating subtitle strip; hides the sprite entirely when there's no line to show. */
  private redrawSpeechBubble() {
    if (!this.speechSprite) return;
    if (!this.currentSpeechText) {
      this.speechSprite.visible = false;
      return;
    }
    const canvas = this.speechCanvas!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const text = t(this.currentSpeechText);
    ctx.font = "bold 15px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const metrics = ctx.measureText(text);
    const bgW = Math.min(canvas.width - 4, metrics.width + 18);
    const bgH = 26;

    ctx.fillStyle = "rgba(10, 8, 3, 0.85)";
    ctx.strokeStyle = this.isAgitated ? "#ef4444" : "#a28e3b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(canvas.width / 2 - bgW / 2, canvas.height / 2 - bgH / 2, bgW, bgH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 5;
    ctx.shadowColor = this.isAgitated ? "#ef4444" : "#eab308";
    ctx.fillStyle = this.isAgitated ? "#fca5a5" : "#deb81d";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

    this.speechTexture!.needsUpdate = true;
    this.speechSprite.visible = true;
  }

  /**
   * Snaps physical world coordinate instantly to corresponding grid cell center
   */
  public syncWorldPosition() {
    const cSize = this.map.cellSize;
    const wx = this.gridX * cSize + cSize / 2;
    const wz = this.gridZ * cSize + cSize / 2;
    
    // Set elevation: Duller hovers slightly floating; Clump/Hound crouch low to ground
    let ey = MOB_DEFS[this.type].baseHeight;

    // Level 1's sectors are real stacked storeys — stand on this cell's floor.
    ey += this.map.getFloorHeightAt(wx, wz);

    this.mesh.position.set(wx, ey, wz);
    this.updateWallClipLook();
  }

  /**
   * Legacy: a Duller placed inside a solid wall renders faded and slightly shrunk (it's the
   * only type that regularly noclips through walls — see chooseNextTarget).
   * Only Duller's body material is per-instance (tintMaterials), so it's the
   * only one it's safe to fade without dimming every other Duller sharing it.
   */
  private updateWallClipLook() {
    const inWall = this.map.grid[this.gridX]?.[this.gridZ] === CellType.SOLID;
    this.mesh.scale.setScalar(inWall ? 0.9 : 1.0);
    if (this.type !== EntityType.DULLER) return;
    const opacity = inWall ? 0.2 : 0.82;
    this.tintMaterials.forEach((m) => { m.opacity = opacity; m.needsUpdate = true; });
  }

  public toNetState(): EntityNetState {
    return {
      id: this.netId,
      t: this.type,
      gx: this.gridX, gz: this.gridZ,
      tx: this.targetGridX, tz: this.targetGridZ,
      p: Math.round(this.transitionProgress * 1000) / 1000,
      v: this.moveSpeed,
      m: this.isMoving,
      a: this.isAgitated,
      c: this.isChasing,
      s: this.currentSpeechText,
    };
  }

  /**
   * Adopts the authority's state. The AI fields are copied too (not just the
   * visuals) so that if this client becomes the authority later, it resumes
   * the simulation exactly where the previous one left off.
   */
  public applyNetState(s: EntityNetState) {
    const cellChanged = s.gx !== this.gridX || s.gz !== this.gridZ;
    const looksChanged = s.a !== this.isAgitated || s.s !== this.currentSpeechText;

    this.gridX = s.gx;
    this.gridZ = s.gz;
    this.targetGridX = s.tx;
    this.targetGridZ = s.tz;
    this.transitionProgress = s.p;
    this.moveSpeed = s.v;
    this.isMoving = s.m;
    this.isAgitated = s.a;
    this.isChasing = s.c;
    this.currentSpeechText = s.s;

    if (cellChanged) this.updateWallClipLook();
    if (looksChanged) this.updateVisualState(); // forced: a coalesced skip would never be retried
  }

  /**
   * Per-frame update on a non-authority client: no AI, just dead-reckon along
   * the edge the authority said it's walking, glide the mesh there, animate,
   * and face the local viewer.
   */
  public updateReplica(delta: number, viewerX: number, viewerZ: number) {
    const cSize = this.map.cellSize;
    if (this.isMoving) {
      this.transitionProgress = Math.min(1, this.transitionProgress + (this.moveSpeed / cSize) * delta);
    }
    const t = this.isMoving ? this.transitionProgress : 0;
    const wantX = THREE.MathUtils.lerp(this.gridX, this.targetGridX, t) * cSize + cSize / 2;
    const wantZ = THREE.MathUtils.lerp(this.gridZ, this.targetGridZ, t) * cSize + cSize / 2;

    // Snap on big jumps (relocations, first frame); otherwise glide to hide
    // the correction when a fresh network frame disagrees slightly.
    const dx = wantX - this.mesh.position.x;
    const dz = wantZ - this.mesh.position.z;
    if (dx * dx + dz * dz > cSize * cSize * 4) {
      this.mesh.position.x = wantX;
      this.mesh.position.z = wantZ;
    } else {
      const k = Math.min(1, 12 * delta);
      this.mesh.position.x += dx * k;
      this.mesh.position.z += dz * k;
    }

    this.animate(delta);
    this.mesh.lookAt(viewerX, this.mesh.position.y, viewerZ);
  }

  /** Bobbing and glitch-scale flicker, shared by the AI and replica updates. */
  private animate(delta: number) {
    this.bobTime += delta;
    this.glitchTimer += delta;

    const animDef = MOB_DEFS[this.type];
    const bobFreq = animDef.bobFreq;
    const bobAmp = animDef.bobAmp;
    const bobOffset = Math.sin(this.bobTime * bobFreq) * bobAmp;
    const baseHeight = animDef.baseHeight;

    const floorY = this.map.getFloorHeightAt(this.mesh.position.x, this.mesh.position.z);
    this.mesh.position.y = floorY + baseHeight + bobOffset;

    // Glitch animation (subtle scaling artifacts)
    if (this.glitchTimer >= 0.11) {
      this.glitchTimer = 0.0;
      if (Math.random() < 0.18) {
        this.mesh.scale.set(
          1.0 + (Math.random() * 0.06 - 0.03),
          1.0 + (Math.random() * 0.06 - 0.03),
          1.0
        );
      } else {
        this.mesh.scale.set(1.0, 1.0, 1.0);
      }
    }
  }

  /**
   * Applies the current AI state (agitation, chase) to the 3D body's tinted
   * parts and redraws the speech bubble. Cheap enough (a couple of material
   * flips + a small canvas redraw) that it needs no throttling, unlike the
   * old full-body 256x256 texture repaint this replaces.
   */
  private updateVisualState() {
    const visDef = MOB_DEFS[this.type];
    if (visDef.updateVisual) {
      visDef.updateVisual({
        isAgitated: this.isAgitated,
        isChasing: this.isChasing,
        hunting: this.hunting,
        calmEyes: this.calmEyes,
        hostileEyes: this.hostileEyes,
        tintMaterials: this.tintMaterials,
        kingEyeMaterial: this.kingEyeMaterial,
      });
    }
    this.redrawSpeechBubble();
  }

  /** Builds a MobSenseCtx for this frame — see mobs/types.ts's doc on why it's read-only. */
  private senseCtx(
    delta: number, distanceMeters: number, playerX: number, playerZ: number,
    playerState: "idle" | "walking" | "running" | "crouching",
    cameraDir?: THREE.Vector3, isFlashlightOn?: boolean
  ): MobSenseCtx {
    return {
      delta, distanceMeters, playerState, cameraDir,
      playerX, playerZ,
      entityPos: this.mesh.position,
      inSolidCell: this.map.grid[this.gridX]?.[this.gridZ] === CellType.SOLID,
      isFlashlightOn,
      levelForcedChase: this.map.level === 2 || this.map.level === 3,
      aggression: this.aggression,
      hunting: this.hunting,
      targetHidden: this.targetHidden,
      isAgitated: this.isAgitated,
      isChasing: this.isChasing,
      scratch: this.intimidatedTimer,
      map: this.map,
      noiseBus: this.map.noiseBus,
      visitTracker: this.map.visitTracker,
    };
  }

  /**
   * Updates state of Wandering Entity.
   * Handles custom pathing, speed modulations, and billboard direction locks.
   */
  public update(
    delta: number, 
    playerX: number, 
    playerZ: number,
    playerState: "idle" | "walking" | "running" | "crouching" = "idle",
    cameraDir?: THREE.Vector3,
    isFlashlightOn?: boolean
  ) {
    // 1. Organic Bobbing / Hover Animation + glitch flicker
    this.animate(delta);

    // 2. Rotate mesh horizontally to keep facing the voyager directly (Billboard sprite)
    this.mesh.lookAt(playerX, this.mesh.position.y, playerZ);

    // 3. Distance vector math
    const cSize = this.map.cellSize;
    const pxGrid = Math.floor(playerX / cSize);
    const pzGrid = Math.floor(playerZ / cSize);

    const fx = this.mesh.position.x - playerX;
    const fz = this.mesh.position.z - playerZ;
    const distanceMeters = Math.sqrt(fx * fx + fz * fz);

    // 4. SPEECH BUBBLE & LORE REVEAL MACHINE
    this.speechChangeTimer += delta;
    if (this.speechChangeTimer >= 4.0) {
      this.speechChangeTimer = 0.0;
      const prevText = this.currentSpeechText;

      // Formulate custom Portuguese lore subtitles based on proximity & type
      const speechDef = MOB_DEFS[this.type];
      if (speechDef.speech) {
        const ctx = this.senseCtx(delta, distanceMeters, playerX, playerZ, playerState, cameraDir, isFlashlightOn);
        const result = speechDef.speech(ctx);
        this.currentSpeechText = result.key;
        if (result.agitated !== undefined) this.isAgitated = result.agitated;
      }

      // Re-render when label text rotates or morphs
      if (prevText !== this.currentSpeechText) {
        this.updateVisualState();
      }
    }

    // 5. INTENSITY AI LOGICS (Special features of the official Entities)
    
    // Default chasing reset each frame, we calculate depending on sensors.
    // Level 3 ("Lights Out") stalkers are summoned specifically to hunt the
    // player, so they share Level 2's always-chasing behavior.
    const senseDef = MOB_DEFS[this.type];
    if (this.map.level === 2 || this.map.level === 3) {
      this.isChasing = true;
      // Boost movement speeds dramatically on Level 2/3 to make it a fast, heart-pounding sprint chase!
      this.moveSpeed = senseDef.forcedChaseSpeed;
      if (senseDef.forcedChaseAgitated) this.isAgitated = true;
    } else {
      this.isChasing = false;
    }

    if (this.map.level !== 2 && this.map.level !== 3) {
      const ctx = this.senseCtx(delta, distanceMeters, playerX, playerZ, playerState, cameraDir, isFlashlightOn);
      const result = senseDef.sense(ctx);
      this.isChasing = result.chasing;
      this.moveSpeed = result.speed;
      if (result.agitated !== undefined) this.isAgitated = result.agitated;
      if (result.scratch !== undefined) this.intimidatedTimer = result.scratch;
    }

    if (!this.isChasing && this.searchTimer > 0) this.searchTimer -= delta;

    // Adjust target coordinates if chasing
    if (this.isChasing) {
      this.chaseTargetX = pxGrid;
      this.chaseTargetZ = pzGrid;
    }

    // 6. Grid Traversing state machine
    if (this.isMoving) {
      // Interpolate progress along the current edge
      this.transitionProgress += (this.moveSpeed / cSize) * delta;

      if (this.transitionProgress >= 1.0) {
        // Complete current cell transition, set grid logical center
        this.gridX = this.targetGridX;
        this.gridZ = this.targetGridZ;
        this.isMoving = false;
        this.pauseTimer = this.type === EntityType.FINGER_KING
          // Lurks between steps while searching; no pauses once it has you.
          ? (this.isChasing ? 0.03 : 0.3 + Math.random() * 0.9)
          : Math.random() * 0.4 + 0.2; // brief tension check
        this.syncWorldPosition();
      } else {
        // Linearly interpolate ThreeJS world coords
        const wFromX = this.gridX * cSize + cSize / 2;
        const wFromZ = this.gridZ * cSize + cSize / 2;
        const wToX = this.targetGridX * cSize + cSize / 2;
        const wToZ = this.targetGridZ * cSize + cSize / 2;

        const currentWX = THREE.MathUtils.lerp(wFromX, wToX, this.transitionProgress);
        const currentWZ = THREE.MathUtils.lerp(wFromZ, wToZ, this.transitionProgress);
        this.mesh.position.x = currentWX;
        this.mesh.position.z = currentWZ;
      }
    } else {
      // Stationed
      if (this.pauseTimer > 0.0) {
        this.pauseTimer -= delta;
      } else {
        this.chooseNextTarget(pxGrid, pzGrid);
      }
    }
  }

  /** Last cell the player was chased to; searched for a few seconds after losing them. */
  private lastKnownX = -1;
  private lastKnownZ = -1;
  private searchTimer = 0.0;
  private prevGridX = -1;
  private prevGridZ = -1;

  /**
   * Evaluates next target tile candidate. Everything paths around walls and
   * props (BFS), chases the player's cell, keeps searching the last place it
   * saw them for a few seconds, and otherwise patrols without backtracking.
   */
  private chooseNextTarget(pXg: number, pZg: number) {
    if (this.type === EntityType.FINGER_KING) {
      this.chooseFingerKingStep(pXg, pZg);
      return;
    }

    if (this.isChasing) {
      this.lastKnownX = pXg;
      this.lastKnownZ = pZg;
      this.searchTimer = 6.0;
    }

    let step: [number, number] | null = null;
    if (this.isChasing) {
      step = this.bfsFirstStep(pXg, pZg) ?? this.greedyStep(pXg, pZg);
    } else if (this.searchTimer > 0 && this.lastKnownX >= 0) {
      if (this.gridX === this.lastKnownX && this.gridZ === this.lastKnownZ) {
        this.searchTimer = 0;
      } else {
        step = this.bfsFirstStep(this.lastKnownX, this.lastKnownZ);
      }
    }

    if (!step) {
      // Patrol: random open neighbour, preferring not to walk straight back.
      const options: [number, number][] = [];
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = this.gridX + dx, nz = this.gridZ + dz;
        if (this.fingerCanEnter(this.gridX, this.gridZ, nx, nz)) options.push([nx, nz]);
      }
      const forward = options.filter(([x, z]) => x !== this.prevGridX || z !== this.prevGridZ);
      const pool = forward.length > 0 ? forward : options;
      if (pool.length > 0) step = pool[Math.floor(Math.random() * pool.length)];
    }

    if (step) {
      this.prevGridX = this.gridX;
      this.prevGridZ = this.gridZ;
      this.targetGridX = step[0];
      this.targetGridZ = step[1];
      this.isMoving = true;
      this.transitionProgress = 0.0;
    } else {
      this.pauseTimer = 0.5;
    }
  }

  /** Fallback when no full path exists: the open neighbour closest to (tx, tz). */
  private greedyStep(tx: number, tz: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = this.gridX + dx, nz = this.gridZ + dz;
      if (!this.fingerCanEnter(this.gridX, this.gridZ, nx, nz)) continue;
      const d = (nx - tx) ** 2 + (nz - tz) ** 2;
      if (d < bestD) { bestD = d; best = [nx, nz]; }
    }
    return best;
  }

  /**
   * Finger King steps by real shortest paths (BFS over the small office), so
   * walls and doors don't strand it the way the greedy step does. When not
   * chasing it still drifts towards the explorer — more often as aggression
   * rises — which is what keeps anyone from exploring at leisure. Closets are
   * off limits unless it's hunting or the one inside isn't hidden any more.
   */
  private chooseFingerKingStep(pXg: number, pZg: number) {
    const seek = this.isChasing || (!this.targetHidden && Math.random() < 0.3 + 0.5 * this.aggression);
    const step = seek ? this.bfsFirstStep(pXg, pZg) : null;
    if (step) {
      [this.targetGridX, this.targetGridZ] = step;
      this.isMoving = true;
      this.transitionProgress = 0.0;
      return;
    }

    const options: [number, number][] = [];
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = this.gridX + dx, nz = this.gridZ + dz;
      if (this.fingerCanEnter(this.gridX, this.gridZ, nx, nz)) options.push([nx, nz]);
    }
    if (options.length > 0) {
      [this.targetGridX, this.targetGridZ] = options[Math.floor(Math.random() * options.length)];
      this.isMoving = true;
      this.transitionProgress = 0.0;
    } else {
      this.pauseTimer = 0.5;
    }
  }

  /** Whether a step from cell (fx, fz) into (x, z) is clear of walls and props. */
  private fingerCanEnter(fx: number, fz: number, x: number, z: number): boolean {
    if (x < 2 || z < 2 || x >= this.map.gridSize - 2 || z >= this.map.gridSize - 2) return false;
    if (this.map.grid[x][z] === CellType.SOLID) return false;
    if (!this.map.isWalkableForEntities(x, z)) return false;
    const cs = this.map.cellSize;
    const cx = x * cs + cs / 2, cz = z * cs + cs / 2;
    const ox = fx * cs + cs / 2, oz = fz * cs + cs / 2;
    // Props (crates, pillars, boilers) block the cell centre or the edge crossing.
    if (this.map.checkCollision(cx, cz, 0.35)) return false;
    if (this.map.checkCollision((cx + ox) / 2, (cz + oz) / 2, 0.35)) return false;
    if (!this.hunting && this.targetHidden && this.map.hideCells.has(`${x},${z}`)) return false;
    return true;
  }

  /** First cell on a shortest walkable path from here to (tx, tz), or null. */
  private bfsFirstStep(tx: number, tz: number): [number, number] | null {
    const gs = this.map.gridSize;
    if (tx === this.gridX && tz === this.gridZ) return null;
    const firstStep = new Int32Array(gs * gs).fill(-1);
    const queue: number[] = [];
    const start = this.gridX * gs + this.gridZ;
    firstStep[start] = start;
    queue.push(start);
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const cx = Math.floor(cur / gs), cz = cur % gs;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.fingerCanEnter(cx, cz, nx, nz)) continue;
        const idx = nx * gs + nz;
        if (firstStep[idx] !== -1) continue;
        firstStep[idx] = cur === start ? idx : firstStep[cur];
        if (nx === tx && nz === tz) {
          const s = firstStep[idx];
          return [Math.floor(s / gs), s % gs];
        }
        queue.push(idx);
      }
    }
    return null;
  }

  /** Puts the entity on a specific cell instantly (Level G ambushes). */
  public teleportTo(gx: number, gz: number) {
    this.gridX = gx;
    this.gridZ = gz;
    this.targetGridX = gx;
    this.targetGridZ = gz;
    this.isMoving = false;
    this.transitionProgress = 0.0;
    this.pauseTimer = 0.4;
    this.syncWorldPosition();
  }

  /**
   * Resets the entity's position to a distant grid cell
   */
  public relocateFarAway(playerGridX: number, playerGridZ: number) {
    const size = this.map.gridSize;
    let candidates: [number, number][] = [];

    // Search cells in quadrants opposite/far from player
    for (let x = 3; x < size - 3; x++) {
      for (let z = 3; z < size - 3; z++) {
        // Not solid
        if (this.map.grid[x][z] !== CellType.SOLID) {
          const dx = x - playerGridX;
          const dz = z - playerGridZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          // Half the map on small levels (Level G is only 18 cells across).
          if (dist > Math.min(18, size * 0.5) && this.map.isWalkableForEntities(x, z)) {
            candidates.push([x, z]);
          }
        }
      }
    }

    if (candidates.length > 0) {
      const select = candidates[Math.floor(Math.random() * candidates.length)];
      this.gridX = select[0];
      this.gridZ = select[1];
      this.targetGridX = select[0];
      this.targetGridZ = select[1];
      this.isMoving = false;
      this.isAgitated = false;
      this.resetBaseSpeed();
      this.syncWorldPosition();
      this.updateVisualState();
      console.log(`[Entity ${this.type}] Relocated safely to far cell (${this.gridX}, ${this.gridZ})`);
    } else {
      // Fallback
      this.gridX = size - 4;
      this.gridZ = size - 4;
      this.targetGridX = size - 4;
      this.targetGridZ = size - 4;
      this.isMoving = false;
      this.isAgitated = false;
      this.resetBaseSpeed();
      this.syncWorldPosition();
      this.updateVisualState();
    }
  }

  /**
   * Safely disposes materials & textures
   */
  public destroy(scene: THREE.Scene) {
    this.returnToPool(scene);
  }

  /**
   * Builds a standalone copy of a monster's body — no AI, no map, not pooled —
   * for the lobby's SKIN cheat, where a player wears a monster's body instead
   * of the hazmat suit. `Object.create` skips the constructor (which needs a
   * live ProceduralMap just to place itself); MobDefinition.build() only
   * touches the class-wide geometry/material caches (via buildCtx) and a
   * couple of per-instance fields, so a bare `tintMaterials` array is the
   * only state they need.
   *
   * Every geometry (and most materials) build() uses come from the
   * `sgeo`/`smat` class-wide caches — the same buffers live AI monsters of
   * that type are using right now — so the returned group must never be
   * disposed via a blind mesh traversal. `name` flags it for a caller doing
   * that (see GameEngine.removeRemotePlayer); `userData.tintMaterials` holds
   * the handful of genuinely per-instance materials (Duller, Skin-Stealer)
   * that *do* need disposing when a skinned player leaves.
   */
  public static buildSkinMesh(type: EntityType): THREE.Group {
    const proto = Object.create(WanderingEntity.prototype) as WanderingEntity;
    proto.tintMaterials = [];
    proto.type = type;
    const group = new THREE.Group();
    MOB_DEFS[type].build(proto.buildCtx(group));
    group.name = "monsterSkinBody";
    group.userData.tintMaterials = proto.tintMaterials;
    return group;
  }

  /** Height above the floor the type's body is centred at — mirrors syncWorldPosition's `ey`. */
  public static skinAnchorY(type: EntityType): number {
    return MOB_DEFS[type].baseHeight;
  }

  /**
   * Retrieves an entity from the static pool or instantiates a new one if empty
   */
  public static getOrCreate(map: ProceduralMap, startX: number, startZ: number, type: EntityType, scene: THREE.Scene): WanderingEntity {
    if (!this.entityPool.has(type)) {
      this.entityPool.set(type, []);
    }
    const poolList = this.entityPool.get(type)!;
    if (poolList.length > 0) {
      const entity = poolList.pop()!;
      entity.resetForReuse(map, startX, startZ);
      scene.add(entity.mesh);
      return entity;
    } else {
      const entity = new WanderingEntity(map, startX, startZ, type);
      scene.add(entity.mesh);
      return entity;
    }
  }

  /**
   * Releases this instance back to the object pool instead of destroying it
   */
  public returnToPool(scene: THREE.Scene) {
    scene.remove(this.mesh);
    // Reset temporary runtime fields
    this.transitionProgress = 0.0;
    this.isMoving = false;
    this.pauseTimer = 0.0;
    this.bobTime = 0.0;
    this.glitchTimer = 0.0;
    this.isAgitated = false;
    this.speechBubbleTimer = 0.0;
    this.currentSpeechText = "";
    this.speechChangeTimer = 0.0;
    this.intimidatedTimer = 0.0;
    this.chaseTargetX = 0;
    this.chaseTargetZ = 0;
    this.isChasing = false;

    if (!WanderingEntity.entityPool.has(this.type)) {
      WanderingEntity.entityPool.set(this.type, []);
    }
    WanderingEntity.entityPool.get(this.type)!.push(this);
  }

  /**
   * Resets the entity logic with a new map reference and coordinates
   */
  public resetForReuse(map: ProceduralMap, startX: number, startZ: number) {
    this.map = map;
    this.gridX = startX;
    this.gridZ = startZ;
    this.targetGridX = startX;
    this.targetGridZ = startZ;
    this.transitionProgress = 0.0;
    this.isMoving = false;
    this.pauseTimer = 0.0;
    this.bobTime = 0.0;
    this.glitchTimer = 0.0;
    this.isAgitated = false;
    this.speechBubbleTimer = 0.0;
    this.currentSpeechText = "";
    this.speechChangeTimer = 0.0;
    this.intimidatedTimer = 0.0;
    this.chaseTargetX = 0;
    this.chaseTargetZ = 0;
    this.isChasing = false;
    this.lastKnownX = -1;
    this.lastKnownZ = -1;
    this.searchTimer = 0.0;
    this.prevGridX = -1;
    this.prevGridZ = -1;

    this.resetBaseSpeed();
    this.syncWorldPosition();
    // Forced: a reused entity must repaint immediately, not wait out the
    // coalescing window with the previous occupant's label on screen.
    this.updateVisualState();
  }

  /**
   * Clears the entire object pool to free GPU resources when the game engine
   * is disposed. Most geometries/materials are shared class-wide (sgeo/smat)
   * and freed once via disposeSharedAssets() below — per entity, only the
   * per-instance tint materials and the speech-bubble canvas texture are
   * actually unique to it.
   */
  public static clearPool() {
    this.entityPool.forEach((list) => {
      list.forEach((entity) => {
        entity.tintMaterials.forEach((m) => m.dispose());
        entity.tintMaterials = [];
        if (entity.speechTexture) entity.speechTexture.dispose();
      });
    });
    this.entityPool.clear();
    WanderingEntity.disposeSharedAssets();
  }
}
