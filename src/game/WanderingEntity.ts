/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { ProceduralMap, CellType } from "./ProceduralMap";

export enum EntityType {
  DULLER = "DULLER",
  HOUND = "HOUND",
  CLUMP = "CLUMP",
  SKIN_STEALER = "SKIN_STEALER",
  WRETCH = "WRETCH",
  /** Level G's exclusive stalker. */
  FINGER_KING = "FINGER_KING"
}

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
    switch (this.type) {
      case EntityType.DULLER:
        this.moveSpeed = 1.1;
        break;
      case EntityType.HOUND:
        this.moveSpeed = 1.25;
        break;
      case EntityType.CLUMP:
        this.moveSpeed = 1.4;
        break;
      case EntityType.SKIN_STEALER:
        this.moveSpeed = 1.1;
        break;
      case EntityType.WRETCH:
        this.moveSpeed = 1.45;
        break;
      case EntityType.FINGER_KING:
        this.moveSpeed = 1.0;
        break;
    }
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

  private createVisualMesh(): THREE.Group {
    const group = new THREE.Group();
    switch (this.type) {
      case EntityType.DULLER: this.buildDuller(group); break;
      case EntityType.HOUND: this.buildHound(group); break;
      case EntityType.CLUMP: this.buildClump(group); break;
      case EntityType.SKIN_STEALER: this.buildSkinStealer(group); break;
      case EntityType.WRETCH: this.buildWretch(group); break;
      case EntityType.FINGER_KING: this.buildFingerKing(group); break;
    }
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
    switch (this.type) {
      case EntityType.DULLER: return 0.75;
      case EntityType.HOUND: return 0.55;
      case EntityType.CLUMP: return 0.7;
      case EntityType.FINGER_KING: return 1.1;
      default: return 0.9;
    }
  }

  // --- Per-type bodies -----------------------------------------------------

  /** Gaunt noclip shadow: thin dark humanoid, blue rim glow, limbs splayed as if mid-crawl. */
  private buildDuller(group: THREE.Group) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c1220, emissive: 0x1d4ed8, emissiveIntensity: 0.55,
      roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.82,
    });
    this.tintMaterials.push(mat);

    group.add(this.limbBetween(mat, this.V(0, 0.35, 0), this.V(0, -0.35, 0), 0.11)); // spine
    // Arms, bent and trailing
    group.add(this.limbBetween(mat, this.V(0, 0.3, 0), this.V(-0.32, 0.05, 0.1), 0.05));
    group.add(this.limbBetween(mat, this.V(-0.32, 0.05, 0.1), this.V(-0.22, -0.25, 0.2), 0.045));
    group.add(this.limbBetween(mat, this.V(0, 0.3, 0), this.V(0.32, 0.05, 0.1), 0.05));
    group.add(this.limbBetween(mat, this.V(0.32, 0.05, 0.1), this.V(0.22, -0.25, 0.2), 0.045));
    // Legs, dangling loosely below (Duller floats, feet don't touch ground)
    group.add(this.limbBetween(mat, this.V(0, -0.35, 0), this.V(-0.2, -0.75, 0.05), 0.06));
    group.add(this.limbBetween(mat, this.V(0, -0.35, 0), this.V(0.2, -0.75, 0.05), 0.06));

    const head = new THREE.Mesh(this.sgeo("duller_head", () => new THREE.SphereGeometry(0.15, 10, 8)), mat);
    head.position.set(0, 0.53, 0);
    group.add(head);
  }

  /** Crawling feral dog-thing: low horizontal body, matted head, glowing eyes, red jaw. */
  private buildHound(group: THREE.Group) {
    const bodyMat = this.smat("hound_body", () => new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95 }));
    group.add(this.limbBetween(bodyMat, this.V(-0.32, 0.02, -0.22), this.V(0.3, 0.05, 0.22), 0.17, 0.9));
    // 4 crooked legs
    const legs: [THREE.Vector3, THREE.Vector3][] = [
      [this.V(-0.28, -0.05, -0.2), this.V(-0.38, -0.75, -0.28)],
      [this.V(-0.1, -0.02, -0.25), this.V(-0.16, -0.75, -0.35)],
      [this.V(0.14, -0.02, 0.22), this.V(0.22, -0.7, 0.32)],
      [this.V(0.3, 0.0, 0.18), this.V(0.42, -0.72, 0.26)],
    ];
    for (const [a, b] of legs) group.add(this.limbBetween(bodyMat, a, b, 0.05));

    const headMat = this.smat("hound_head", () => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1.0 }));
    const head = new THREE.Mesh(this.sgeo("hound_head_geo", () => new THREE.IcosahedronGeometry(0.19, 0)), headMat);
    head.position.set(-0.4, 0.12, -0.24);
    group.add(head);

    const eyeMat = this.smat("hound_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xeab308, emissiveIntensity: 1.4 }));
    const eyeGeo = this.sgeo("hound_eye_geo", () => new THREE.SphereGeometry(0.022, 6, 6));
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.46, 0.15, -0.14); group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(-0.46, 0.15, -0.34); group.add(eyeR);

    const jawMat = this.smat("hound_jaw", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.8 }));
    const jaw = new THREE.Mesh(this.sgeo("hound_jaw_geo", () => new THREE.BoxGeometry(0.08, 0.05, 0.13)), jawMat);
    jaw.position.set(-0.52, 0.06, -0.24);
    group.add(jaw);
  }

  /** Fleshy core with a burst of thin spike-limbs — a rolling clump of tumbling appendages. */
  private buildClump(group: THREE.Group) {
    const coreMat = this.smat("clump_core", () => new THREE.MeshStandardMaterial({ color: 0x1e0b12, emissive: 0x4a1029, emissiveIntensity: 0.35, roughness: 0.8 }));
    const core = new THREE.Mesh(this.sgeo("clump_core_geo", () => new THREE.SphereGeometry(0.34, 12, 10)), coreMat);
    group.add(core);

    const spikeMat = this.smat("clump_spike", () => new THREE.MeshStandardMaterial({ color: 0x2e111a, roughness: 0.9 }));
    const clawMat = this.smat("clump_claw", () => new THREE.MeshStandardMaterial({ color: 0x4a1d2d, roughness: 0.7 }));
    const clawGeo = this.sgeo("clump_claw_geo", () => new THREE.SphereGeometry(0.035, 6, 6));

    const SPIKES = 18;
    for (let i = 0; i < SPIKES; i++) {
      // Deterministic even spread (golden-angle spiral over the sphere) so every
      // Clump looks the same instead of a fresh random burst each frame.
      const t = i / SPIKES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const dir = this.V(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      const len = 0.3 + ((i * 37) % 10) / 40; // 0.3 - 0.55, stable per-index jitter
      const start = dir.clone().multiplyScalar(0.3);
      const end = dir.clone().multiplyScalar(0.3 + len);
      group.add(this.limbBetween(spikeMat, start, end, 0.028));
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.copy(end);
      group.add(claw);
    }
  }

  /** Lanky humanoid in a stained hazmat-yellow suit; retints darker and grows red eyes once agitated. */
  private buildSkinStealer(group: THREE.Group) {
    const suitMat = new THREE.MeshStandardMaterial({ color: 0xb39a3c, roughness: 0.85 });
    this.tintMaterials.push(suitMat);

    const torso = new THREE.Mesh(this.sgeo("stealer_torso", () => new THREE.CylinderGeometry(0.19, 0.23, 0.55, 8)), suitMat);
    torso.position.set(0, -0.1, 0);
    group.add(torso);

    // Arms — left notably longer, per the original design
    group.add(this.limbBetween(suitMat, this.V(-0.17, 0.1, 0), this.V(-0.55, -0.35, 0.05), 0.055));
    group.add(this.limbBetween(suitMat, this.V(-0.55, -0.35, 0.05), this.V(-0.62, -0.8, 0.08), 0.045));
    group.add(this.limbBetween(suitMat, this.V(0.17, 0.1, 0), this.V(0.5, -0.15, 0), 0.055));
    group.add(this.limbBetween(suitMat, this.V(0.5, -0.15, 0), this.V(0.6, -0.62, 0), 0.045));
    // Legs
    group.add(this.limbBetween(suitMat, this.V(-0.1, -0.38, 0), this.V(-0.14, -1.3, 0), 0.07));
    group.add(this.limbBetween(suitMat, this.V(0.1, -0.38, 0), this.V(0.14, -1.3, 0), 0.07));

    const headMat = this.smat("stealer_head", () => new THREE.MeshStandardMaterial({ color: 0xe5e1da, roughness: 0.6 }));
    const head = new THREE.Mesh(this.sgeo("stealer_head_geo", () => new THREE.SphereGeometry(0.16, 10, 8)), headMat);
    head.position.set(0, 0.38, 0);
    group.add(head);

    // Sagging hood — a squashed half-dome sitting slightly back on the head
    const hoodMat = this.smat("stealer_hood", () => new THREE.MeshStandardMaterial({ color: 0x85722b, roughness: 0.9, side: THREE.DoubleSide }));
    const hood = new THREE.Mesh(this.sgeo("stealer_hood_geo", () => new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6)), hoodMat);
    hood.position.set(0, 0.42, -0.02);
    hood.rotation.x = 0.15;
    group.add(hood);

    const eyeGeo = this.sgeo("stealer_eye_geo", () => new THREE.SphereGeometry(0.022, 6, 6));
    const calmMat = this.smat("stealer_calm_eye", () => new THREE.MeshStandardMaterial({ color: 0x0c0a09 }));
    const calm = new THREE.Group();
    const cL = new THREE.Mesh(eyeGeo, calmMat); cL.position.set(-0.05, 0.4, 0.14); calm.add(cL);
    const cR = new THREE.Mesh(eyeGeo, calmMat); cR.position.set(0.05, 0.4, 0.14); calm.add(cR);
    group.add(calm);
    this.calmEyes = calm;

    const hostileMat = this.smat("stealer_hostile_eye", () => new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff0000, emissiveIntensity: 1.6 }));
    const hostile = new THREE.Group();
    const hL = new THREE.Mesh(eyeGeo, hostileMat); hL.position.set(-0.05, 0.4, 0.14); hostile.add(hL);
    const hR = new THREE.Mesh(eyeGeo, hostileMat); hR.position.set(0.05, 0.4, 0.14); hostile.add(hR);
    hostile.visible = false;
    group.add(hostile);
    this.hostileEyes = hostile;
  }

  /** Hunched, skeletal, sprinting — a red raw-skinned figure with a screaming skull head. */
  private buildWretch(group: THREE.Group) {
    const skinMat = this.smat("wretch_skin", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.85 }));
    // Hunched spine: pelvis low and back, curving up and forward to the head
    group.add(this.limbBetween(skinMat, this.V(0, -0.55, 0.1), this.V(-0.05, -0.05, -0.05), 0.11));
    group.add(this.limbBetween(skinMat, this.V(-0.05, -0.05, -0.05), this.V(0, 0.35, -0.15), 0.09));
    // Reaching claws
    group.add(this.limbBetween(skinMat, this.V(-0.03, 0.15, -0.1), this.V(-0.42, 0.05, -0.3), 0.05));
    group.add(this.limbBetween(skinMat, this.V(-0.42, 0.05, -0.3), this.V(-0.6, -0.1, -0.42), 0.04));
    group.add(this.limbBetween(skinMat, this.V(0, 0.0, -0.08), this.V(0.35, -0.15, 0.1), 0.05));
    group.add(this.limbBetween(skinMat, this.V(0.35, -0.15, 0.1), this.V(0.5, -0.42, 0.22), 0.04));
    // Sprinting legs
    group.add(this.limbBetween(skinMat, this.V(-0.06, -0.6, 0.12), this.V(-0.16, -1.3, 0.05), 0.065));
    group.add(this.limbBetween(skinMat, this.V(0.06, -0.6, 0.1), this.V(0.2, -1.3, 0.2), 0.065));

    const headMat = this.smat("wretch_head", () => new THREE.MeshStandardMaterial({ color: 0x581c1c, roughness: 0.9 }));
    const head = new THREE.Mesh(this.sgeo("wretch_head_geo", () => new THREE.SphereGeometry(0.14, 10, 8)), headMat);
    head.position.set(0, 0.48, -0.18);
    group.add(head);

    const jawMat = this.smat("wretch_jaw", () => new THREE.MeshStandardMaterial({ color: 0x020101, roughness: 1.0 }));
    const jaw = new THREE.Mesh(this.sgeo("wretch_jaw_geo", () => new THREE.SphereGeometry(0.04, 6, 6)), jawMat);
    jaw.position.set(0, 0.42, -0.28);
    jaw.scale.set(0.8, 1.4, 1);
    group.add(jaw);

    const eyeMat = this.smat("wretch_eye", () => new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.4 }));
    const eyeGeo = this.sgeo("wretch_eye_geo", () => new THREE.SphereGeometry(0.02, 6, 6));
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.06, 0.51, -0.28); group.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.06, 0.51, -0.28); group.add(eR);
  }

  /** Tall, gaunt, office-grey figure: stilt legs, finger-hands dragging the floor, a crown of fingers. */
  private buildFingerKing(group: THREE.Group) {
    const suitMat = this.smat("king_suit", () => new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.7 }));
    const torso = new THREE.Mesh(this.sgeo("king_torso", () => new THREE.CylinderGeometry(0.14, 0.2, 0.62, 6)), suitMat);
    torso.position.set(0, 0.35, 0);
    group.add(torso);

    const tieMat = this.smat("king_tie", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 }));
    const tie = new THREE.Mesh(this.sgeo("king_tie_geo", () => new THREE.BoxGeometry(0.05, 0.5, 0.02)), tieMat);
    tie.position.set(0, 0.38, 0.15);
    group.add(tie);

    // Stilt legs — this creature reads as unnaturally tall
    group.add(this.limbBetween(suitMat, this.V(-0.08, 0.04, 0), this.V(-0.1, -1.35, 0), 0.06));
    group.add(this.limbBetween(suitMat, this.V(0.08, 0.04, 0), this.V(0.1, -1.35, 0), 0.06));

    const skinMat = this.smat("king_skin", () => new THREE.MeshStandardMaterial({ color: 0xd8cfc2, roughness: 0.55 }));
    const knuckleGeo = this.sgeo("king_knuckle_geo", () => new THREE.SphereGeometry(0.015, 5, 5));
    const knuckleMat = this.smat("king_knuckle", () => new THREE.MeshStandardMaterial({ color: 0x8f8373, roughness: 0.6 }));

    // Arms ending in a hand of 5 long, impossibly jointed fingers dragging near the floor
    for (const side of [-1, 1]) {
      const shoulder = this.V(side * 0.15, 0.55, 0);
      const wrist = this.V(side * 0.42, -0.15, 0.05);
      group.add(this.limbBetween(suitMat, shoulder, wrist, 0.045));
      for (let f = 0; f < 5; f++) {
        const spread = (f - 2) * 0.05;
        const fingerEnd = this.V(wrist.x + side * (0.15 + f * 0.03), -1.3 + Math.abs(f - 2) * 0.05, wrist.z + spread * 2);
        group.add(this.limbBetween(skinMat, wrist, fingerEnd, 0.014, 0.6));
        const knuckle = new THREE.Mesh(knuckleGeo, knuckleMat);
        knuckle.position.copy(wrist).lerp(fingerEnd, 0.55);
        group.add(knuckle);
      }
    }

    const head = new THREE.Mesh(this.sgeo("king_head_geo", () => new THREE.SphereGeometry(0.15, 10, 10)), skinMat);
    head.position.set(0, 0.82, 0);
    head.scale.set(0.85, 1.35, 0.95);
    group.add(head);

    // Crown of upright fingers
    const nailMat = this.smat("king_nail", () => new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.5 }));
    const nailGeo = this.sgeo("king_nail_geo", () => new THREE.SphereGeometry(0.012, 5, 5));
    for (let f = 0; f < 7; f++) {
      const off = (f - 3) / 3; // -1..1
      const base = this.V(off * 0.11, 1.0, 0);
      const tip = this.V(off * 0.13, 1.22 - Math.abs(off) * 0.08, 0);
      group.add(this.limbBetween(skinMat, base, tip, 0.011, 0.6));
      const nail = new THREE.Mesh(nailGeo, nailMat);
      nail.position.copy(tip);
      group.add(nail);
    }

    const eyeGeo = this.sgeo("king_eye_geo", () => new THREE.SphereGeometry(0.018, 6, 6));
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x000000, emissiveIntensity: 0 });
    this.tintMaterials.push(eyeMat);
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.045, 0.83, 0.11); group.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.045, 0.83, 0.11); group.add(eR);
    this.kingEyeMaterial = eyeMat;
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

    const text = this.currentSpeechText;
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
    let ey = 1.35;
    if (this.type === EntityType.DULLER) {
      ey = 1.48; // Floating ghostly phantom
    } else if (this.type === EntityType.HOUND) {
      ey = 1.05; // crawling dog
    } else if (this.type === EntityType.CLUMP) {
      ey = 1.12; // ball of tumbling limbs
    }

    // Level 1's sectors are real stacked storeys — stand on this cell's floor.
    ey += this.map.getFloorHeightAt(wx, wz);

    this.mesh.position.set(wx, ey, wz);
    this.updateWallClipLook();
  }

  /**
   * Duller inside a solid wall renders faded and slightly shrunk (it's the
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

    let bobFreq = 3.8;
    let bobAmp = 0.08;
    if (this.type === EntityType.HOUND) {
      bobFreq = 5.5; bobAmp = 0.04; // Fast canine shivering
    } else if (this.type === EntityType.CLUMP) {
      bobFreq = 2.4; bobAmp = 0.12; // Tumbling heavy rolling motion
    } else if (this.type === EntityType.DULLER) {
      bobFreq = 1.8; bobAmp = 0.15; // Silent floating hover
    }

    const bobOffset = Math.sin(this.bobTime * bobFreq) * bobAmp;

    let baseHeight = 1.35;
    if (this.type === EntityType.DULLER) baseHeight = 1.48;
    else if (this.type === EntityType.HOUND) baseHeight = 1.05;
    else if (this.type === EntityType.CLUMP) baseHeight = 1.12;

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
    if (this.type === EntityType.SKIN_STEALER && this.calmEyes && this.hostileEyes) {
      this.calmEyes.visible = !this.isAgitated;
      this.hostileEyes.visible = this.isAgitated;
      const tint = this.isAgitated ? 0x3f320b : 0xb39a3c;
      this.tintMaterials.forEach((m) => { m.color.setHex(tint); m.needsUpdate = true; });
    } else if (this.type === EntityType.FINGER_KING && this.kingEyeMaterial) {
      const active = this.isChasing || this.hunting;
      this.kingEyeMaterial.color.setHex(active ? 0xef4444 : 0x0a0a0a);
      this.kingEyeMaterial.emissive.setHex(active ? 0xff0000 : 0x000000);
      this.kingEyeMaterial.emissiveIntensity = active ? 1.6 : 0;
      this.kingEyeMaterial.needsUpdate = true;
    }
    this.redrawSpeechBubble();
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
      if (this.type === EntityType.SKIN_STEALER) {
        if (distanceMeters > 5.5) {
          // Innocent explorer mimicking phrases
          this.isAgitated = false;
          const mimics = [
            "Olá? Tem alguém aí?",
            "Socorro... Acho que rompi ligamentos.",
            "Encontrei água de amêndoas por aqui!",
            "Me chamo Lucas. Você faz parte do M.E.G.?",
            "Ufa, passos de gente! Venha me ajudar!",
            "Estou perto da saída do Level 1!"
          ];
          this.currentSpeechText = mimics[Math.floor(Math.random() * mimics.length)];
          this.moveSpeed = 1.0; // Slow friendly pace
        } else {
          // Angry morph trigger close-up!
          if (!this.isAgitated) {
            this.isAgitated = true;
            console.warn("[Skin-Stealer] Mask slipped! Attacking voyager.");
          }
          const hostiles = [
            "SUA PELE... ME DÁ ELA!",
            "NÃO ADIANTA REZAR!",
            "VOCÊ CHEIRA TÃO BEM...",
            "ROSTO DE VERDADE... EU QUERO!",
            "SOU HUMANO SIM! VENHA AQUI!"
          ];
          this.currentSpeechText = hostiles[Math.floor(Math.random() * hostiles.length)];
          this.moveSpeed = 3.1; // Aggressive lunge speed!
        }
      } else if (this.type === EntityType.HOUND) {
        if (this.intimidatedTimer > 0.1) {
          this.currentSpeechText = "*ROSNADO AMEDRONTADO*";
        } else if (this.isChasing) {
          this.currentSpeechText = "*LATIDOS HISTÉRICOS*";
        } else {
          this.currentSpeechText = "*PASSOS RÁPIDOS NA ESCURIDÃO*";
        }
      } else if (this.type === EntityType.DULLER) {
        if (this.map.grid[this.gridX][this.gridZ] === CellType.SOLID) {
          this.currentSpeechText = "*RUÍDOS DE PAREDE RASPANDO*";
        } else {
          this.currentSpeechText = "...";
        }
      } else if (this.type === EntityType.CLUMP) {
        if (this.isChasing) {
          this.currentSpeechText = "*BATIDAS DE MEMBROS CORRENDO*";
        } else {
          this.currentSpeechText = "*ARRANHÕES EMBALADOS*";
        }
      } else if (this.type === EntityType.WRETCH) {
        if (this.isChasing) {
          this.currentSpeechText = "NÃO ESCAPE DA CRISE!";
        } else {
          this.currentSpeechText = "*MURMÚRIOS INSANOS*";
        }
      } else if (this.type === EntityType.FINGER_KING) {
        // Mostly silent — the taps (GameEngine) carry the warning, not text.
        if (this.hunting) {
          this.currentSpeechText = "*DEDOS ARRASTANDO NAS PAREDES*";
        } else if (this.isChasing) {
          this.currentSpeechText = "*tec tec tec tec*";
        } else {
          this.currentSpeechText = "";
        }
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
    if (this.map.level === 2 || this.map.level === 3) {
      this.isChasing = true;
      // Boost movement speeds dramatically on Level 2/3 to make it a fast, heart-pounding sprint chase!
      if (this.type === EntityType.HOUND) {
        this.moveSpeed = 3.65;
      } else if (this.type === EntityType.CLUMP) {
        this.moveSpeed = 3.3;
      } else if (this.type === EntityType.DULLER) {
        this.moveSpeed = 3.1;
      } else if (this.type === EntityType.SKIN_STEALER) {
        this.moveSpeed = 3.8;
        this.isAgitated = true;
      } else if (this.type === EntityType.WRETCH) {
        this.moveSpeed = 3.4;
      } else {
        this.moveSpeed = 3.2;
      }
    } else {
      this.isChasing = false;
    }

    if (this.map.level !== 2 && this.map.level !== 3) {
      if (this.type === EntityType.HOUND) {
        // Intimidation Gaze logic!
        // Compute player gaze orientation against the Hound's relative direction
        const pPos3 = new THREE.Vector3(playerX, 1.6, playerZ);
        const toHoundDir = new THREE.Vector3().subVectors(this.mesh.position, pPos3).normalize();
        
        const isGazedAt = cameraDir ? cameraDir.dot(toHoundDir) > 0.81 : false;

        if (isGazedAt && distanceMeters < 16.0) {
          // Player maintains high-tension eye contact! Hound freezes or retreats
          this.intimidatedTimer = 1.2; // freeze lingering
          this.moveSpeed = 0.25; // Backs away very slowly
          this.isChasing = false;
        } else {
          if (this.intimidatedTimer > 0.0) {
            this.intimidatedTimer -= delta;
          }

          // Search trigger
          if (distanceMeters < 15.0 && this.intimidatedTimer <= 0.0) {
            this.isChasing = true;
            this.moveSpeed = 3.25; // fast chase sprint!
          } else {
            this.moveSpeed = 1.25; // leisurely crawl pace
          }
        }
      } 
      
      else if (this.type === EntityType.CLUMP) {
        // Hearing mechanic! Has no eyes, scans by sounds
        let localAlertRadius = 10.0;
        if (playerState === "running") {
          localAlertRadius = 24.0; // Hears distant sprinting boots
          this.moveSpeed = 3.9;    // fast rush!
          this.isChasing = distanceMeters <= localAlertRadius;
        } else if (playerState === "crouching") {
          localAlertRadius = 2.2;   // Stealth allows creeping around it safely
          this.moveSpeed = 1.1;
          this.isChasing = distanceMeters <= localAlertRadius;
        } else {
          localAlertRadius = 10.0;  // Standard walking pace
          this.moveSpeed = 2.1;
          this.isChasing = distanceMeters <= localAlertRadius;
        }
      }

      else if (this.type === EntityType.DULLER) {
        // Normal pacing, but wanders into walls
        if (distanceMeters < 12.0) {
          this.isChasing = true;
          this.moveSpeed = 2.0;
        } else {
          this.moveSpeed = 1.1;
        }
      }

      else if (this.type === EntityType.SKIN_STEALER) {
        // Skin-Stealer locks onto player and rushes when agitated (< 5.5m)
        if (this.isAgitated) {
          this.isChasing = true;
          this.moveSpeed = 3.1;
        } else {
          this.isChasing = false;
          this.moveSpeed = 1.0;
        }
      }

      else if (this.type === EntityType.WRETCH) {
        // Relentless pursuer once spotted within 16 meters
        if (distanceMeters < 16.0) {
          this.isChasing = true;
          this.moveSpeed = 2.45;
        } else {
          this.moveSpeed = 1.45;
        }
      }

      else if (this.type === EntityType.FINGER_KING) {
        // Senses further and moves faster the longer you stay on Level G.
        // Never out-runs a sprinting explorer (4.2 m/s): the final chase is
        // a race you can win, not a death sentence.
        const senseRadius = 7 + 11 * this.aggression;
        if (this.hunting) {
          this.isChasing = true;
          this.moveSpeed = 3.7;
        } else if (this.targetHidden && distanceMeters > 2.2) {
          this.isChasing = false;
          this.moveSpeed = 1.0 + 0.8 * this.aggression;
        } else if (distanceMeters < senseRadius) {
          this.isChasing = true;
          this.moveSpeed = 1.9 + 1.5 * this.aggression;
        } else {
          this.isChasing = false;
          this.moveSpeed = 1.0 + 0.8 * this.aggression;
        }
      }
    }

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

  /**
   * Evaluates next target tile candidate.
   * Leverages custom AI mechanics (noclip for Duller, chase lock, random walks)
   */
  private chooseNextTarget(pXg: number, pZg: number) {
    if (this.type === EntityType.FINGER_KING) {
      this.chooseFingerKingStep(pXg, pZg);
      return;
    }

    const directions = [
      [0, -1], // North
      [0, 1],  // South
      [-1, 0], // West
      [1, 0]   // East
    ];

    // If chasing, try and select a node which brings grid distance closer to player's grid tile
    if (this.isChasing) {
      let bestDir: [number, number] | null = null;
      let minDistance = 99999;

      directions.forEach(([dx, dz]) => {
        const nx = this.gridX + dx;
        const nz = this.gridZ + dz;

        // Verify borders
        if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
          const isSolid = this.map.grid[nx][nz] === CellType.SOLID;
          
          // Only Duller can bypass solid constraints! (Noclip capability with 50% probability)
          const canWalk = !isSolid || (this.type === EntityType.DULLER && Math.random() < 0.50);

          if (canWalk) {
            // Euclidean grid distance to player's grid position
            const gd = Math.pow(nx - pXg, 2) + Math.pow(nz - pZg, 2);
            if (gd < minDistance) {
              minDistance = gd;
              bestDir = [nx, nz];
            }
          }
        }
      });

      if (bestDir) {
        const [tx, tz] = bestDir;
        this.targetGridX = tx;
        this.targetGridZ = tz;
        this.isMoving = true;
        this.transitionProgress = 0.0;
        return;
      }
    }

    // Default or Fallback random pacing patrolling
    const walkableCandidates: [number, number][] = [];

    directions.forEach(([dx, dz]) => {
      const nx = this.gridX + dx;
      const nz = this.gridZ + dz;

      if (nx >= 2 && nx < this.map.gridSize - 2 && nz >= 2 && nz < this.map.gridSize - 2) {
        const isSolid = this.map.grid[nx][nz] === CellType.SOLID;
        
        // Duller wall-noclip choice probability when wandering
        const canWalk = !isSolid || (this.type === EntityType.DULLER && Math.random() < 0.35);

        if (canWalk) {
          walkableCandidates.push([nx, nz]);
        }
      }
    });

    if (walkableCandidates.length > 0) {
      const select = walkableCandidates[Math.floor(Math.random() * walkableCandidates.length)];
      this.targetGridX = select[0];
      this.targetGridZ = select[1];
      this.isMoving = true;
      this.transitionProgress = 0.0;
    } else {
      this.pauseTimer = 0.5;
    }
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
      if (this.fingerCanEnter(nx, nz)) options.push([nx, nz]);
    }
    if (options.length > 0) {
      [this.targetGridX, this.targetGridZ] = options[Math.floor(Math.random() * options.length)];
      this.isMoving = true;
      this.transitionProgress = 0.0;
    } else {
      this.pauseTimer = 0.5;
    }
  }

  private fingerCanEnter(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.map.gridSize || z >= this.map.gridSize) return false;
    if (this.map.grid[x][z] === CellType.SOLID) return false;
    if (!this.map.isWalkableForEntities(x, z)) return false;
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
        if (!this.fingerCanEnter(nx, nz)) continue;
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
