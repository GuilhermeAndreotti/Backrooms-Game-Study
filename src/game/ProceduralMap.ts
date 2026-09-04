/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { DynamicLightSource } from "./LightPool";
import { QualityProfile, getQualityProfile } from "./Quality";

// Deterministic Mulbery32 Random Number Generator
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  public next(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public nextInt(min: number, max: number): number {
    return Math.floor(this.nextRange(min, max));
  }
}

export enum CellType {
  SOLID = 0,      // Wall pillar block
  CORRIDOR = 1,   // Standard hallway
  ROOM_SMALL = 2, // Cozy isolated spaces
  ROOM_LARGE = 3, // Wide yellow chambers
  OPEN_AREA = 4,  // Open pillared hall
  PIT_ROOM = 5,   // Floor with deep black drop-cuts
  ARCH_ROOM = 6,  // Elegant plaster colonnade/archway partitions
  RED_ROOM = 7,   // Mysterious silent-draining red room
}

export interface LightFixture {
  mesh: THREE.Mesh;
  /** Pooled light request; no GPU light is owned by the fixture itself. */
  light: DynamicLightSource;
  intensity: number;
  flickerTimer: number;
  gridX: number;
  gridZ: number;
  dust?: THREE.Points;
}

export class ProceduralMap {
  public gridSize = 48; // Grid size limit (e.g., 48x48 blocks)
  public cellSize = 4;  // Size of one cell in units/meters
  public grid: CellType[][] = [];
  public roomsList: { x: number; z: number; w: number; h: number }[] = [];
  public lightFixtures: LightFixture[] = [];
  private prng: SeededRandom;
  private seed: number;

  // Visual materials reused across tiles for optimal memory / rendering
  private carpetMaterial!: THREE.Material;
  private redCarpetMaterial!: THREE.Material;
  private wallMaterial!: THREE.Material;
  private skirtingBoardMaterial!: THREE.Material;
  private ceilingMaterial!: THREE.Material;
  private fluorescentGlassOn!: THREE.Material;
  private fluorescentGlassOff!: THREE.Material;
  private fluorescentCaseMaterial!: THREE.Material;
  private dustTexture: THREE.Texture | null = null;

  // Cells caches for dynamic proximity culling
  public cellGroups: Map<string, THREE.Group> = new Map();
  public cellGroupGrid: (THREE.Group | null)[][] = Array.from({ length: 48 }, () => Array(48).fill(null));
  public cellObstacles: Map<string, { x: number; z: number; radius: number }[]> = new Map();
  /** Cell streaming radius in meters; follows the active quality preset. */
  public maxVisibleDistance = 24;
  private visibleCellKeys = new Set<string>();

  // Pre-allocation of projection/frustum objects to completely eliminate GC collection during frame updates
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  public activeCellsForCulling: { group: THREE.Group; box: THREE.Box3 }[] = [];

  // Shared static geometries for high-performance reuse (removes garbage collection lag!)
  private floorGeo!: THREE.PlaneGeometry;
  private ceilGeo!: THREE.PlaneGeometry;
  private wallGeo!: THREE.PlaneGeometry;
  private baseGeo!: THREE.BoxGeometry;
  private pillarGeo!: THREE.BoxGeometry;
  private caseGeo!: THREE.BoxGeometry;
  private tubeGeo!: THREE.CylinderGeometry;
  private unitBoxGeo!: THREE.BoxGeometry;
  private pitGeoWall!: THREE.PlaneGeometry;
  private pitGeoFloor!: THREE.PlaneGeometry;
  private barrelCylinderGeo!: THREE.CylinderGeometry;
  private barrelRimGeo!: THREE.TorusGeometry;
  private boilerPipeVerticalGeo!: THREE.CylinderGeometry;
  private boilerPipeElbowGeo!: THREE.TorusGeometry;
  private boilerDialPlateGeo!: THREE.CylinderGeometry;
  private boilerIndicatorGeo!: THREE.SphereGeometry;
  private boilerValveShaftGeo!: THREE.CylinderGeometry;
  private boilerValveWheelGeo!: THREE.TorusGeometry;
  private anomalyOuterGeo!: THREE.SphereGeometry;
  private anomalyInnerGeo!: THREE.TorusGeometry;
  private deskTopGeo!: THREE.BoxGeometry;
  private deskLegGeo!: THREE.CylinderGeometry;
  private paperGeo!: THREE.PlaneGeometry;
  private lampBaseGeo!: THREE.CylinderGeometry;
  private lampShadeGeo!: THREE.ConeGeometry;

  // Prop and divider geometries & materials for reuse
  private dividerGeo!: THREE.BoxGeometry;
  private partitionBaseGeo!: THREE.BoxGeometry;
  private chairSeatGeo!: THREE.BoxGeometry;
  private chairBackGeo!: THREE.BoxGeometry;
  private chairStemGeo!: THREE.CylinderGeometry;
  private chairLegGeo!: THREE.BoxGeometry;
  private boxGeo!: THREE.BoxGeometry;

  private fabricMaterial!: THREE.Material;
  private plasticMaterial!: THREE.Material;
  private metalMaterial!: THREE.Material;
  private cardboardBoxMaterial!: THREE.Material;
  private tapeMaterial!: THREE.Material;
  private anomalyMaterial!: THREE.Material;

  // Track animating/glitching meshes
  public animatingMeshes: { mesh: THREE.Object3D; type: "bob" | "spin" | "glitch"; initialY: number; phase: number; gridX: number; gridZ: number }[] = [];

  // Wet spilling & drip assets based on Backrooms Level 0 lore
  public wetSpills = new Set<string>();
  public waterDrips: {
    dropMesh: THREE.Mesh;
    rippleMesh: THREE.Mesh;
    puddleX: number;
    puddleZ: number;
    timer: number;
    frequence: number;
    progress: number;
    hasDripped: boolean;
    gridX: number;
    gridZ: number;
  }[] = [];

  private puddleGeo!: THREE.CircleGeometry;
  private leakStainGeo!: THREE.CircleGeometry;
  private dropGeo!: THREE.SphereGeometry;
  private rippleGeo!: THREE.RingGeometry;

  private puddleMaterial!: THREE.Material;
  private leakStainMaterial!: THREE.Material;
  private dropMaterial!: THREE.Material;
  private rippleMaterial!: THREE.Material;

  // Consumable items for Level 1
  public consumables: {
    mesh: THREE.Object3D;
    initialY: number;
    collected: boolean;
    type: "almond_water" | "energy_bar" | "old_photo" | "rusty_key" | "cassette_tape" | "strange_crystal" | "liquid_pain" | "diary_page" | "scrap_of_note";
    x: number;
    z: number;
    gridX: number;
    gridZ: number;
  }[] = [];

  // Exit point properties (the Far Exit)
  public exitGridX = 0;
  public exitGridZ = 0;

  // Guaranteed landmark chair pyramid coordinates on Level 0
  public chairPyramidX = -1;
  public chairPyramidZ = -1;

  // Path coordinates leading to the exit
  public exitPath: [number, number][] = [];
  public exitPathSet = new Set<string>();
  /**
   * Grid -> index into {@link exitPath}, or -1. Replaces a linear findIndex that
   * ran on the exit path every frame once the guidance draft kicks in.
   */
  public exitPathIndexGrid = new Int32Array(48 * 48).fill(-1);

  // Random Environmental Event States
  private eventCooldown = 15.0; // Seconds between event rolls
  public globalEventState: "normal" | "flicker_storm" | "blackout" = "normal";
  private globalEventTimer = 0.0;

  public level = 0;

  /** Quality budget driving light counts, particle counts and view distance. */
  public quality: QualityProfile;

  /**
   * Every point light the level wants, handed to the LightPool which binds only
   * the nearest few to real THREE.PointLight instances.
   */
  public dynamicLights: DynamicLightSource[] = [];

  /**
   * Per-frame work lists rebuilt only when the player crosses a cell boundary.
   * Iterating the whole level every frame is what made large maps stutter.
   */
  public activeLightFixtures: LightFixture[] = [];
  public activeWaterDrips: ProceduralMap["waterDrips"] = [];
  public activeAnimatingMeshes: ProceduralMap["animatingMeshes"] = [];
  public activeConsumables: ProceduralMap["consumables"] = [];

  /** Obstacle lookup as a dense grid: avoids per-frame string key allocation. */
  private obstacleGrid: ({ x: number; z: number; radius: number }[] | null)[][] =
    Array.from({ length: 48 }, () => Array(48).fill(null));

  /**
   * Shared props/materials created on demand and reused by every cell.
   * Previously each cell allocated its own pipes/materials, which on Level 2
   * meant thousands of duplicate GPU buffers for identical objects.
   */
  private sharedGeometries = new Map<string, THREE.BufferGeometry>();
  private sharedMaterials = new Map<string, THREE.Material>();
  private sharedTextures: THREE.Texture[] = [];

  // Culling optimization tracking positions to avoid repetitive 60fps culling recalculations
  private lastCulledX = -9999;
  private lastCulledZ = -9999;

  constructor(seed: number, level = 0, quality?: QualityProfile) {
    this.seed = seed;
    this.level = level;
    this.quality = quality ?? getQualityProfile("medium");
    // Stay within the fog cutoff; Level 1 (warehouse) is more open so it needs
    // a little more reach. The quality profile scales both.
    this.maxVisibleDistance = this.quality.viewDistance * (level === 1 ? 1.15 : 1.0);
    this.prng = new SeededRandom(seed);
    this.initMaterials();
    this.generateGrid();
    this.findExitPath();
  }

  /**
   * Returns a geometry shared by every cell that asks for the same `key`.
   * Cells used to build their own identical pipes/pillars, which allocated
   * thousands of duplicate vertex buffers on the bigger levels.
   */
  private sharedGeo<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
    let geo = this.sharedGeometries.get(key);
    if (!geo) {
      geo = build();
      this.sharedGeometries.set(key, geo);
    }
    return geo as T;
  }

  /** Same idea as {@link sharedGeo}, for materials (and their shader programs). */
  private sharedMat<T extends THREE.Material>(key: string, build: () => T): T {
    let mat = this.sharedMaterials.get(key);
    if (!mat) {
      mat = build();
      this.sharedMaterials.set(key, mat);
    }
    return mat as T;
  }

  /**
   * Declares a point light without allocating one. The LightPool binds only the
   * handful nearest to the player, so a level can want hundreds of lamps while
   * the renderer only ever sees a small, constant number of them.
   */
  public registerLight(
    gx: number,
    gz: number,
    x: number,
    y: number,
    z: number,
    color: number,
    intensity: number,
    distance: number,
    decay = 1.0
  ): DynamicLightSource {
    const source: DynamicLightSource = {
      x, y, z,
      color,
      baseIntensity: intensity,
      intensity,
      distance,
      decay,
      gridX: gx,
      gridZ: gz,
    };
    this.dynamicLights.push(source);
    return source;
  }

  /**
   * Additive billboard used in place of the tiny point lights that used to sit
   * inside every collectible. It reads as a glow from much further away and
   * costs one transparent sprite instead of a full lighting pass.
   */
  public createItemGlow(color: number, size = 0.85, opacity = 0.5): THREE.Sprite {
    const material = this.sharedMat(`glow_${color}_${opacity}`, () => {
      return new THREE.SpriteMaterial({
        map: this.getGlowTexture(),
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    }) as THREE.SpriteMaterial;

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  private glowTexture: THREE.Texture | null = null;

  private getGlowTexture(): THREE.Texture {
    if (this.glowTexture) return this.glowTexture;

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    this.glowTexture = new THREE.CanvasTexture(canvas);
    this.sharedTextures.push(this.glowTexture);
    return this.glowTexture;
  }

  /**
   * BFS Solver to compute shortest path from spawn (2,2) to exit coordinates
   */
  public findExitPath() {
    const startX = 2;
    const startZ = 2;
    const endX = this.exitGridX;
    const endZ = this.exitGridZ;

    const queue: [number, number][][] = [[[startX, startZ]]];
    const visited = new Set<string>();
    visited.add(`${startX},${startZ}`);

    const dirs = [
      [0, -1], [0, 1], [-1, 0], [1, 0]
    ];

    let foundPath: [number, number][] = [];
    while (queue.length > 0) {
      const path = queue.shift()!;
      const [cx, cz] = path[path.length - 1];

      if (cx === endX && cz === endZ) {
        foundPath = path;
        break;
      }

      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx >= 0 && nx < this.gridSize && nz >= 0 && nz < this.gridSize) {
          if (this.grid[nx][nz] !== CellType.SOLID) {
            const key = `${nx},${nz}`;
            if (!visited.has(key)) {
              visited.add(key);
              queue.push([...path, [nx, nz]]);
            }
          }
        }
      }
    }

    this.exitPath = foundPath;
    this.exitPathSet.clear();
    this.exitPathIndexGrid.fill(-1);
    foundPath.forEach(([x, z], idx) => {
      this.exitPathSet.add(`${x},${z}`);
      this.exitPathIndexGrid[x * this.gridSize + z] = idx;
    });

    // Populate wet spills along the shortest path as a subtle navigation cue (Level 0 wet carpets)
    this.wetSpills.clear();
    foundPath.forEach(([x, z], idx) => {
      // Skip the starting cell and highlight every 4th step on the path
      if (idx > 0 && idx % 4 === 2) {
        this.wetSpills.add(`${x},${z}`);
      }
    });

    // Populate extra random damp spots around Level 1 / Level 0 to maintain cohesive thematic environment of moist carpets / concrete
    const leakRng = new SeededRandom(this.seed + 999);
    for (let x = 2; x < this.gridSize - 2; x++) {
      for (let z = 2; z < this.gridSize - 2; z++) {
        if (this.grid[x][z] !== CellType.SOLID && !this.wetSpills.has(`${x},${z}`)) {
          const isLevel1Aquila = (this.level === 1 && x < 24 && z < 24);
          const threshold = isLevel1Aquila ? 0.78 : 0.93; // 22% rate in Aquila Sector, 7% elsewhere!
          if (leakRng.next() > threshold) {
            this.wetSpills.add(`${x},${z}`);
          }
        }
      }
    }
  }

  /**
   * Generates a subtler wall-mounted crimson arrow decal pointing left or right in local space
   */
  private createWallArrowMesh(direction: "left" | "right"): THREE.Group {
    const arrow = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9c1a1a, // Creepy hand-painted crimson red spray-pant hue
      roughness: 0.95,
      metalness: 0.0
    });

    const isLeft = direction === "left";

    // Main horizontal stem of the arrow
    const stemGeo = new THREE.BoxGeometry(0.35, 0.04, 0.008);
    const stem = new THREE.Mesh(stemGeo, mat);
    stem.position.set(0, 0, 0.004);
    arrow.add(stem);

    // Diagonal chevron arms of the arrow head
    const armGeo = new THREE.BoxGeometry(0.14, 0.035, 0.008);

    const headX = isLeft ? -0.15 : 0.15;
    const angleMult = isLeft ? 1 : -1;

    const armUpper = new THREE.Mesh(armGeo, mat);
    armUpper.position.set(headX, 0.045, 0.004);
    armUpper.rotation.z = angleMult * Math.PI / 4;
    arrow.add(armUpper);

    const armLower = new THREE.Mesh(armGeo, mat);
    armLower.position.set(headX, -0.045, 0.004);
    armLower.rotation.z = -angleMult * Math.PI / 4;
    arrow.add(armLower);

    return arrow;
  }

  /**
   * Helper to compute if an arrow placed on a given wall should point "left" or "right"
   * to guide the player towards the exit step.
   */
  private getPathArrowDirection(gx: number, gz: number, wallType: 'N' | 'S' | 'W' | 'E'): 'left' | 'right' | null {
    const pathIdx = this.exitPath.findIndex(([x, z]) => x === gx && z === gz);
    if (pathIdx === -1 || pathIdx >= this.exitPath.length - 1) return null;

    const [nextX, nextZ] = this.exitPath[pathIdx + 1];
    const dx = nextX - gx;
    const dz = nextZ - gz;

    if (wallType === 'N') {
      // North Wall: facing -Z (North). Left is -X (West), Right is +X (East).
      if (dx > 0) return 'right';
      if (dx < 0) return 'left';
      for (let i = pathIdx + 2; i < this.exitPath.length; i++) {
        const pX = this.exitPath[i][0];
        if (pX > gx) return 'right';
        if (pX < gx) return 'left';
      }
      return 'right';
    }

    if (wallType === 'S') {
      // South Wall: facing +Z (South). Left is +X (East), Right is -X (West).
      if (dx > 0) return 'left';
      if (dx < 0) return 'right';
      for (let i = pathIdx + 2; i < this.exitPath.length; i++) {
        const pX = this.exitPath[i][0];
        if (pX > gx) return 'left';
        if (pX < gx) return 'right';
      }
      return 'left';
    }

    if (wallType === 'W') {
      // West Wall: facing -X (West). Left is +Z (South), Right is -Z (North).
      if (dz > 0) return 'left';
      if (dz < 0) return 'right';
      for (let i = pathIdx + 2; i < this.exitPath.length; i++) {
        const pZ = this.exitPath[i][1];
        if (pZ > gz) return 'left';
        if (pZ < gz) return 'right';
      }
      return 'right';
    }

    if (wallType === 'E') {
      // East Wall: facing +X (East). Left is -Z (North), Right is +Z (South).
      if (dz > 0) return 'right';
      if (dz < 0) return 'left';
      for (let i = pathIdx + 2; i < this.exitPath.length; i++) {
        const pZ = this.exitPath[i][1];
        if (pZ > gz) return 'right';
        if (pZ < gz) return 'left';
      }
      return 'right';
    }

    return null;
  }

  /**
   * Generates a wooden table with a note written in Portuguese (instructing how to noclip)
   */
  private createDeskWithPaperMesh(): THREE.Group {
    const desk = new THREE.Group();

    // Tabletop
    const woodMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d3224, // dark rustic wood
      roughness: 0.8,
      metalness: 0.05
    });
    const top = new THREE.Mesh(this.deskTopGeo, woodMaterial);
    top.position.set(0, 0.72, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    desk.add(top);

    // 4 metal legs
    const metalLegMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.6,
      metalness: 0.8
    });

    const legsPos = [
      [-0.55, 0.35, -0.28],
      [0.55, 0.35, -0.28],
      [-0.55, 0.35, 0.28],
      [0.55, 0.35, 0.28]
    ];

    legsPos.forEach(([lx, ly, lz]) => {
      const leg = new THREE.Mesh(this.deskLegGeo, metalLegMat);
      leg.position.set(lx, ly, lz);
      leg.castShadow = true;
      desk.add(leg);
    });

    // A piece of paper on the table
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fcf9eb"; // rustic aged paper
      ctx.fillRect(0, 0, 512, 256);
      
      // Blue guidelines
      ctx.strokeStyle = "rgba(0, 80, 255, 0.09)";
      ctx.lineWidth = 1.2;
      for (let y = 35; y < 256; y += 22) {
        ctx.beginPath();
        ctx.moveTo(15, y);
        ctx.lineTo(497, y);
        ctx.stroke();
      }

      ctx.fillStyle = "#1e1b17"; // handwritten ink
      ctx.textAlign = "center";
      
      if (this.level === 1) {
        ctx.font = "bold 17px Courier New, monospace";
        ctx.fillText("ACESSO DE MANUTENCAO (LEVEL 2)", 256, 38);
        
        ctx.font = "bold 13px Courier New, monospace";
        ctx.fillText("O vapor e o metal enferrujado cobrem este setor.", 256, 75);
        ctx.fillText("Este corredor estreito leva ao temido Level 2.", 256, 105);
        ctx.fillText("Ao encontrar o portal de metal e vapor a frente,", 256, 135);
        ctx.fillText("empurre-o com forca, corra em sua direcao", 256, 165);
        ctx.fillText("e comece a PULAR repetidamente para atravessar.", 256, 195);
        ctx.fillText("Rompendo o espaco fisico, voce avancara!", 256, 225);
      } else {
        ctx.font = "bold 17px Courier New, monospace";
        ctx.fillText("COMO ESCAPAR DESTAS PAREDES (LEVEL 0)", 256, 38);
        
        ctx.font = "bold 13px Courier New, monospace";
        ctx.fillText("Este labirinto e uma simulacao dimensional.", 256, 75);
        ctx.fillText("Nao existem portas ou saidas fisicas normais.", 256, 105);
        ctx.fillText("Para fazer o NOCLIP (FLIPAR) na parede verde,", 256, 135);
        ctx.fillText("voce deve correr e se chocar contra ela,", 256, 165);
        ctx.fillText("ficando PULANDO SEM PARAR ate atravessar.", 256, 195);
        ctx.fillText("Continue pulando e empurrando a parede!", 256, 225);
      }
    }
    const paperTex = new THREE.CanvasTexture(canvas);
    const paperMat = new THREE.MeshBasicMaterial({ map: paperTex, side: THREE.DoubleSide });
    const paper = new THREE.Mesh(this.paperGeo, paperMat);
    paper.rotation.x = -Math.PI / 2;
    paper.position.set(0, 0.742, 0);
    desk.add(paper);

    // Lamp standing on Table to cast light onto the paper
    const lampBase = new THREE.Mesh(this.lampBaseGeo, metalLegMat);
    lampBase.position.set(-0.4, 0.745, -0.15);
    desk.add(lampBase);

    const lampShade = new THREE.Mesh(this.lampShadeGeo, metalLegMat);
    lampShade.position.set(-0.4, 0.87, -0.15);
    lampShade.rotation.x = 0.3;
    desk.add(lampShade);

    // Warm yellowish glow source
    const lampLight = new THREE.PointLight(0xffdf80, 2.0, 5, 1.2);
    lampLight.position.set(-0.4, 0.81, -0.15);
    desk.add(lampLight);

    return desk;
  }

  private createDustMoteTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
      grad.addColorStop(0.35, "rgba(235, 215, 140, 0.5)");
      grad.addColorStop(1, "rgba(255, 255, 255, 0.0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  private createLocalDustCloud(): THREE.Points {
    const particleCount = this.quality.fixtureDustParticles;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    const radius = 1.4;
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      positions[i * 3] = r * Math.cos(theta);
      positions[i * 3 + 1] = Math.random() * 2.75;
      positions[i * 3 + 2] = r * Math.sin(theta);
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    if (!this.dustTexture) {
      this.dustTexture = this.createDustMoteTexture();
    }

    // Cloned from one shared prototype: cloning keeps the per-lamp opacity
    // animation independent while reusing the same texture and shader program.
    const material = this.sharedMat("fixture_dust", () => new THREE.PointsMaterial({
      color: 0xdeb81d,
      size: 0.06,
      map: this.dustTexture,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })).clone();

    return new THREE.Points(geometry, material);
  }

  private createWallTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Base yellowish color
      ctx.fillStyle = "#cdc38d";
      ctx.fillRect(0, 0, 256, 256);

      // Subtle noise/dirt overlay for rotting damp walls
      for (let i = 0; i < 5000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = Math.random() * 1.5;
        const opacity = Math.random() * 0.12;
        ctx.fillStyle = `rgba(80, 70, 40, ${opacity})`;
        ctx.fillRect(x, y, size, size);
      }

      // Vertical stripe/pattern lines (classic Backrooms wallpaper)
      ctx.strokeStyle = "rgba(100, 90, 50, 0.22)";
      ctx.lineWidth = 1.5;
      for (let x = 8; x < 256; x += 16) {
        // Draw elegant vertical wallpaper lines
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();

        // Draw vertical dotted / dashes
        ctx.beginPath();
        ctx.strokeStyle = "rgba(80, 72, 36, 0.15)";
        ctx.setLineDash([4, 12]);
        ctx.moveTo(x - 4, 0);
        ctx.lineTo(x - 4, 256);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(100, 90, 50, 0.22)";
      }

      // Horizontal subtle gradient damp stains (wallpaper moisture)
      for (let j = 0; j < 3; j++) {
        const stainY = Math.random() * 200;
        const stainH = 30 + Math.random() * 40;
        const grad = ctx.createLinearGradient(0, stainY, 0, stainY + stainH);
        grad.addColorStop(0, "rgba(90, 75, 45, 0.16)");
        grad.addColorStop(0.5, "rgba(90, 75, 45, 0.06)");
        grad.addColorStop(1, "rgba(90, 75, 45, 0.0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, stainY, 256, stainH);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 3); // Repeats perfectly to cover cells which are 4m wide x 3m high
    return texture;
  }

  private createConcreteWallTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.Texture();

    // Base concrete grey color (much lighter for superior illumination)
    ctx.fillStyle = "#949494"; 
    ctx.fillRect(0, 0, 512, 512);

    // Render lots of randomized organic noise/spots for concrete grit and gravel
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = 0.5 + Math.random() * 1.5;
      const val = Math.random();
      if (val < 0.4) {
        ctx.fillStyle = "rgba(40, 40, 40, 0.15)"; // dark grit
      } else if (val < 0.8) {
        ctx.fillStyle = "rgba(220, 220, 220, 0.12)"; // light limestone grit
      } else {
        ctx.fillStyle = "rgba(120, 100, 80, 0.08)"; // rusty splash
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wet seepage or water leaks staining down the concrete walls
    for (let i = 0; i < 15; i++) {
      const startX = Math.random() * 512;
      const height = 150 + Math.random() * 300;
      const width = 8 + Math.random() * 25;
      
      const grad = ctx.createLinearGradient(startX, 0, startX + width, 0);
      grad.addColorStop(0, "rgba(45, 40, 35, 0.0)");
      grad.addColorStop(0.3, "rgba(40, 37, 33, 0.25)"); // damp stain
      grad.addColorStop(0.7, "rgba(40, 37, 33, 0.25)");
      grad.addColorStop(1, "rgba(45, 40, 35, 0.0)");

      ctx.fillStyle = grad;
      ctx.fillRect(startX, 0, width, height);
    }

    // Concrete block pane seams/joints (horizontal joint running at middle, and 2 vertical panels joints)
    ctx.strokeStyle = "rgba(30, 30, 30, 0.45)";
    ctx.lineWidth = 4;
    
    // Horizontal seam (middle)
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(512, 256);
    ctx.stroke();

    // Vertical panel joints
    ctx.beginPath();
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 256);
    ctx.moveTo(384, 0);
    ctx.lineTo(384, 256);
    ctx.moveTo(256, 256);
    ctx.lineTo(256, 512);
    ctx.stroke();

    // Formwork tie-rod holes in the concrete (standard architectural concrete circles)
    ctx.fillStyle = "rgba(35, 35, 35, 0.55)";
    ctx.strokeStyle = "rgba(10, 10, 10, 0.35)";
    ctx.lineWidth = 1.5;
    
    const holes = [
      [64, 64], [192, 64], [320, 64], [448, 64],
      [64, 192], [192, 192], [320, 192], [448, 192],
      [64, 320], [192, 320], [320, 320], [448, 320],
      [64, 448], [192, 448], [320, 448], [448, 448],
    ];
    holes.forEach(([hx, hy]) => {
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 3); // repeat across 4m x 3m wall panel
    return texture;
  }

  private createConcreteFloorTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.Texture();

    // Concrete flooring base (much lighter concrete grey color)
    ctx.fillStyle = "#a8a8a8";
    ctx.fillRect(0, 0, 512, 512);

    // Noise/limestone/oil spills
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = 0.5 + Math.random() * 2.0;
      const val = Math.random();
      if (val < 0.4) {
        ctx.fillStyle = "rgba(25, 25, 25, 0.18)";
      } else if (val < 0.75) {
        ctx.fillStyle = "rgba(240, 240, 240, 0.1)";
      } else {
        ctx.fillStyle = "rgba(100, 75, 45, 0.08)"; // dirt/rust stain
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wet moisture stains and dark fluid puddle rings (oil spots!)
    for (let i = 0; i < 8; i++) {
      const rx = Math.random() * 512;
      const ry = Math.random() * 512;
      const rSize = 25 + Math.random() * 60;
      ctx.fillStyle = "rgba(35, 30, 25, 0.22)"; // organic brown spill
      ctx.beginPath();
      ctx.arc(rx, ry, rSize, 0, Math.PI * 2);
      ctx.fill();

      // Core of puddle (even darker oil spot)
      ctx.fillStyle = "rgba(20, 20, 20, 0.25)";
      ctx.beginPath();
      ctx.arc(rx + Math.random() * 10 - 5, ry + Math.random() * 10 - 5, rSize * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Structural concrete floor cracks! Very industrial
    ctx.strokeStyle = "rgba(25, 25, 25, 0.45)";
    ctx.lineWidth = 1.2;
    for (let c = 0; c < 3; c++) {
      let cx = Math.random() * 512;
      let cy = Math.random() * 512;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      // draw segmented crack line
      for (let segment = 0; segment < 6; segment++) {
        cx += -35 + Math.random() * 70;
        cy += -35 + Math.random() * 70;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  private createMetalCeilingTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.Texture();

    // Dark grey corrugated iron / steel ceiling base (lighter grey for brightness)
    ctx.fillStyle = "#808588";
    ctx.fillRect(0, 0, 256, 256);

    // Draw horizontal slats / corrugated sheet iron pattern
    for (let y = 0; y < 256; y += 16) {
      // Draw shadow for 3D depth of slat
      ctx.fillStyle = "rgba(10, 10, 10, 0.55)";
      ctx.fillRect(0, y, 256, 4);

      // Draw light highlight on the top ridge of slat
      ctx.fillStyle = "rgba(230, 230, 230, 0.15)";
      ctx.fillRect(0, y + 4, 256, 3);
    }

    // Add metallic texture speckles and rusting along the panel grooves
    for (let i = 0; i < 800; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      ctx.fillStyle = Math.random() > 0.6 ? "rgba(150, 95, 45, 0.12)" : "rgba(30, 30, 30, 0.15)";
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8); // nice corrugated frequency
    return texture;
  }

  private createRedCarpetTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Base red carpet color (damp, dark, dirty blood-red/crimson)
      ctx.fillStyle = "#591c1c";
      ctx.fillRect(0, 0, 128, 128);

      // Draw random noise to give it a fibrous/pile carpet texture
      for (let i = 0; i < 8000; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const size = 1 + Math.random() * 0.8;
        const tint = Math.random();
        const color = tint > 0.5 ? "rgba(42, 6, 6, 0.4)" : "rgba(132, 45, 45, 0.22)";
        ctx.fillStyle = color;
        ctx.fillRect(x, y, size, size);
      }
      
      // Some slightly larger wet, dirty/stained moisture spots (blackish red)
      for (let j = 0; j < 6; j++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const r = 6 + Math.random() * 14;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(28, 2, 2, 0.52)");
        grad.addColorStop(1, "rgba(28, 2, 2, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4); // Repeats over the 4m x 4m cell floor size
    return texture;
  }

  private createRustedMetalWallTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Base dark industrial copperish grey-brown
      ctx.fillStyle = "#332218";
      ctx.fillRect(0, 0, 512, 512);

      // Add iron scratches and metal grit noise
      for (let i = 0; i < 5000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const radius = 0.5 + Math.random() * 1.5;
        const tint = Math.random();
        if (tint < 0.45) {
          ctx.fillStyle = "rgba(10, 5, 2, 0.4)"; // dark carbon spots
        } else if (tint < 0.85) {
          ctx.fillStyle = "rgba(139, 69, 19, 0.25)"; // rusty orange spots
        } else {
          ctx.fillStyle = "rgba(180, 180, 180, 0.15)"; // steel silver metallic speckles
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw rusted steel sheet panels with vertical and horizontal seams
      ctx.strokeStyle = "rgba(15, 8, 3, 0.8)";
      ctx.lineWidth = 5;
      
      // We will make 4 main panel divisions (2x2 grid)
      ctx.beginPath();
      // Horizontal seam
      ctx.moveTo(0, 256);
      ctx.lineTo(512, 256);
      // Vertical seam
      ctx.moveTo(256, 0);
      ctx.lineTo(256, 512);
      ctx.stroke();

      // Draw rivets/bolts at corners of each panel
      ctx.fillStyle = "#5c3d2e";
      ctx.strokeStyle = "#1a0f0a";
      ctx.lineWidth = 1.5;
      const rivets = [
        [20, 20], [236, 20], [276, 20], [492, 20],
        [20, 236], [236, 236], [276, 236], [492, 236],
        [20, 276], [236, 276], [276, 276], [492, 276],
        [20, 492], [236, 492], [276, 492], [492, 492]
      ];
      rivets.forEach(([rx, ry]) => {
        ctx.beginPath();
        ctx.arc(rx, ry, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Running rust water leak streaks going down
      for (let i = 0; i < 20; i++) {
        const startX = Math.random() * 512;
        const height = 180 + Math.random() * 320;
        const width = 6 + Math.random() * 14;
        
        const grad = ctx.createLinearGradient(startX, 0, startX + width, 0);
        grad.addColorStop(0, "rgba(139, 69, 19, 0.0)");
        grad.addColorStop(0.5, "rgba(120, 40, 5, 0.5)"); // rich thick dripping rust
        grad.addColorStop(1, "rgba(139, 69, 19, 0.0)");
        
        ctx.fillStyle = grad;
        ctx.fillRect(startX, 0, width, height);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 3);
    return texture;
  }

  private createRustedMetalFloorTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Base dark rusted iron floor plate
      ctx.fillStyle = "#1e130c";
      ctx.fillRect(0, 0, 256, 256);

      // Industrial grating pattern (metal grid lines)
      ctx.strokeStyle = "rgba(10, 5, 2, 0.85)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= 256; i += 16) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }

      // Add lots of rust particles and orange speckles
      for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const val = Math.random();
        if (val < 0.6) {
          ctx.fillStyle = "rgba(100, 30, 5, 0.35)"; // orange rust
        } else {
          ctx.fillStyle = "rgba(20, 15, 10, 0.4)"; // dark soot
        }
        ctx.fillRect(x, y, 1.5, 1.5);
      }

      // Massive dark spills/rust corrosion patches
      for (let k = 0; k < 8; k++) {
        const rx = Math.random() * 256;
        const ry = Math.random() * 256;
        const size = 15 + Math.random() * 35;
        const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, size);
        grad.addColorStop(0, "rgba(120, 45, 10, 0.6)");
        grad.addColorStop(0.5, "rgba(70, 25, 5, 0.3)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(rx, ry, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  private createRustedMetalCeilingTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Base dark soot grey
      ctx.fillStyle = "#261c16";
      ctx.fillRect(0, 0, 256, 256);

      // Corrugated metallic lines/shadows
      ctx.fillStyle = "rgba(10, 5, 2, 0.75)";
      for (let x = 0; x < 256; x += 32) {
        ctx.fillRect(x, 0, 12, 256);
      }

      // Splashes of reddish orange corrosion and rust
      for (let i = 0; i < 2000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        if (Math.random() < 0.7) {
          ctx.fillStyle = "rgba(120, 50, 15, 0.32)";
        } else {
          ctx.fillStyle = "rgba(10, 10, 10, 0.5)";
        }
        ctx.fillRect(x, y, 2, 2);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  private createCarpetTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Base carpet color (damp moldy yellow-brown pile)
      ctx.fillStyle = "#82734a";
      ctx.fillRect(0, 0, 128, 128);

      // Draw random noise to give it a fibrous/pile carpet texture
      for (let i = 0; i < 8000; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const size = 1 + Math.random() * 0.8;
        const tint = Math.random();
        const color = tint > 0.5 ? "rgba(65, 55, 30, 0.22)" : "rgba(150, 135, 95, 0.15)";
        ctx.fillStyle = color;
        ctx.fillRect(x, y, size, size);
      }
      
      // Some slightly larger wet, rotten moldy moisture spots
      for (let j = 0; j < 6; j++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const r = 6 + Math.random() * 14;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(55, 45, 25, 0.38)");
        grad.addColorStop(1, "rgba(55, 45, 25, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4); // Repeats over the 4m x 4m cell floor size
    return texture;
  }

  private createCeilingTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Off-white acoustic tile ceiling base
      ctx.fillStyle = "#cfcbb7";
      ctx.fillRect(0, 0, 128, 128);

      // Acoustic dots and texture holes
      for (let i = 0; i < 400; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const size = 0.5 + Math.random() * 1.5;
        ctx.fillStyle = "rgba(60, 58, 50, 0.32)";
        ctx.fillRect(x, y, size, size);
      }

      // Tile borders/grid lines to shape 2x2 grid panels in a cell
      ctx.strokeStyle = "rgba(80, 78, 70, 0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4); // Fits nicely in the 4m x 4m cell ceiling size
    return texture;
  }

  private createCardboardTexture(): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Kraft paper cardboard brown base
      ctx.fillStyle = "#ae8d63";
      ctx.fillRect(0, 0, 128, 128);
      
      // Draw darker fiber lines for packing box texture
      ctx.fillStyle = "rgba(120, 95, 60, 0.25)";
      for (let i = 0; i < 600; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const w = 1 + Math.random() * 20;
        ctx.fillRect(x, y, w, 1);
      }

      // Draw cardboard borders
      ctx.strokeStyle = "rgba(90, 70, 45, 0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  private initMaterials() {
    const hSize = this.cellSize;
    const height = 3.0;

    // Compile and share geometries once to maximize FPS performance
    this.floorGeo = new THREE.PlaneGeometry(hSize, hSize);
    this.floorGeo.rotateX(-Math.PI / 2);

    this.ceilGeo = new THREE.PlaneGeometry(hSize, hSize);
    this.ceilGeo.rotateX(Math.PI / 2);

    this.wallGeo = new THREE.PlaneGeometry(hSize, height);

    this.baseGeo = new THREE.BoxGeometry(hSize, 0.12, 0.05);

    this.pillarGeo = new THREE.BoxGeometry(0.8, height, 0.8);

    this.caseGeo = new THREE.BoxGeometry(1.2, 0.1, 0.4);

    this.tubeGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8);
    this.tubeGeo.rotateZ(Math.PI / 2);

    // Divider Geometries (office partition wall): thickness=0.08m, height=2.3m, depth=1.8m
    this.dividerGeo = new THREE.BoxGeometry(0.08, 2.3, 1.8);
    this.partitionBaseGeo = new THREE.BoxGeometry(0.1, 0.12, 1.8);

    // Office Chairs geometries (low poly for extreme FPS)
    this.chairSeatGeo = new THREE.BoxGeometry(0.55, 0.08, 0.55);
    this.chairBackGeo = new THREE.BoxGeometry(0.5, 0.5, 0.08);
    this.chairStemGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6);
    this.chairLegGeo = new THREE.BoxGeometry(0.55, 0.03, 0.05);

    // Cardboard boxes (brown shipment parcels)
    this.boxGeo = new THREE.BoxGeometry(0.65, 0.65, 0.65);

    // Unit 1x1x1 box geometry used for scaling to prevent expensive dynamic BoxGeometry generation
    this.unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);

    // Pit Room geometries
    this.pitGeoWall = new THREE.PlaneGeometry(1.0, 1.6);
    this.pitGeoFloor = new THREE.PlaneGeometry(1.0, 1.0);

    // Industrial Barrel geometries (low segment count for performance)
    this.barrelCylinderGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.9, 10);
    this.barrelRimGeo = new THREE.TorusGeometry(0.33, 0.02, 4, 10);

    // Boiler parts (very low polygon counts)
    this.boilerPipeVerticalGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.6, 6);
    this.boilerPipeElbowGeo = new THREE.TorusGeometry(0.09, 0.045, 4, 6, Math.PI / 2);
    this.boilerDialPlateGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 8);
    this.boilerIndicatorGeo = new THREE.SphereGeometry(0.025, 3, 3);
    this.boilerValveShaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 4);
    this.boilerValveWheelGeo = new THREE.TorusGeometry(0.12, 0.022, 3, 8);

    // Spatial Energy Anomaly
    this.anomalyOuterGeo = new THREE.SphereGeometry(0.35, 4, 4);
    this.anomalyInnerGeo = new THREE.TorusGeometry(0.18, 0.04, 4, 8);

    // Desk and note
    this.deskTopGeo = new THREE.BoxGeometry(1.3, 0.04, 0.75);
    this.deskLegGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8);
    this.paperGeo = new THREE.PlaneGeometry(0.38, 0.26);
    this.lampBaseGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.015, 8);
    this.lampShadeGeo = new THREE.ConeGeometry(0.08, 0.12, 8);

    // Custom Materials for Props
    this.fabricMaterial = new THREE.MeshStandardMaterial({
      color: 0x615b49, // Dull office fabric hue
      roughness: 0.95,
      metalness: 0.0
    });

    this.plasticMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f1d1d, // Matte dark grey plastic
      roughness: 0.7,
      metalness: 0.1
    });

    this.metalMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e6e6e, // Industrial steel
      roughness: 0.4,
      metalness: 0.8
    });

    const boxTex = this.createCardboardTexture();
    this.cardboardBoxMaterial = new THREE.MeshStandardMaterial({
      map: boxTex,
      roughness: 0.95,
      metalness: 0.0
    });

    this.tapeMaterial = new THREE.MeshStandardMaterial({
      color: 0x241d13, // Packing tape brown
      roughness: 0.1,
      metalness: 0.3
    });

    this.anomalyMaterial = new THREE.MeshBasicMaterial({
      color: 0x1aff80, // Ghostly glitching green wireframe
      wireframe: true,
      transparent: true,
      opacity: 0.7
    });

    // Wallpaper/Concrete: Dull yellowish wallpaper, raw concrete blocks or rusted metal
    const wallTex = this.level === 2 ? this.createRustedMetalWallTexture() : (this.level === 1 ? this.createConcreteWallTexture() : this.createWallTexture());
    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: this.level === 2 ? 0.6 : (this.level === 1 ? 0.72 : 0.85),
      metalness: this.level === 2 ? 0.8 : (this.level === 1 ? 0.25 : 0.05),
    });

    // Dark wood baseboard/skirting molding
    this.skirtingBoardMaterial = new THREE.MeshStandardMaterial({
      color: this.level === 2 ? 0x110b08 : (this.level === 1 ? 0x222222 : 0x5a4d33),
      roughness: 0.9,
      metalness: 0.1,
    });

    // Carpet/Concrete Floor: Muddy textured yellowish-brown carpet, stained factory cement, or rusted steel plates
    const carpetTex = this.level === 2 ? this.createRustedMetalFloorTexture() : (this.level === 1 ? this.createConcreteFloorTexture() : this.createCarpetTexture());
    this.carpetMaterial = new THREE.MeshStandardMaterial({
      map: carpetTex,
      roughness: this.level === 2 ? 0.55 : (this.level === 1 ? 0.62 : 0.95),
      metalness: this.level === 2 ? 0.9 : (this.level === 1 ? 0.35 : 0.0),
    });

    // Dark crimson red carpet for the mysterious Red Rooms
    const redCarpetTex = this.createRedCarpetTexture();
    this.redCarpetMaterial = new THREE.MeshStandardMaterial({
      map: redCarpetTex,
      roughness: 0.95,
      metalness: 0.0,
    });

    // Ceiling/Corrugated Iron: Off-white acoustical textured tile panels, corrugated metal slats, or heavy rusted sheets
    const ceilingTex = this.level === 2 ? this.createRustedMetalCeilingTexture() : (this.level === 1 ? this.createMetalCeilingTexture() : this.createCeilingTexture());
    this.ceilingMaterial = new THREE.MeshStandardMaterial({
      map: ceilingTex,
      roughness: this.level === 2 ? 0.65 : (this.level === 1 ? 0.45 : 0.85),
      metalness: this.level === 2 ? 0.85 : (this.level === 1 ? 0.8 : 0.0),
    });

    // Fluorescent Tubes
    this.fluorescentGlassOn = new THREE.MeshBasicMaterial({
      color: 0xfffef0,
    });

    this.fluorescentGlassOff = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.5,
    });

    this.fluorescentCaseMaterial = new THREE.MeshPhongMaterial({
      color: 0x222222,
    });

    // Puddle, leak, drop and ripple assets for damp areas (Backrooms Level 0 classic moisture)
    this.puddleGeo = new THREE.CircleGeometry(0.85, 12);
    this.puddleGeo.rotateX(-Math.PI / 2);

    this.leakStainGeo = new THREE.CircleGeometry(0.55, 10);
    this.leakStainGeo.rotateX(Math.PI / 2); // Facing down

    this.dropGeo = new THREE.SphereGeometry(0.018, 6, 6);

    this.rippleGeo = new THREE.RingGeometry(0.01, 0.1, 16);
    this.rippleGeo.rotateX(-Math.PI / 2);

    this.puddleMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d321d,      // swampy dark yellowish brown
      roughness: 0.1,       // super glossy/wet!
      metalness: 0.4,       // reflective/shiny
      transparent: true,
      opacity: 0.9,
    });

    this.leakStainMaterial = new THREE.MeshBasicMaterial({
      color: 0x302613,      // very dark water damage
      transparent: true,
      opacity: 0.72,
    });

    this.dropMaterial = new THREE.MeshBasicMaterial({
      color: 0x6e6042,      // muddy brown water drop
      transparent: true,
      opacity: 0.9,
    });

    this.rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0x87795d,      // water contrast ripple
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
    });
  }

  /**
   * Builds the internal 2D grid matrix procedurally.
   */
  private generateGrid() {
    this.roomsList = [];

    // Fill grid with SOLID walls by default
    this.grid = Array(this.gridSize)
      .fill(null)
      .map(() => Array(this.gridSize).fill(CellType.SOLID));

    // Define spawn and exit points
    const spawnX = 2;
    const spawnZ = 2;
    this.exitGridX = this.gridSize - 3;
    this.exitGridZ = this.gridSize - 3;

    if (this.level === 2) {
      // LEVEL 2: Pipe Dreams - Tense linear escape runway S-shape tunnel
      // Let's carve a continuous, winding S-shaped corridor of width 3 cells.
      // Starts at Spawn (2,2) and goes to Exit (gridSize-3, gridSize-3).
      const carvePath = (x1: number, z1: number, x2: number, z2: number) => {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minZ = Math.min(z1, z2);
        const maxZ = Math.max(z1, z2);
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            this.grid[x][z] = CellType.CORRIDOR;
          }
        }
      };

      // Carve Segment 1 (vert from 2 to 26)
      carvePath(2, 2, 4, 26);
      // Carve Joint 1 (horiz from 2 to 24 at z=24..26)
      carvePath(2, 24, 24, 26);
      // Carve Segment 2 (vert from 26 down to 6 at x=22..24)
      carvePath(22, 6, 24, 26);
      // Carve Joint 2 (horiz from 22 to 45 at z=4..6)
      carvePath(22, 4, 45, 6);
      // Carve Segment 3 (vert from 6 up to 45 at x=43..45)
      carvePath(43, 6, 45, 45);

      // Make sure the spawn and exit are fully walkable!
      this.grid[2][2] = CellType.CORRIDOR;
      this.grid[this.exitGridX][this.exitGridZ] = CellType.CORRIDOR;

      // Ensure that there are NO dead ends or blockages on Level 2!
      // To prevent entities from being stuck, let's also define some side rooms or alcoves
      // where the player can hide or find Almond water!
      const alcoves = [
        [3, 10], [3, 18],
        [10, 25], [18, 25],
        [23, 10], [23, 18],
        [30, 5], [38, 5],
        [44, 15], [44, 30]
      ];
      alcoves.forEach(([ax, az]) => {
        // Carve small 2x2 alcoves adjacent to the corridors
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const nx = ax + dx;
            const nz = az + dz;
            if (nx >= 2 && nx < this.gridSize - 2 && nz >= 2 && nz < this.gridSize - 2) {
              this.grid[nx][nz] = CellType.CORRIDOR;
            }
          }
        }
      });
    } else if (this.level === 1) {
      // LEVEL 1: Industrial warehouse / boiler room
      // Vast central field, long sweeping paths, lateral mazes
      
      // 1. Generate confusing lateral labyrinths in side lanes FIRST so wide main paths can overwrite any blockages
      this.carveSideLabyrinth(2, 18, 9, 44, CellType.ROOM_SMALL);
      this.carveSideLabyrinth(18, 2, 44, 9, CellType.ROOM_SMALL);
      this.carveSideLabyrinth(10, 39, 36, 45, CellType.CORRIDOR);

      // 2. Carve the massive open central area: 10 <= x <= 38, 10 <= z <= 38
      for (let x = 10; x <= 38; x++) {
        for (let z = 10; z <= 38; z++) {
          this.grid[x][z] = CellType.OPEN_AREA;
        }
      }

      // 3. Carve a long, wide primary pathway/spine from Spawn (2,2) to Exit (gridSize-3, gridSize-3)
      // High-traffic central spine connects to the open field and winds towards the exit
      const carveWidePath = (x1: number, z1: number, x2: number, z2: number) => {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minZ = Math.min(z1, z2);
        const maxZ = Math.max(z1, z2);
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            // carve a thick path (2x2 or 3x3)
            for (let dx = -1; dx <= 1; dx++) {
              for (let dz = -1; dz <= 1; dz++) {
                const nx = x + dx;
                const nz = z + dz;
                if (nx > 1 && nx < this.gridSize - 2 && nz > 1 && nz < this.gridSize - 2) {
                  this.grid[nx][nz] = CellType.CORRIDOR;
                }
              }
            }
          }
        }
      };

      // Sweeping long main path layout (unblocked, clean connections):
      // Go from (2,2) down to (2, 20)
      // Then turn east to (12, 20) to connect to central field
      // From central field edge, we cross the massive central field
      // Exit path leaves central field at (38, 28) and sweeps to (38, 43) -> (45, 45)
      carveWidePath(2, 2, 2, 20);
      carveWidePath(2, 20, 12, 20);
      carveWidePath(38, 28, 38, 43);
      
      // Let the final corridor be a straight, narrow 1-cell-wide corridor running along z = 45 from x = 38 to 45
      // First, connect (38, 43) to (38, 45)
      this.grid[38][44] = CellType.CORRIDOR;
      this.grid[38][45] = CellType.CORRIDOR;

      for (let x = 39; x <= this.exitGridX; x++) {
        this.grid[x][this.exitGridZ] = CellType.CORRIDOR;
        // Reinforce with solid walls on both sides of the corridor so it is narrow and straight
        if (this.exitGridZ - 1 >= 0) {
          this.grid[x][this.exitGridZ - 1] = CellType.SOLID;
        }
        if (this.exitGridZ + 1 < this.gridSize) {
          this.grid[x][this.exitGridZ + 1] = CellType.SOLID;
        }
      }

      // 4. Place scattered structural pillars or individual boilers in the central area (Organic, sparse)
      // Avoid obvious patterns: use seeded randomness with quiet probability
      const pillarPrng = new SeededRandom(this.seed + 2026);
      for (let x = 12; x <= 36; x++) {
        for (let z = 12; z <= 36; z++) {
          // Leave some paths fully open
          if (x % 5 === 0 && z % 5 === 0) {
            // place isolated structural support pillar (1x1 block)
            if (pillarPrng.next() < 0.65) {
              this.grid[x][z] = CellType.SOLID;
            }
          } else if (pillarPrng.next() < 0.04) {
            // Place occasional isolated partition / machine walls (2-cell walls)
            const horizontal = pillarPrng.next() > 0.5;
            if (horizontal && x < 35 && this.grid[x+1][z] !== CellType.SOLID) {
              this.grid[x][z] = CellType.SOLID;
              this.grid[x+1][z] = CellType.SOLID;
            } else if (!horizontal && z < 35 && this.grid[x][z+1] !== CellType.SOLID) {
              this.grid[x][z] = CellType.SOLID;
              this.grid[x][z+1] = CellType.SOLID;
            }
          }
        }
      }

      // Connect these side lanes to the main area organically at specific points (narrow entries)
      this.grid[9][25] = CellType.CORRIDOR;
      this.grid[9][35] = CellType.CORRIDOR;
      this.grid[25][9] = CellType.CORRIDOR;
      this.grid[35][9] = CellType.CORRIDOR;
      this.grid[15][39] = CellType.CORRIDOR;
      this.grid[30][39] = CellType.CORRIDOR;

    } else {
      // LEVEL 0: The Lobby (Classic Backrooms yellow partitions forming a modular wall-labyrinth)
      // Populate as walkable hallway/open area space by default
      for (let x = 2; x < this.gridSize - 2; x++) {
        for (let z = 2; z < this.gridSize - 2; z++) {
          this.grid[x][z] = CellType.CORRIDOR;
        }
      }

      // We place staggered modular wall partitions and cubicles
      // Every 3 units we place partitions to make wonderful spacing (2 to 3 cells wide hallways)
      const lobbyPrng = new SeededRandom(this.seed + 12345);

      for (let x = 4; x < this.gridSize - 4; x += 3) {
        for (let z = 4; z < this.gridSize - 4; z += 3) {
          // Do not overwrite the spawn or exit zones to keep them reachable
          const inSpawn = (x < 8 && z < 8);
          const inExit = (x > this.gridSize - 8 && z > this.gridSize - 8);
          if (inSpawn || inExit) continue;

          // Place simple wall segments of varying offsets and lengths
          const r = lobbyPrng.next();
          if (r < 0.32) {
            this.grid[x][z] = CellType.SOLID;
          } else if (r < 0.58) {
            this.grid[x][z] = CellType.SOLID;
            if (x + 1 < this.gridSize - 4) {
              this.grid[x + 1][z] = CellType.SOLID;
            }
          } else if (r < 0.76) {
            this.grid[x][z] = CellType.SOLID;
            if (z + 1 < this.gridSize - 4) {
              this.grid[x][z + 1] = CellType.SOLID;
            }
          }
        }
      }

      // Place several larger classic modular chambers/rooms (5x5 partitions with door cutouts)
      const numChambers = 6;
      for (let i = 0; i < numChambers; i++) {
        const rx = lobbyPrng.nextInt(6, this.gridSize - 12);
        const rz = lobbyPrng.nextInt(6, this.gridSize - 12);
        
        if ((rx < 10 && rz < 10) || (rx > this.gridSize - 12 && rz > this.gridSize - 12)) continue;

        // Custom choice: Make it a Pit Room (with holes) 50% of the time, substantially increasing spawn rate!
        const isPitRoom = lobbyPrng.next() < 0.50;

        for (let dx = 0; dx < 5; dx++) {
          for (let dz = 0; dz < 5; dz++) {
            const isBorder = (dx === 0 || dx === 4 || dz === 0 || dz === 4);
            const isDoor = (dx === 2 && dz === 0) || (dx === 4 && dz === 2);
            if (isBorder && !isDoor) {
              this.grid[rx + dx][rz + dz] = CellType.SOLID;
            } else {
              this.grid[rx + dx][rz + dz] = isPitRoom ? CellType.PIT_ROOM : CellType.ROOM_LARGE;
            }
          }
        }
      }

      // Add architectural structural pillars (every 6 units)
      for (let x = 5; x < this.gridSize - 5; x += 6) {
        for (let z = 5; z < this.gridSize - 5; z += 6) {
          if (this.grid[x][z] !== CellType.SOLID) {
            this.grid[x][z] = CellType.SOLID;
          }
        }
      }

      // Carve long main horizontal and vertical sweep corridors to keep layout fluid
      for (let x = 2; x < this.gridSize - 2; x++) {
        this.grid[x][12] = CellType.CORRIDOR;
        this.grid[x][13] = CellType.CORRIDOR;
        this.grid[x][34] = CellType.CORRIDOR;
        this.grid[x][35] = CellType.CORRIDOR;
      }
      for (let z = 2; z < this.gridSize - 2; z++) {
        this.grid[20][z] = CellType.CORRIDOR;
        this.grid[21][z] = CellType.CORRIDOR;
      }

      // CUSTOM ENHANCEMENTS: Dynamic Level 0 iconic rooms
      // 1. The Pit Room area (4x4 room with square floor holes / pit drops)
      const pitMinX = 8, pitMaxX = 11;
      const pitMinZ = 24, pitMaxZ = 27;
      for (let x = pitMinX; x <= pitMaxX; x++) {
        for (let z = pitMinZ; z <= pitMaxZ; z++) {
          const isBorder = (x === pitMinX || x === pitMaxX || z === pitMinZ || z === pitMaxZ);
          const isDoor = (x === pitMinX && z === 25) || (x === pitMaxX && z === 25);
          if (isBorder && !isDoor) {
            this.grid[x][z] = CellType.SOLID;
          } else {
            this.grid[x][z] = CellType.PIT_ROOM;
          }
        }
      }
      // Carve connecting pathway from vertical corridor x=20 directly to Pit Room entrance at x=11, z=25
      for (let x = 12; x < 20; x++) {
        this.grid[x][25] = CellType.CORRIDOR;
      }

      // 2. The Arch Colonnade Room (3x8 long room partitioned by elegant archways)
      const archMinX = 24, archMaxX = 31;
      const archMinZ = 8, archMaxZ = 10;
      for (let x = archMinX; x <= archMaxX; x++) {
        for (let z = archMinZ; z <= archMaxZ; z++) {
          const isBorder = (x === archMinX || x === archMaxX || z === archMinZ || z === archMaxZ);
          const isDoor = (x === archMinX && z === 9) || (x === archMaxX && z === 9);
          if (isBorder && !isDoor) {
            this.grid[x][z] = CellType.SOLID;
          } else {
            this.grid[x][z] = CellType.ARCH_ROOM;
          }
        }
      }
      // Carve connecting corridor from central corridor x=21 to Arch Room entrance at x=24, z=9
      for (let x = 21; x <= 23; x++) {
        this.grid[x][9] = CellType.CORRIDOR;
      }

      // 3. Creepy RED ROOMS (Procedural Chambers of crimson carpet causing silent death)
      const red1MinX = 33, red1MaxX = 38;
      const red1MinZ = 20, red1MaxZ = 25;
      for (let x = red1MinX; x <= red1MaxX; x++) {
        for (let z = red1MinZ; z <= red1MaxZ; z++) {
          const isBorder = (x === red1MinX || x === red1MaxX || z === red1MinZ || z === red1MaxZ);
          const isDoor = (x === red1MinX && z === 22) || (x === red1MaxX && z === 22);
          if (isBorder && !isDoor) {
            this.grid[x][z] = CellType.SOLID;
          } else {
            this.grid[x][z] = CellType.RED_ROOM;
          }
        }
      }
      // Carve connecting corridor from central corridor x=21 to Red Room 1 entrance at x=33, z=22
      for (let x = 22; x < 33; x++) {
        this.grid[x][22] = CellType.CORRIDOR;
      }

      const red2MinX = 10;
      const red2MaxX = 15;
      const red2MinZ = 30;
      const red2MaxZ = 33;
      for (let x = red2MinX; x <= red2MaxX; x++) {
        for (let z = red2MinZ; z <= red2MaxZ; z++) {
          const isBorder = (x === red2MinX || x === red2MaxX || z === red2MinZ || z === red2MaxZ);
          const isDoor = (x === 12 && z === red2MinZ) || (x === 12 && z === red2MaxZ);
          if (isBorder && !isDoor) {
            this.grid[x][z] = CellType.SOLID;
          } else {
            this.grid[x][z] = CellType.RED_ROOM;
          }
        }
      }

      // Choose a landmark position near the center of level 0 for the guaranteed pyramid of stacked chairs
      let foundLandmark = false;
      const landmarkPrng = new SeededRandom(this.seed + 1111);
      for (let attempt = 0; attempt < 200; attempt++) {
        const lx = landmarkPrng.nextInt(15, 33);
        const lz = landmarkPrng.nextInt(15, 33);
        const type = this.grid[lx][lz];
        if (type === CellType.ROOM_LARGE || type === CellType.ROOM_SMALL || type === CellType.CORRIDOR) {
          // Check that it's not the spawn or exit and not currently the Pit Room
          const isSpawnZone = (lx < 5 && lz < 5);
          if (!isSpawnZone) {
            this.chairPyramidX = lx;
            this.chairPyramidZ = lz;
            foundLandmark = true;
            break;
          }
        }
      }
      if (!foundLandmark) {
        // Fallback to a safe fixed coordinate
        this.chairPyramidX = 20;
        this.chairPyramidZ = 20;
        this.grid[20][20] = CellType.ROOM_LARGE; // guaranteed walkable
      }

      // Randomize exit location for Level 0 so it is not always in the same corner/path
      const exitPrng = new SeededRandom(this.seed + 98765);
      const candidates: [number, number][] = [];
      // Search for any non-solid corridor cells sufficiently far away from spawn
      for (let x = 12; x < this.gridSize - 4; x++) {
        for (let z = 12; z < this.gridSize - 4; z++) {
          const type = this.grid[x][z];
          if (type !== CellType.SOLID && type !== CellType.PIT_ROOM && type !== CellType.ARCH_ROOM && type !== CellType.RED_ROOM) {
            // Verify there is at least one solid wall neighbor so we can render the glitch wall against it
            const hasSolidNeighbor = 
              (x > 0 && this.grid[x - 1][z] === CellType.SOLID) ||
              (x < this.gridSize - 1 && this.grid[x + 1][z] === CellType.SOLID) ||
              (z > 0 && this.grid[x][z - 1] === CellType.SOLID) ||
              (z < this.gridSize - 1 && this.grid[x][z + 1] === CellType.SOLID);
            if (hasSolidNeighbor) {
              candidates.push([x, z]);
            }
          }
        }
      }
      if (candidates.length > 0) {
        // Filter candidate cells that are at least 35 units away Manhattan distance from spawn (2,2)
        const farCandidates = candidates.filter(([cx, cz]) => {
          const dist = Math.abs(cx - 2) + Math.abs(cz - 2);
          return dist >= 35;
        });
        const finalCandidates = farCandidates.length > 0 ? farCandidates : candidates;
        const chosen = finalCandidates[exitPrng.nextInt(0, finalCandidates.length - 1)];
        this.exitGridX = chosen[0];
        this.exitGridZ = chosen[1];
      }
    }

    // Ensure spawn around (2,2) is safe, walkable, and fully cleared
    for (let dx = -1; dx <= 2; dx++) {
      for (let dz = -1; dz <= 2; dz++) {
        const nx = spawnX + dx;
        const nz = spawnZ + dz;
        if (nx >= 2 && nx < this.gridSize - 2 && nz >= 2 && nz < this.gridSize - 2) {
          this.grid[nx][nz] = CellType.CORRIDOR;
        }
      }
    }

    // Connect spawn zone to the main system
    this.grid[2][4] = CellType.CORRIDOR;
    this.grid[4][2] = CellType.CORRIDOR;

    // Ensure the exit cell itself is walkable while keeping adjacent solid walls untouched!
    this.grid[this.exitGridX][this.exitGridZ] = CellType.CORRIDOR;
  }

  // Helper method to carve a side maze of winding alleys
  private carveSideLabyrinth(xStart: number, zStart: number, xEnd: number, zEnd: number, cellType: CellType) {
    const rRng = new SeededRandom(this.seed + xStart * 77 + zStart);
    for (let x = xStart; x <= xEnd; x++) {
      for (let z = zStart; z <= zEnd; z++) {
        // Place solid walls here selectively, or carve winding corridors
        if (x % 2 === 0 || z % 2 === 0) {
          this.grid[x][z] = rRng.next() > 0.45 ? CellType.SOLID : cellType;
        } else {
          this.grid[x][z] = cellType;
        }
      }
    }
  }

  /**
   * Checks player bounding cylinder/box against solid cell blocks.
   * Player position (world space) is checked against the 2D grid matrix.
   * Returns true if there's a collision.
   */
  public checkCollision(x: number, z: number, radius = 0.5): boolean {
    const minGridX = Math.floor((x - radius) / this.cellSize);
    const maxGridX = Math.floor((x + radius) / this.cellSize);
    const minGridZ = Math.floor((z - radius) / this.cellSize);
    const maxGridZ = Math.floor((z + radius) / this.cellSize);

    // Block boundary checks
    if (minGridX < 0 || maxGridX >= this.gridSize || minGridZ < 0 || maxGridZ >= this.gridSize) {
      return true; // Wall collision on world perimeter
    }

    // Evaluate cell occupants around the player boundaries
    for (let gx = minGridX; gx <= maxGridX; gx++) {
      for (let gz = minGridZ; gz <= maxGridZ; gz++) {
        if (this.grid[gx][gz] === CellType.SOLID) {
          return true;
        }

        // Check for obstacles/props/pillars in this cell
        const obstacles = this.obstacleGrid[gx][gz];
        if (obstacles) {
          for (const obs of obstacles) {
            const dx = x - obs.x;
            const dz = z - obs.z;
            const distSq = dx * dx + dz * dz;
            const minDist = radius + obs.radius;
            if (distSq < minDist * minDist) {
              return true; // Collided with a physical prop or pillar
            }
          }
        }

        // Custom collision for the Pit Room openings
        if (this.grid[gx][gz] === CellType.PIT_ROOM) {
          const posX = gx * this.cellSize + this.cellSize / 2;
          const posZ = gz * this.cellSize + this.cellSize / 2;
          const pitOffsets = [-1.0, 1.0];
          for (const ox of pitOffsets) {
            for (const oz of pitOffsets) {
              const pCenterX = posX + ox;
              const pCenterZ = posZ + oz;
              const closestX = Math.max(pCenterX - 0.5, Math.min(x, pCenterX + 0.5));
              const closestZ = Math.max(pCenterZ - 0.5, Math.min(z, pCenterZ + 0.5));
              const dx = x - closestX;
              const dz = z - closestZ;
              if (dx * dx + dz * dz < radius * radius) {
                return true; // Collided with the deep pit edge, prevent floating on empty slots
              }
            }
          }
        }

        // Custom collision for the Arch Room partition wall (running horizontally on gz === 9)
        if (this.grid[gx][gz] === CellType.ARCH_ROOM && gz === 9) {
          const posX = gx * this.cellSize + this.cellSize / 2;
          const posZ = gz * this.cellSize + this.cellSize / 2;
          const thickness = 0.25;
          // Check if player's bounding circle overlaps the partition z-plane
          if (Math.abs(z - posZ) < (thickness / 2 + radius)) {
            const localX = x - posX;
            const innerWalkWidth = 1.5 - radius; // allow crossing if they are within the arch cutout
            if (Math.abs(localX) > innerWalkWidth) {
              return true; // Collided with the plaster arch half-wall or side pillar
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Adds an obstacle radius check for dynamic collision handling (crates, columns, boilers).
   */
  public addObstacle(gx: number, gz: number, x: number, z: number, radius: number) {
    const key = `${gx},${gz}`;
    let list = this.cellObstacles.get(key);
    if (!list) {
      list = [];
      this.cellObstacles.set(key, list);
      if (this.obstacleGrid[gx]) this.obstacleGrid[gx][gz] = list;
    }
    list.push({ x, z, radius });
  }

  /**
   * Evaluates if a given world coordinate represents a moist/wet carpet cell.
   */
  public isCellWet(worldX: number, worldZ: number): boolean {
    const gx = Math.floor(worldX / this.cellSize);
    const gz = Math.floor(worldZ / this.cellSize);
    return this.wetSpills.has(`${gx},${gz}`);
  }

  /**
   * Instantiates 3D meshes for a specific cell based on its coordinates and surrounding walls.
   */
  public createCell3D(gx: number, gz: number): THREE.Group {
    const group = new THREE.Group();
    const cellType = this.grid[gx][gz];

    if (cellType === CellType.SOLID) {
      // Solid cells are wall blocks. We construct walls outward towards neighbors
      return group; 
    }

    const hSize = this.cellSize;
    const height = 3.0; // Backrooms standard height: 3.0 meters
    const posX = gx * hSize + hSize / 2;
    const posZ = gz * hSize + hSize / 2;

    // 1. CARPET (Floor pane) - Use shared floorGeo, or custom pit layouts
    if (cellType === CellType.PIT_ROOM) {
      // Create a grid of carpet tiles avoiding the four square pits (exactly zero overlap to prevent Z-fighting)
      const segments = [
        // Vertical sectors (left, center partition, right)
        { w: 0.5, h: 0.02, d: 4.0, x: -1.75, z: 0 },
        { w: 1.0, h: 0.02, d: 4.0, x: 0.0, z: 0 },
        { w: 0.5, h: 0.02, d: 4.0, x: 1.75, z: 0 },
        // Horizontal bridging sectors linking the verticals
        { w: 1.0, h: 0.02, d: 0.5, x: -1.0, z: -1.75 },
        { w: 1.0, h: 0.02, d: 0.5, x: 1.0, z: -1.75 },
        { w: 1.0, h: 0.02, d: 1.0, x: -1.0, z: 0.0 },
        { w: 1.0, h: 0.02, d: 1.0, x: 1.0, z: 0.0 },
        { w: 1.0, h: 0.02, d: 0.5, x: -1.0, z: 1.75 },
        { w: 1.0, h: 0.02, d: 0.5, x: 1.0, z: 1.75 }
      ];

      segments.forEach((seg) => {
        const segMesh = new THREE.Mesh(this.unitBoxGeo, this.carpetMaterial);
        segMesh.scale.set(seg.w, seg.h, seg.d);
        segMesh.position.set(posX + seg.x, -0.01 + seg.h / 2, posZ + seg.z);
        segMesh.receiveShadow = true;
        group.add(segMesh);
      });

      // Construct 4 dark recessed pit drops
      const pitOffsets = [-1.0, 1.0];
      const pitMat = this.sharedMat("pit", () => new THREE.MeshStandardMaterial({
        color: 0x110f0a,
        roughness: 0.9,
        side: THREE.DoubleSide
      }));

      for (const ox of pitOffsets) {
        for (const oz of pitOffsets) {
          const pitGroup = new THREE.Group();
          pitGroup.position.set(posX + ox, 0, posZ + oz);

          // Pit Floor - flat at depth -1.6
          const pFloor = new THREE.Mesh(this.pitGeoFloor, pitMat);
          pFloor.position.set(0, -1.6, 0);
          pFloor.rotation.x = -Math.PI / 2;
          pFloor.receiveShadow = true;
          pitGroup.add(pFloor);

          // North Wall (Z = -0.5)
          const pNorth = new THREE.Mesh(this.pitGeoWall, pitMat);
          pNorth.position.set(0, -0.8, -0.5);
          pitGroup.add(pNorth);

          // South Wall (Z = 0.5)
          const pSouth = new THREE.Mesh(this.pitGeoWall, pitMat);
          pSouth.position.set(0, -0.8, 0.5);
          pSouth.rotation.y = Math.PI;
          pitGroup.add(pSouth);

          // West Wall (X = -0.5)
          const pWest = new THREE.Mesh(this.pitGeoWall, pitMat);
          pWest.position.set(-0.5, -0.8, 0);
          pWest.rotation.y = Math.PI / 2;
          pitGroup.add(pWest);

          // East Wall (X = 0.5)
          const pEast = new THREE.Mesh(this.pitGeoWall, pitMat);
          pEast.position.set(0.5, -0.8, 0);
          pEast.rotation.y = -Math.PI / 2;
          pitGroup.add(pEast);

          group.add(pitGroup);
        }
      }
    } else {
      const mat = (cellType === CellType.RED_ROOM) ? this.redCarpetMaterial : this.carpetMaterial;
      const floorMesh = new THREE.Mesh(this.floorGeo, mat);
      floorMesh.position.set(posX, 0, posZ);
      floorMesh.receiveShadow = true;
      group.add(floorMesh);
    }

    // 2. CEILING (Acoustic ceiling panels) - Use shared ceilGeo
    const ceilMesh = new THREE.Mesh(this.ceilGeo, this.ceilingMaterial);
    ceilMesh.position.set(posX, height, posZ);
    ceilMesh.receiveShadow = true;
    group.add(ceilMesh);

    // Aquila Sector: Small ceiling pipes leaking damp water on the floor
    if (this.level === 1 && gx < 24 && gz < 24) {
      const pipeRng = new SeededRandom(this.seed + gx * 71 + gz * 83);
      if (pipeRng.next() > 0.35) {
        const runNS = pipeRng.next() > 0.5;
        const pipeGeo = this.sharedGeo("pipe_048", () => new THREE.CylinderGeometry(0.048, 0.048, hSize + 0.1, 6));
        const pipeMat = this.sharedMat("pipe_steel", () => new THREE.MeshStandardMaterial({
          color: 0x6e767a,
          roughness: 0.32,
          metalness: 0.95
        }));
        const pipe = new THREE.Mesh(pipeGeo, pipeMat);
        if (runNS) {
          pipe.rotation.x = Math.PI / 2;
          pipe.position.set(posX + pipeRng.nextRange(-1.1, 1.1), height - 0.22, posZ);
        } else {
          pipe.rotation.z = Math.PI / 2;
          pipe.position.set(posX, height - 0.22, posZ + pipeRng.nextRange(-1.1, 1.1));
        }
        group.add(pipe);
      }
    }

    // Pipe Dreams final narrow corridor styling
    if (this.level === 1 && gx >= 38 && gz === 45) {
      // Create hot copper pipes on the walls/ceiling
      const pipeGeo = this.sharedGeo("pipe_06", () => new THREE.CylinderGeometry(0.06, 0.06, hSize + 0.1, 6));
      const hotPipeMat = this.sharedMat("pipe_copper", () => new THREE.MeshStandardMaterial({
        color: 0xb55a30, // Copper red/orange pipe color
        roughness: 0.18,
        metalness: 0.85
      }));

      // Ceiling pipe 1
      const ceilPipe = new THREE.Mesh(pipeGeo, hotPipeMat);
      ceilPipe.rotation.z = Math.PI / 2;
      ceilPipe.position.set(posX, height - 0.25, posZ - 0.6);
      group.add(ceilPipe);

      // Ceiling pipe 2
      const ceilPipe2 = new THREE.Mesh(pipeGeo, hotPipeMat);
      ceilPipe2.rotation.z = Math.PI / 2;
      ceilPipe2.position.set(posX, height - 0.25, posZ + 0.6);
      group.add(ceilPipe2);

      // Add soft glowing hot red/orange lights under the pipes (pooled)
      this.registerLight(gx, gz, posX, height - 0.4, posZ, 0xff4400, 1.6, 4.5, 1.2);
    }

    // Level 2: Pipe Dreams - Intense red/copper pipes running along walls and ceilings in all cells!
    if (this.level === 2) {
      const pipeRng = new SeededRandom(this.seed + gx * 19 + gz * 31);
      const pipeGeo = this.sharedGeo("pipe_07", () => new THREE.CylinderGeometry(0.07, 0.07, hSize + 0.1, 6));
      const hotPipeMat = this.sharedMat("pipe_copper", () => new THREE.MeshStandardMaterial({
        color: 0xb55a30, // Copper red/orange pipe color
        roughness: 0.18,
        metalness: 0.85
      }));
      const dirtyIronPipeMat = this.sharedMat("pipe_iron", () => new THREE.MeshStandardMaterial({
        color: 0x5a5c5e, // Dirty dark iron pipe color
        roughness: 0.35,
        metalness: 0.9
      }));

      // Ceiling pipes running North-South
      if (pipeRng.next() > 0.3) {
        const pCeil1 = new THREE.Mesh(pipeGeo, hotPipeMat);
        pCeil1.rotation.x = Math.PI / 2;
        pCeil1.position.set(posX - 0.8, height - 0.25, posZ);
        group.add(pCeil1);

        if (pipeRng.next() > 0.5) {
          const pCeil2 = new THREE.Mesh(pipeGeo, dirtyIronPipeMat);
          pCeil2.rotation.x = Math.PI / 2;
          pCeil2.position.set(posX + 0.8, height - 0.25, posZ);
          group.add(pCeil2);
        }
      }

      // Ceiling pipes running East-West
      if (pipeRng.next() > 0.3) {
        const pCeil3 = new THREE.Mesh(pipeGeo, hotPipeMat);
        pCeil3.rotation.z = Math.PI / 2;
        pCeil3.position.set(posX, height - 0.25, posZ - 0.8);
        group.add(pCeil3);

        if (pipeRng.next() > 0.5) {
          const pCeil4 = new THREE.Mesh(pipeGeo, dirtyIronPipeMat);
          pCeil4.rotation.z = Math.PI / 2;
          pCeil4.position.set(posX, height - 0.25, posZ + 0.8);
          group.add(pCeil4);
        }
      }

      // Steam Leaks / Valve dials / Industrial details on Level 2 cells!
      if (pipeRng.next() < 0.22) {
        // Spawn a Boiler or Steam Machine on the side of the hallway
        const boilerMesh = this.createBoilerMesh(pipeRng);
        boilerMesh.position.set(posX + pipeRng.nextRange(-1.0, 1.0), 0, posZ + pipeRng.nextRange(-1.0, 1.0));
        boilerMesh.scale.set(0.85, 0.85, 0.85);
        group.add(boilerMesh);
        // Add obstacle collision radius
        this.addObstacle(gx, gz, boilerMesh.position.x, boilerMesh.position.z, 0.75);
      }

      // Tense orange/red emergency warning light inside the cells
      if ((gx + gz) % 4 === 0) {
        this.registerLight(gx, gz, posX, height - 0.4, posZ, 0xff2200, 2.5, 8.0, 1.5);

        // A small glass/cage emergency light fixture on the ceiling
        const fixtureGeo = this.sharedGeo("emergency_bulb", () => new THREE.CylinderGeometry(0.1, 0.1, 0.15, 6));
        const bulbMat = this.sharedMat("emergency_bulb", () => new THREE.MeshBasicMaterial({ color: 0xff3300 }));
        const bulbMesh = new THREE.Mesh(fixtureGeo, bulbMat);
        bulbMesh.position.set(posX, height - 0.08, posZ);
        group.add(bulbMesh);
      }
    }

    // 3. WALLS - Evaluate cardinal neighbors. If the neighbor is SOLID, we build a wall panel!
    const pathIdx = this.exitPath.findIndex(([x, z]) => x === gx && z === gz);
    const shouldDrawArrow = pathIdx !== -1 && pathIdx % 30 === 0 && pathIdx > 0;
    let arrowPlacedCurrCell = false;

    // NORTH WALL (Z-direction offset -1)
    if (gz === 0 || this.grid[gx][gz - 1] === CellType.SOLID) {
      const panel = new THREE.Group();
      
      const wall = new THREE.Mesh(this.wallGeo, this.wallMaterial);
      wall.position.set(0, height / 2, -hSize / 2);
      wall.receiveShadow = true;
      panel.add(wall);

      const base = new THREE.Mesh(this.baseGeo, this.skirtingBoardMaterial);
      base.position.set(0, 0.06, -hSize / 2 + 0.02);
      panel.add(base);

      if (shouldDrawArrow && !arrowPlacedCurrCell) {
        const dir = this.getPathArrowDirection(gx, gz, 'N');
        if (dir) {
          const wallArrow = this.createWallArrowMesh(dir);
          wallArrow.position.set(0, 1.45, -hSize / 2 + 0.012);
          panel.add(wallArrow);
          arrowPlacedCurrCell = true;
        }
      }

      panel.position.set(posX, 0, posZ);
      group.add(panel);
    }

    // SOUTH WALL (Z-direction offset +1)
    if (gz === this.gridSize - 1 || this.grid[gx][gz + 1] === CellType.SOLID) {
      const panel = new THREE.Group();

      const wall = new THREE.Mesh(this.wallGeo, this.wallMaterial);
      wall.position.set(0, height / 2, hSize / 2);
      wall.rotateY(Math.PI);
      wall.receiveShadow = true;
      panel.add(wall);

      const base = new THREE.Mesh(this.baseGeo, this.skirtingBoardMaterial);
      base.position.set(0, 0.06, hSize / 2 - 0.02);
      base.rotateY(Math.PI);
      panel.add(base);

      if (shouldDrawArrow && !arrowPlacedCurrCell) {
        const dir = this.getPathArrowDirection(gx, gz, 'S');
        if (dir) {
          const wallArrow = this.createWallArrowMesh(dir);
          wallArrow.position.set(0, 1.45, hSize / 2 - 0.012);
          wallArrow.rotateY(Math.PI);
          panel.add(wallArrow);
          arrowPlacedCurrCell = true;
        }
      }

      panel.position.set(posX, 0, posZ);
      group.add(panel);
    }

    // WEST WALL (X-direction offset -1)
    if (gx === 0 || this.grid[gx - 1][gz] === CellType.SOLID) {
      const panel = new THREE.Group();

      const wall = new THREE.Mesh(this.wallGeo, this.wallMaterial);
      wall.position.set(-hSize / 2, height / 2, 0);
      wall.rotateY(Math.PI / 2);
      wall.receiveShadow = true;
      panel.add(wall);

      const base = new THREE.Mesh(this.baseGeo, this.skirtingBoardMaterial);
      base.position.set(-hSize / 2 + 0.02, 0.06, 0);
      base.rotateY(Math.PI / 2);
      panel.add(base);

      if (shouldDrawArrow && !arrowPlacedCurrCell) {
        const dir = this.getPathArrowDirection(gx, gz, 'W');
        if (dir) {
          const wallArrow = this.createWallArrowMesh(dir);
          wallArrow.position.set(-hSize / 2 + 0.012, 1.45, 0);
          wallArrow.rotateY(Math.PI / 2);
          panel.add(wallArrow);
          arrowPlacedCurrCell = true;
        }
      }

      panel.position.set(posX, 0, posZ);
      group.add(panel);
    }

    // EAST WALL (X-direction offset +1)
    if (gx === this.gridSize - 1 || this.grid[gx + 1][gz] === CellType.SOLID) {
      const panel = new THREE.Group();

      const wall = new THREE.Mesh(this.wallGeo, this.wallMaterial);
      wall.position.set(hSize / 2, height / 2, 0);
      wall.rotateY(-Math.PI / 2);
      wall.receiveShadow = true;
      panel.add(wall);

      const base = new THREE.Mesh(this.baseGeo, this.skirtingBoardMaterial);
      base.position.set(hSize / 2 - 0.02, 0.06, 0);
      base.rotateY(-Math.PI / 2);
      panel.add(base);

      if (shouldDrawArrow && !arrowPlacedCurrCell) {
        const dir = this.getPathArrowDirection(gx, gz, 'E');
        if (dir) {
          const wallArrow = this.createWallArrowMesh(dir);
          wallArrow.position.set(hSize / 2 - 0.012, 1.45, 0);
          wallArrow.rotateY(-Math.PI / 2);
          panel.add(wallArrow);
          arrowPlacedCurrCell = true;
        }
      }

      panel.position.set(posX, 0, posZ);
      group.add(panel);
    }

    // 4. OPEN AREA - Columns / Pillars
    if (cellType === CellType.OPEN_AREA) {
      const randomCol = new SeededRandom(this.seed + gx * 100 + gz);
      if (randomCol.next() > 0.84) {
        if (this.level === 1) {
          // Identify sectors on Level 1
          const isConstructionSect = (gx >= 18 && gx <= 30 && gz >= 18 && gz <= 30);
          const isAquilaSect = (gx < 24 && gz < 24);
          const isGildSect = (gx >= 24 && gz < 24);
          const isWarehouseSect = (gx < 24 && gz >= 24);
          const isGothicSect = !isConstructionSect && !isAquilaSect && !isGildSect && !isWarehouseSect;

          if (isAquilaSect) {
            // HUGE concrete parking lot structural column
            const hugePillarGeo = this.sharedGeo("pillar_huge", () => new THREE.BoxGeometry(1.3, height, 1.3));
            const pillarMesh = new THREE.Mesh(hugePillarGeo, this.wallMaterial);
            pillarMesh.position.set(posX, height / 2, posZ);
            pillarMesh.castShadow = true;
            pillarMesh.receiveShadow = true;
            group.add(pillarMesh);
            this.addObstacle(gx, gz, posX, posZ, 0.85);
          } 
          else if (isGothicSect) {
            // Curved architecture: arches and circular columns (Gothic Sector)
            const circPillarGeo = this.sharedGeo("pillar_circ", () => new THREE.CylinderGeometry(0.5, 0.5, height, 10));
            const pillarMesh = new THREE.Mesh(circPillarGeo, this.wallMaterial);
            pillarMesh.position.set(posX, height / 2, posZ);
            pillarMesh.castShadow = true;
            pillarMesh.receiveShadow = true;
            group.add(pillarMesh);
            this.addObstacle(gx, gz, posX, posZ, 0.6);

            // Double curved torus arches hanging from the top
            const archPrng = new SeededRandom(this.seed + gx + gz * 12);
            const archRot = archPrng.next() > 0.5 ? 0 : Math.PI / 2;
            const archGeo = this.sharedGeo("arch_torus", () => new THREE.TorusGeometry(1.3, 0.16, 5, 10, Math.PI));
            const archMesh = new THREE.Mesh(archGeo, this.wallMaterial);
            archMesh.rotation.x = Math.PI / 2;
            archMesh.rotation.y = archRot;
            archMesh.position.set(posX, height - 0.1, posZ);
            group.add(archMesh);
          } 
          else if (isGildSect) {
            // Gilded twins columns matching Gild's diverse geometry
            const columnGroup = new THREE.Group();
            const thinCylGeo = this.sharedGeo("pillar_thin", () => new THREE.CylinderGeometry(0.24, 0.24, height, 8));
            
            const col1 = new THREE.Mesh(thinCylGeo, this.wallMaterial);
            col1.position.set(-0.55, height / 2, -0.55);
            columnGroup.add(col1);
            
            const col2 = new THREE.Mesh(thinCylGeo, this.wallMaterial);
            col2.position.set(0.55, height / 2, 0.55);
            columnGroup.add(col2);

            this.addObstacle(gx, gz, posX - 0.55, posZ - 0.55, 0.35);
            this.addObstacle(gx, gz, posX + 0.55, posZ + 0.55, 0.35);

            // Shiny decorative metal rings in gold/gilded accent
            const bandGeo = this.sharedGeo("pillar_band", () => new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8));
            const goldMat = this.sharedMat("gold", () => new THREE.MeshStandardMaterial({
              color: 0xe5c158,
              roughness: 0.3,
              metalness: 0.8
            }));
            const b1 = new THREE.Mesh(bandGeo, goldMat);
            b1.position.set(-0.55, height / 2, -0.55);
            columnGroup.add(b1);
            
            const b2 = new THREE.Mesh(bandGeo, goldMat);
            b2.position.set(0.55, height / 2, 0.55);
            columnGroup.add(b2);

            columnGroup.position.set(posX, 0, posZ);
            group.add(columnGroup);
          } 
          else if (isConstructionSect) {
            // Scaffold poles & wood boards for Construction Sector
            const scaffold = new THREE.Group();
            const yellowPoleMat = this.sharedMat("scaffold_pole", () => new THREE.MeshStandardMaterial({
              color: 0xccb111,
              roughness: 0.45,
              metalness: 0.7
            }));
            const woodPlankMat = this.sharedMat("wood_plank", () => new THREE.MeshStandardMaterial({
              color: 0x825a2b,
              roughness: 0.85
            }));

            // 4 vertical frame poles
            const offsets = [-0.85, 0.85];
            const poleGeoObj = this.sharedGeo("scaffold_pole", () => new THREE.CylinderGeometry(0.04, 0.04, height - 0.4, 5));
            for (const ox of offsets) {
              for (const oz of offsets) {
                const pole = new THREE.Mesh(poleGeoObj, yellowPoleMat);
                pole.position.set(ox, (height - 0.4) / 2, oz);
                scaffold.add(pole);
              }
            }

            this.addObstacle(gx, gz, posX, posZ, 1.1);

            // Cross warning diagonal braces
            const braceGeo = this.sharedGeo("scaffold_brace", () => new THREE.CylinderGeometry(0.022, 0.022, 2.3, 4));
            const bRight = new THREE.Mesh(braceGeo, yellowPoleMat);
            bRight.rotation.z = 1.0;
            bRight.position.set(0, height / 2 - 0.2, -0.85);
            scaffold.add(bRight);

            const bLeft = new THREE.Mesh(braceGeo, yellowPoleMat);
            bLeft.rotation.z = -1.0;
            bLeft.position.set(0, height / 2 - 0.2, 0.85);
            scaffold.add(bLeft);

            // Wooden walking decks
            const deck = new THREE.Mesh(this.sharedGeo("scaffold_deck", () => new THREE.BoxGeometry(1.9, 0.08, 0.8)), woodPlankMat);
            deck.position.set(0, height - 0.5, 0);
            scaffold.add(deck);

            scaffold.position.set(posX, 0, posZ);
            group.add(scaffold);
          } 
          else {
            // Crate Warehouse: Stacked boxes + Concrete pillar
            const stack = new THREE.Group();
            const colMesh = new THREE.Mesh(this.pillarGeo, this.wallMaterial);
            colMesh.position.set(0, height / 2, 0);
            stack.add(colMesh);

            const palletRng = new SeededRandom(this.seed + gx * 11 + gz * 41);
            const c1 = this.createCardboardBoxMesh(palletRng);
            c1.scale.set(1.2, 1.2, 1.2);
            c1.position.set(-0.72, 0.4, 0.72);
            stack.add(c1);

            const c2 = this.createSteelCrateMesh(palletRng);
            c2.position.set(0.72, 0.35, -0.72);
            stack.add(c2);

            stack.position.set(posX, 0, posZ);
            group.add(stack);
            this.addObstacle(gx, gz, posX, posZ, 1.1);
          }
        } else {
          // LEVEL 0 structural columns
          const pillarMesh = new THREE.Mesh(this.pillarGeo, this.wallMaterial);
          pillarMesh.position.set(posX, height / 2, posZ);
          pillarMesh.castShadow = true;
          pillarMesh.receiveShadow = true;
          group.add(pillarMesh);
          this.addObstacle(gx, gz, posX, posZ, 0.5);
        }
      }
    }

    // 5. THE GLITCHING NOCLIP WALL EXIT ("flipar na parede / noclip")
    if (gx === this.exitGridX && gz === this.exitGridZ) {
      const exitGroup = new THREE.Group();

      // Find all adjacent solid neighbors
      const adjacentSolids: ('N' | 'S' | 'W' | 'E')[] = [];
      if (gz === 0 || this.grid[gx][gz - 1] === CellType.SOLID) adjacentSolids.push('N');
      if (gz === this.gridSize - 1 || this.grid[gx][gz + 1] === CellType.SOLID) adjacentSolids.push('S');
      if (gx === 0 || this.grid[gx - 1][gz] === CellType.SOLID) adjacentSolids.push('W');
      if (gx === this.gridSize - 1 || this.grid[gx + 1][gz] === CellType.SOLID) adjacentSolids.push('E');

      const wallPrng = new SeededRandom(this.seed + gx * 37 + gz * 73);
      // On Level 1, the exit is at the end of the straight corridor running west-to-east. So force chosenDir to 'E'!
      const chosenDir = this.level === 2 ? 'N' : (this.level === 1 ? 'E' : (adjacentSolids.length > 0
        ? adjacentSolids[wallPrng.nextInt(0, adjacentSolids.length - 1)]
        : 'S'));

      let glitchWall: THREE.Mesh;

      if (this.level === 2) {
        // LEVEL 2: CYAN ESCAPE PORTAL LEADING TO VICTORY!
        const pipeMat = new THREE.MeshStandardMaterial({
          color: 0x4fa6e8, // Futuristic cyan metal
          roughness: 0.2,
          metalness: 0.95
        });

        // Glowing cyan dimensional portal plate (replaces glitch wall)
        const portalGeo = new THREE.PlaneGeometry(hSize - 0.8, height - 0.5);
        const portalMat = new THREE.MeshBasicMaterial({
          color: 0x00f0ff, // Glowing pure cyan
          side: THREE.DoubleSide
        });
        glitchWall = new THREE.Mesh(portalGeo, portalMat);
        glitchWall.position.set(0, height / 2, -hSize / 2 + 0.08);
        exitGroup.add(glitchWall);

        // Circular Steam pipes frame around the portal plate
        const framePipeGeo = new THREE.CylinderGeometry(0.06, 0.06, hSize - 0.6, 8);
        const pipe1 = new THREE.Mesh(framePipeGeo, pipeMat);
        pipe1.rotation.z = Math.PI / 2;
        pipe1.position.set(0, height - 0.25, -hSize / 2 + 0.15);
        exitGroup.add(pipe1);

        const pipe2 = new THREE.Mesh(framePipeGeo, pipeMat);
        pipe2.rotation.z = Math.PI / 2;
        pipe2.position.set(0, 0.25, -hSize / 2 + 0.15);
        exitGroup.add(pipe2);

        // Vertical frame pillars on sides
        const vertPipeGeo = new THREE.CylinderGeometry(0.08, 0.08, height - 0.4, 8);
        const pipe3 = new THREE.Mesh(vertPipeGeo, pipeMat);
        pipe3.position.set(-(hSize / 2 - 0.35), height / 2, -hSize / 2 + 0.15);
        exitGroup.add(pipe3);

        const pipe4 = new THREE.Mesh(vertPipeGeo, pipeMat);
        pipe4.position.set(hSize / 2 - 0.35, height / 2, -hSize / 2 + 0.15);
        exitGroup.add(pipe4);

        // Cyan light shining through the portal
        const portalLight = new THREE.PointLight(0x00f0ff, 8.0, 10, 0.5);
        portalLight.position.set(0, height / 2, -hSize / 2 + 0.5);
        exitGroup.add(portalLight);
      } else if (this.level === 1) {
        // LEVEL 1: RUSTY MAINTENANCE STEAM GATE PORTAL LEADING TO LEVEL 2 "PIPE DREAMS"
        const gateMat = new THREE.MeshStandardMaterial({
          color: 0x8a4b2a, // Deep rusty brown/orange
          roughness: 0.9,
          metalness: 0.15
        });
        const pipeMat = new THREE.MeshStandardMaterial({
          color: 0xb55a30,
          roughness: 0.25,
          metalness: 0.95
        });

        // Glowing orange/red dimensional portal plate (replaces glitch wall)
        const portalGeo = new THREE.PlaneGeometry(hSize - 0.8, height - 0.5);
        const portalMat = new THREE.MeshBasicMaterial({
          color: 0xff3300, // Boiling glowing hot orange/red
          side: THREE.DoubleSide
        });
        glitchWall = new THREE.Mesh(portalGeo, portalMat);
        glitchWall.position.set(0, height / 2, -hSize / 2 + 0.08);
        exitGroup.add(glitchWall);

        // Circular Steam pipes frame around the portal plate
        const framePipeGeo = new THREE.CylinderGeometry(0.06, 0.06, hSize - 0.6, 8);
        const pipe1 = new THREE.Mesh(framePipeGeo, pipeMat);
        pipe1.rotation.z = Math.PI / 2;
        pipe1.position.set(0, height - 0.25, -hSize / 2 + 0.15);
        exitGroup.add(pipe1);

        const pipe2 = new THREE.Mesh(framePipeGeo, pipeMat);
        pipe2.rotation.z = Math.PI / 2;
        pipe2.position.set(0, 0.25, -hSize / 2 + 0.15);
        exitGroup.add(pipe2);

        // Vertical frame pillars on sides
        const vertPipeGeo = new THREE.CylinderGeometry(0.08, 0.08, height - 0.4, 8);
        const pipe3 = new THREE.Mesh(vertPipeGeo, pipeMat);
        pipe3.position.set(-(hSize / 2 - 0.35), height / 2, -hSize / 2 + 0.15);
        exitGroup.add(pipe3);

        const pipe4 = new THREE.Mesh(vertPipeGeo, pipeMat);
        pipe4.position.set(hSize / 2 - 0.35, height / 2, -hSize / 2 + 0.15);
        exitGroup.add(pipe4);

        // Hot portal light shining through the portal
        const portalLight = new THREE.PointLight(0xff3c00, 8.0, 10, 0.5);
        portalLight.position.set(0, height / 2, -hSize / 2 + 0.5);
        exitGroup.add(portalLight);

        // Custom desk with instructions paper about Level 2
        const deskWithPaper = this.createDeskWithPaperMesh();
        deskWithPaper.position.set(0, 0, -hSize / 2 + 1.2);
        exitGroup.add(deskWithPaper);
      } else {
        // LEVEL 0: Classic fluorescent glitch wall
        const glitchWallMat = new THREE.MeshBasicMaterial({
          color: 0x1aff80, // Ghostly neon green
          wireframe: true,
          transparent: true,
          opacity: 0.75
        });
        glitchWall = new THREE.Mesh(this.unitBoxGeo, glitchWallMat);
        glitchWall.scale.set(hSize, height, 0.15);
        glitchWall.position.set(0, height / 2, -hSize / 2 + 0.05);
        exitGroup.add(glitchWall);

        // PointLight in front of the glitch wall
        const portalLight = new THREE.PointLight(0x1aff80, 5.0, 9, 0.8);
        portalLight.position.set(0, height / 2, -hSize / 2 + 0.5);
        exitGroup.add(portalLight);

        // Office desk with instructions paper in front of the glitched wall
        const deskWithPaper = this.createDeskWithPaperMesh();
        deskWithPaper.position.set(0, 0, -hSize / 2 + 1.0); // sitting close to the wall but accessible
        deskWithPaper.rotation.y = 0; // rotated to face player approaching from south towards north wall
        exitGroup.add(deskWithPaper);
      }

      // Set position of the parent group
      exitGroup.position.set(posX, 0, posZ);

      // Apply rotation on the entire exitGroup based on chosenDir
      if (chosenDir === 'S') {
        exitGroup.rotation.y = Math.PI;
      } else if (chosenDir === 'W') {
        exitGroup.rotation.y = Math.PI / 2;
      } else if (chosenDir === 'E') {
        exitGroup.rotation.y = -Math.PI / 2;
      } else {
        exitGroup.rotation.y = 0; // North Wall is default
      }

      group.add(exitGroup);

      // Add to animating meshes so it glitches out beautifully
      this.animatingMeshes.push({
        mesh: glitchWall,
        type: "glitch",
        initialY: height / 2,
        phase: 0,
        gridX: gx,
        gridZ: gz,
      });
    }

    // 6. FLUORESCENT LIGHT LUMINAIRE FIXTURE (Deterministic placement)
    // Place a fluorescent lightbox on the ceiling. (45% probability on corridor cells or room centers)
    const lightRand = new SeededRandom(this.seed + gx * 7 + gz * 13);
    const shouldSpawnLight = cellType === CellType.CORRIDOR 
      ? lightRand.next() > 0.65 
      : lightRand.next() > 0.55;

    // We do NOT spawn fluorescent lighting in the exit cell to preserve the dramatic crimson visual contrast
    if (shouldSpawnLight && !(gx === this.exitGridX && gz === this.exitGridZ)) {
      const fixtureGroup = new THREE.Group();

      // Black metal industrial bracket
      const caseMesh = new THREE.Mesh(this.caseGeo, this.fluorescentCaseMaterial);
      caseMesh.position.set(0, height - 0.05, 0);
      fixtureGroup.add(caseMesh);

      // Glowing tube glass tube cylinder
      const lightRng = new SeededRandom(this.seed + gx * 41 + gz * 61);
      const isBurntOut = (this.level === 1) && (lightRng.next() < 0.38); // 38% burnt out rate in warehouse Level 1!

      const glassMaterial = isBurntOut ? this.fluorescentGlassOff : this.fluorescentGlassOn;
      const tubeMesh = new THREE.Mesh(this.tubeGeo, glassMaterial);
      tubeMesh.position.set(0, height - 0.08, 0);
      fixtureGroup.add(tubeMesh);

      // Point Light with soft, yellow-greenish tint for Level 0, or clean industrial white-grey for Level 1
      let lightColor = this.level === 1 ? 0xe6e6e6 : 0xfefdb5;
      let lightIntensity = isBurntOut ? 0.0 : (this.level === 1 ? 1.05 : 1.4); // slightly dimmer on average for warehouse

      // Gild Sector gets gorgeous colorful lighting!
      const isGild = this.level === 1 && (gx >= 24 && gz < 24);
      if (isGild) {
        const colorPalette = [0xffaa33, 0x33e0ff, 0xffe640, 0x11ff80, 0xff40bb];
        const index = lightRng.nextInt(0, colorPalette.length - 1);
        lightColor = colorPalette[index];
        lightIntensity = isBurntOut ? 0.45 : 1.7; // Brighter and always slightly glowing
      }

      // The lamp is only *declared* here; the LightPool decides which lamps get
      // a real GPU light, keeping the visible light count small and constant.
      const light = this.registerLight(gx, gz, posX, height - 0.15, posZ, lightColor, lightIntensity, 7.5, 1.0);

      // Local floating dust cloud directly under the fluorescent light fixture
      const dustCloud = this.quality.fixtureDustParticles > 0 ? this.createLocalDustCloud() : undefined;
      if (dustCloud) fixtureGroup.add(dustCloud);

      fixtureGroup.position.set(posX, 0, posZ);
      group.add(fixtureGroup);

      // Record fixture to support systemic fluorescent flickering behavior
      this.lightFixtures.push({
        mesh: tubeMesh,
        light: light,
        intensity: lightIntensity,
        flickerTimer: 0,
        gridX: gx,
        gridZ: gz,
        dust: dustCloud
      });
    }

    // 7. OFFICE WALL DIVIDER PARTITIONS ("pequenas paredes finas")
    // Attached perpendicular to adjacent solid walls, constructing office dividers.
    const isSpawnZone = (gx < 5 && gz < 5);
    const isExitZone = (gx === this.exitGridX && gz === this.exitGridZ);

    if (this.level !== 1 && !isSpawnZone && !isExitZone && (cellType === CellType.CORRIDOR || cellType === CellType.ROOM_SMALL || cellType === CellType.ROOM_LARGE)) {
      const wallRng = new SeededRandom(this.seed + gx * 11 + gz * 23);
      if (wallRng.next() < 0.16) {
        let addedDivider = false;
        let rot = 0;
        let ox = 0;
        let oz = 0;

        if (gz > 0 && this.grid[gx][gz - 1] === CellType.SOLID) {
          // Attached to North Wall, protruding South (along Z axis)
          rot = 0;
          ox = 0.9; // offset slightly off-center to let the player walk
          oz = -hSize / 2 + 0.9;
          addedDivider = true;
        } else if (gz < this.gridSize - 1 && this.grid[gx][gz + 1] === CellType.SOLID) {
          // Attached to South Wall, protruding North (along Z axis)
          rot = 0;
          ox = -0.9;
          oz = hSize / 2 - 0.9;
          addedDivider = true;
        } else if (gx > 0 && this.grid[gx - 1][gz] === CellType.SOLID) {
          // Attached to West Wall, protruding East (along X axis)
          rot = Math.PI / 2;
          ox = -hSize / 2 + 0.9;
          oz = -0.9;
          addedDivider = true;
        } else if (gx < this.gridSize - 1 && this.grid[gx + 1][gz] === CellType.SOLID) {
          // Attached to East Wall, protruding West (along X axis)
          rot = Math.PI / 2;
          ox = hSize / 2 - 0.9;
          oz = 0.9;
          addedDivider = true;
        }

        if (addedDivider) {
          const dividerGroup = new THREE.Group();

          // Main partition board
          const board = new THREE.Mesh(this.dividerGeo, this.wallMaterial);
          board.position.set(0, 1.15, 0);
          board.receiveShadow = true;
          dividerGroup.add(board);

          // Skirting board molding
          const dbBase = new THREE.Mesh(this.partitionBaseGeo, this.skirtingBoardMaterial);
          dbBase.position.set(0, 0.06, 0);
          dividerGroup.add(dbBase);

          // Metal top-trim cap for the partition board
          const cap = new THREE.Mesh(this.unitBoxGeo, this.metalMaterial);
          cap.scale.set(0.09, 0.04, 1.81);
          cap.position.set(0, 2.31, 0);
          dividerGroup.add(cap);

          dividerGroup.rotation.y = rot;
          dividerGroup.position.set(posX + ox, 0, posZ + oz);
          group.add(dividerGroup);
          this.addObstacle(gx, gz, posX + ox, posZ + oz, 0.95);
        }
      }

      // 8. ABANDONED FURNITURE & SPOOKY GLITCHING PROPS ("cadeiras, caixas e objetos flutuando")
      const isLandmarkPyramid = (this.level === 0 && gx === this.chairPyramidX && gz === this.chairPyramidZ);
      const propRng = new SeededRandom(this.seed + gx * 17 + gz * 47);

      if (isLandmarkPyramid) {
        // Spawn the guaranteed landmark chair pyramid
        const pyramid = this.createChairPyramid(propRng);
        pyramid.position.set(posX, 0, posZ);
        group.add(pyramid);
        this.addObstacle(gx, gz, posX, posZ, 0.85);
        
        // Bob the very top chair of the landmark pyramid slightly for a spooky floating/hovering effect
        const topChair = pyramid.children[pyramid.children.length - 1];
        if (topChair) {
          this.animatingMeshes.push({
            mesh: topChair,
            type: "bob",
            initialY: topChair.position.y,
            phase: propRng.nextRange(0, Math.PI * 2),
            gridX: gx,
            gridZ: gz,
          });
        }
      } else if (propRng.next() < (this.level === 1 && gx < 24 && gz >= 24 ? 0.62 : 0.22)) { // much higher 62% density in Crate Warehouse Sector!
        const propRoll = propRng.next();
        
        if (this.level === 1) {
          const isWarehouseSect = (gx < 24 && gz >= 24);
          
          if (isWarehouseSect) {
            // SPARK SPECTACULAR CUSTOM REINFORCED STOREROOM WAREHOUSE SHELVING WITH CARGO BOXES!
            const shelfGroup = new THREE.Group();
            
            // Draw a high-tech warehouse pallet shelf
            const frameMat = this.sharedMat("shelf_frame", () => new THREE.MeshStandardMaterial({ color: 0x556066, roughness: 0.5, metalness: 0.8 }));
            const boardMat = this.sharedMat("shelf_board", () => new THREE.MeshStandardMaterial({ color: 0x8a6230, roughness: 0.95 }));
            
            // 4 vertical struts
            const sGeo = this.sharedGeo("shelf_post", () => new THREE.BoxGeometry(0.08, 2.8, 0.08));
            for (const ox of [-0.9, 0.9]) {
              for (const oz of [-0.4, 0.4]) {
                const strut = new THREE.Mesh(sGeo, frameMat);
                strut.position.set(ox, 1.4, oz);
                shelfGroup.add(strut);
              }
            }
            
            // Lower and upper shelving boards
            const bGeo = this.sharedGeo("shelf_shelf", () => new THREE.BoxGeometry(1.8, 0.06, 0.82));
            const lowBoard = new THREE.Mesh(bGeo, boardMat);
            lowBoard.position.set(0, 0.15, 0);
            shelfGroup.add(lowBoard);
            
            const midBoard = new THREE.Mesh(bGeo, boardMat);
            midBoard.position.set(0, 1.3, 0);
            shelfGroup.add(midBoard);
            
            // Fill with warehouse cardboard boxes and steel crates
            const boxMid = this.createCardboardBoxMesh(propRng);
            boxMid.scale.set(0.85, 0.85, 0.85);
            boxMid.position.set(-0.4, 0.2, 0);
            shelfGroup.add(boxMid);
            
            const crateMid = this.createSteelCrateMesh(propRng);
            crateMid.scale.set(0.9, 0.9, 0.9);
            crateMid.position.set(0.4, 0.2, 0);
            shelfGroup.add(crateMid);

            // Spawn consumable food items (Almond Water or Energy Bar) sitting on the shelves
            const itemRoll = propRng.next();
            const pickX = posX + propRng.nextRange(-0.4, 0.4);
            const pickZ = posZ + propRng.nextRange(-0.2, 0.2);

            if (itemRoll < 0.44) {
              // Almond Water sitting on middle board!
              const bottle = this.createAlmondWaterBottleMesh();
              bottle.position.set(0.15, 1.35, 0.1);
              shelfGroup.add(bottle);

              this.consumables.push({
                mesh: bottle,
                initialY: 1.35,
                collected: false,
                type: "almond_water",
                x: posX,
                z: posZ,
                gridX: gx,
                gridZ: gz,
              });
            } else if (itemRoll < 0.80) {
              // Energy Bar sitting on middle board!
              const bar = this.createEnergyBarMesh();
              bar.position.set(-0.15, 1.35, -0.15);
              shelfGroup.add(bar);

              this.consumables.push({
                mesh: bar,
                initialY: 1.35,
                collected: false,
                type: "energy_bar",
                x: posX,
                z: posZ,
                gridX: gx,
                gridZ: gz,
              });
            }
            
            const rx = propRng.nextRange(-0.7, 0.7);
            const rz = propRng.nextRange(-0.7, 0.7);
            const ry = propRng.nextRange(0, Math.PI * 2);
            shelfGroup.position.set(posX + rx, 0, posZ + rz);
            shelfGroup.rotation.y = ry;
            group.add(shelfGroup);
            this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.95);
          }
          else {
            // LEVEL 1 STANDARD PROP BRANCH (Aquila / Gild / Gothic / Construction)
            if (propRoll < 0.40) {
              // Spawn big metal barrel/oil drum (sometimes tipped over, upright, or floating spooky!)
              const isTipped = propRng.next() > 0.75;
              const isFloating = !isTipped && propRng.next() > 0.88; // 12% of barrels float
              
              const barrel = this.createMetalDrumMesh(propRng);
              const rx = propRng.nextRange(-1.0, 1.0);
              const rz = propRng.nextRange(-1.0, 1.0);
              const angle = propRng.nextRange(0, Math.PI * 2);
              
              if (isTipped) {
                barrel.rotation.x = Math.PI / 2;
                barrel.position.set(posX + rx, 0.32, posZ + rz);
                barrel.rotation.z = angle;
              } else {
                barrel.position.set(posX + rx, isFloating ? 0.95 : 0, posZ + rz);
                barrel.rotation.y = angle;
              }
              
              group.add(barrel);
              this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.45);

              if (isFloating) {
                this.animatingMeshes.push({
                  mesh: barrel,
                  type: "bob",
                  initialY: 0.95,
                  phase: propRng.nextRange(0, Math.PI * 2),
                  gridX: gx,
                  gridZ: gz,
                });
              }
            } 
            else if (propRoll < 0.80) {
              // Spawn steel cargo crate (with stacking or floating options)
              const isDoubleStack = propRng.next() > 0.5;
              const isFloatingCrate = !isDoubleStack && propRng.next() > 0.90; // Spooky storage crate
              
              const crate1 = this.createSteelCrateMesh(propRng);
              const rx = propRng.nextRange(-1.1, 1.1);
              const rz = propRng.nextRange(-1.1, 1.1);
              const ry1 = propRng.nextRange(0, Math.PI * 2);

              crate1.position.set(posX + rx, isFloatingCrate ? 1.0 : 0, posZ + rz);
              crate1.rotation.y = ry1;
              group.add(crate1);
              this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.58);

              if (isFloatingCrate) {
                this.animatingMeshes.push({
                  mesh: crate1,
                  type: "bob",
                  initialY: 1.0,
                  phase: propRng.nextRange(0, Math.PI * 2),
                  gridX: gx,
                  gridZ: gz,
                });
              } 
              else if (isDoubleStack) {
                const crate2 = this.createSteelCrateMesh(propRng);
                crate2.scale.set(0.85, 0.85, 0.85);
                crate2.position.set(posX + rx + propRng.nextRange(-0.1, 0.1), 0.71, posZ + rz + propRng.nextRange(-0.1, 0.1));
                crate2.rotation.y = ry1 + propRng.nextRange(-0.5, 0.5);
                group.add(crate2);
              }
            } 
            else {
              // Spawn high-tech generator / industrial Boiler machinery
              const boiler = this.createBoilerMesh(propRng);
              const rx = propRng.nextRange(-0.7, 0.7);
              const rz = propRng.nextRange(-0.7, 0.7);
              const ry = propRng.nextRange(0, Math.PI * 2);

              boiler.position.set(posX + rx, 0, posZ + rz);
              boiler.rotation.y = ry;
              group.add(boiler);
              this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.65);
            }
          }
        } else {
          // LEVEL 0: Office assets 
          if (propRoll < 0.08) {
            // Random Stacked Chair Pyramid!
            const pyramid = this.createChairPyramid(propRng);
            const rx = propRng.nextRange(-0.3, 0.3);
            const rz = propRng.nextRange(-0.3, 0.3);
            pyramid.position.set(posX + rx, 0, posZ + rz);
            pyramid.rotation.y = propRng.nextRange(0, Math.PI * 2);
            group.add(pyramid);
            this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.8);
          }
          else if (propRoll < 0.38) {
            // Spawn Office Chair (normal or tipped over or eerie floating!)
            const isTipped = propRng.next() > 0.65;
            const isFloating = !isTipped && propRng.next() > 0.85; // 15% of upright chairs hover/float eerily
            
            const chairMesh = this.createChairMesh(propRng, isTipped, isFloating);
            
            // Random offset in cell to avoid clipping center
            const rx = propRng.nextRange(-1.0, 1.0);
            const rz = propRng.nextRange(-1.0, 1.0);
            const angle = propRng.nextRange(0, Math.PI * 2);
            
            chairMesh.position.set(posX + rx, isFloating ? 0.9 : chairMesh.position.y, posZ + rz);
            if (!isTipped) {
              chairMesh.rotation.y = angle;
            }
            
            group.add(chairMesh);
            this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.45);

            if (isFloating) {
              this.animatingMeshes.push({
                mesh: chairMesh,
                type: "bob",
                initialY: 0.9,
                phase: propRng.nextRange(0, Math.PI * 2),
                gridX: gx,
                gridZ: gz,
              });
            }
          } 
          else if (propRoll < 0.85) {
            // Spawn Brown Cardboard Boxes
            const isDoubleStack = propRng.next() > 0.5;
            const isFloatingBox = !isDoubleStack && propRng.next() > 0.92; // rare spooky floating box

            const box1 = this.createCardboardBoxMesh(propRng);
            const rx = propRng.nextRange(-1.1, 1.1);
            const rz = propRng.nextRange(-1.1, 1.1);
            const ry1 = propRng.nextRange(0, Math.PI * 2);

            box1.position.set(posX + rx, isFloatingBox ? 1.0 : 0, posZ + rz);
            box1.rotation.y = ry1;
            group.add(box1);
            this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.52);

            if (isFloatingBox) {
              this.animatingMeshes.push({
                mesh: box1,
                type: "bob",
                initialY: 0.9,
                phase: propRng.nextRange(0, Math.PI * 2),
                gridX: gx,
                gridZ: gz,
              });
            } 
            else if (isDoubleStack) {
              // Spawn a second box on top slightly rotated
              const box2 = this.createCardboardBoxMesh(propRng);
              box2.scale.set(0.85, 0.85, 0.85); // slightly smaller
              box2.position.set(posX + rx + propRng.nextRange(-0.1, 0.1), 0.61, posZ + rz + propRng.nextRange(-0.1, 0.1));
              box2.rotation.y = ry1 + propRng.nextRange(-0.5, 0.5);
              group.add(box2);
            }
          } 
          else {
            // Spawn Spooky Spacetime Spatial Anomaly! Glitching green energy core!
            const anomalyGroup = new THREE.Group();

            // Outer wireframe glowing block
            const outerMesh = new THREE.Mesh(this.anomalyOuterGeo, this.anomalyMaterial);
            anomalyGroup.add(outerMesh);

            // Inner solid glowing warning ring
            const innerMesh = new THREE.Mesh(this.anomalyInnerGeo, this.fluorescentGlassOn); // glows bright white-yellow
            anomalyGroup.add(innerMesh);

            const rx = propRng.nextRange(-0.8, 0.8);
            const rz = propRng.nextRange(-0.8, 0.8);
            const initialY = 1.0 + propRng.nextRange(0, 0.5);

            // Flickering glitch neon green point light (pooled)
            this.registerLight(gx, gz, posX + rx, initialY, posZ + rz, 0x1aff80, 2.0, 5, 0.8);

            anomalyGroup.position.set(posX + rx, initialY, posZ + rz);
            group.add(anomalyGroup);
            this.addObstacle(gx, gz, posX + rx, posZ + rz, 0.5);

            this.animatingMeshes.push({
              mesh: anomalyGroup,
              type: "glitch",
              initialY: initialY,
              phase: propRng.nextRange(0, Math.PI * 2),
              gridX: gx,
              gridZ: gz,
            });
          }
        }
      }
    }

    // 8. DAMP LEVEL 0 CARPET MOISTURE & CEILING LEAKS (Ripples, puddles, and dripping drops)
    if (this.wetSpills.has(`${gx},${gz}`)) {
      const isExitPathCell = this.exitPathSet.has(`${gx},${gz}`);

      // Floor damp puddle
      const puddle = new THREE.Mesh(this.puddleGeo, this.puddleMaterial);
      puddle.position.set(posX, 0.003, posZ);
      puddle.receiveShadow = true;
      group.add(puddle);

      // Ceiling leak stain resembling rotted water-damaged panels
      const leak = new THREE.Mesh(this.leakStainGeo, this.leakStainMaterial);
      leak.position.set(posX, 2.992, posZ);
      group.add(leak);

      // Falling water droplet sphere
      const droplet = new THREE.Mesh(this.dropGeo, this.dropMaterial);
      droplet.position.set(posX, 3.0, posZ);
      droplet.visible = false;
      group.add(droplet);

      // Splash ripple ring representing water tension
      const ripple = new THREE.Mesh(this.rippleGeo, this.rippleMaterial);
      ripple.position.set(posX, 0.006, posZ);
      group.add(ripple);

      // Stagger dynamic timings so all drips across the map don't fall in synchronization
      const cellSeed = gx * 13 + gz * 37;
      const staticRnd = new SeededRandom(this.seed + cellSeed);
      const dripInterval = isExitPathCell ? 1.5 + staticRnd.next() * 1.5 : 2.5 + staticRnd.next() * 3.0; // exit path drips slightly faster as an active guide!

      this.waterDrips.push({
        dropMesh: droplet,
        rippleMesh: ripple,
        puddleX: posX,
        puddleZ: posZ,
        timer: staticRnd.next() * dripInterval,
        frequence: dripInterval,
        progress: 0.0,
        hasDripped: false,
        gridX: gx,
        gridZ: gz,
      });
    }

    // CUSTOM ENHANCEMENT: Arched plaster partition wall for ARCH_ROOM cells (running horizontally on gz === 9)
    if (cellType === CellType.ARCH_ROOM && gz === 9) {
      const archGroup = new THREE.Group();
      archGroup.position.set(posX, 0, posZ);

      // 1. Half-wall base (from/at height y = 0.5 with total thickness of 0.25)
      const halfWallGeo = this.sharedGeo("half_wall", () => new THREE.BoxGeometry(4.0, 1.0, 0.25));
      const halfWall = new THREE.Mesh(halfWallGeo, this.wallMaterial);
      halfWall.position.set(0, 0.5, 0);
      halfWall.receiveShadow = true;
      halfWall.castShadow = true;
      archGroup.add(halfWall);

      // 2. Skirting boards/molding on both bottom sides of half-wall
      const baseSouth = new THREE.Mesh(this.baseGeo, this.skirtingBoardMaterial);
      baseSouth.position.set(0, 0.06, 0.145);
      archGroup.add(baseSouth);

      const baseNorth = new THREE.Mesh(this.baseGeo, this.skirtingBoardMaterial);
      baseNorth.position.set(0, 0.06, -0.145);
      archGroup.add(baseNorth);

      // 3. Extruded elegant archway shape sitting precisely on top of half-wall (from y = 1.0 to 3.0)
      const shape = new THREE.Shape();
      shape.moveTo(-2.0, 0.0);
      shape.lineTo(2.0, 0.0);
      shape.lineTo(2.0, 2.0);
      shape.lineTo(-2.0, 2.0);
      shape.closePath();

      const hole = new THREE.Path();
      hole.moveTo(-1.5, 0.0);
      hole.lineTo(1.5, 0.0);
      hole.lineTo(1.5, 1.1);
      hole.absarc(0.0, 1.1, 1.5, 0, Math.PI, false);
      hole.lineTo(-1.5, 1.1);
      hole.lineTo(-1.5, 0.0);
      shape.holes.push(hole);

      const extrudeSettings = {
        depth: 0.25,
        bevelEnabled: false
      };
      const archGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const archMesh = new THREE.Mesh(archGeo, this.wallMaterial);
      archMesh.position.set(0, 1.0, -0.125); // exactly offset by half depth to align center
      archMesh.castShadow = true;
      archMesh.receiveShadow = true;
      archGroup.add(archMesh);

      group.add(archGroup);
    }

    // 9. SPAWN SCATTERED COLLECTIBLES (Old Photo and Rusty Key)
    // On both Level 0 and Level 1, there is a sparse chance (e.g., 3.5%) to spawn a collectible item in a cell
    const itemRng = new SeededRandom(this.seed + gx * 83 + gz * 109);
    // Don't spawn collectibles at the exit or spawning point (0,0) or solid cells
    if (itemRng.next() < 0.035 && !(gx === this.exitGridX && gz === this.exitGridZ) && !(gx === 0 && gz === 0)) {
      const itemTypeRoll = itemRng.next();
      // Keep it within the cell boundaries (so + hSize/2 is center, range is -hSize/2 + 0.5 to hSize/2 - 0.5)
      const maxOffset = hSize / 2 - 0.6;
      const ix = posX + itemRng.nextRange(-maxOffset, maxOffset);
      const iz = posZ + itemRng.nextRange(-maxOffset, maxOffset);
      const iy = 0.45; // floating slightly off the floor

      const cellType = this.grid[gx][gz];
      const isRoom = cellType === CellType.ROOM_SMALL || 
                     cellType === CellType.ROOM_LARGE || 
                     cellType === CellType.OPEN_AREA || 
                     cellType === CellType.PIT_ROOM || 
                     cellType === CellType.ARCH_ROOM || 
                     cellType === CellType.RED_ROOM;

      let selectedType: "old_photo" | "rusty_key" | "cassette_tape" | "strange_crystal" | "liquid_pain" | "diary_page" | "scrap_of_note";
      let spawnedMesh: THREE.Group;

      if (isRoom && itemTypeRoll < 0.45) {
        selectedType = "scrap_of_note";
        spawnedMesh = this.createScrapOfNoteMesh();
      } else {
        const adjustedRoll = isRoom ? (itemTypeRoll - 0.45) / 0.55 : itemTypeRoll;
        if (adjustedRoll < 0.25) {
          selectedType = "old_photo";
          spawnedMesh = this.createOldPhotoMesh();
        } else if (adjustedRoll < 0.50) {
          selectedType = "rusty_key";
          spawnedMesh = this.createRustyKeyMesh();
        } else if (adjustedRoll < 0.65) {
          selectedType = "cassette_tape";
          spawnedMesh = this.createCassetteTapeMesh();
        } else if (adjustedRoll < 0.80) {
          selectedType = "strange_crystal";
          spawnedMesh = this.createStrangeCrystalMesh();
        } else if (adjustedRoll < 0.90) {
          selectedType = "liquid_pain";
          spawnedMesh = this.createLiquidPainMesh();
        } else {
          selectedType = "diary_page";
          spawnedMesh = this.createDiaryPageMesh();
        }
      }

      spawnedMesh.position.set(ix, iy, iz);
      group.add(spawnedMesh);

      this.consumables.push({
        mesh: spawnedMesh,
        initialY: iy,
        collected: false,
        type: selectedType,
        x: ix,
        z: iz,
        gridX: gx,
        gridZ: gz,
      });

      this.animatingMeshes.push({
        mesh: spawnedMesh,
        type: "spin",
        initialY: iy,
        phase: itemRng.nextRange(0, Math.PI * 2),
        gridX: gx,
        gridZ: gz,
      });
    }

    // In Level 2, spawn Almond Water and Energy Bars on the ground to aid the sprint escape!
    if (this.level === 2 && !(gx === this.exitGridX && gz === this.exitGridZ) && !(gx === 2 && gz === 2)) {
      const runRng = new SeededRandom(this.seed + gx * 137 + gz * 191);
      if (runRng.next() < 0.18) {
        const itemType = runRng.next() < 0.6 ? "almond_water" : "energy_bar";
        const maxOffset = hSize / 2 - 0.6;
        const ix = posX + runRng.nextRange(-maxOffset, maxOffset);
        const iz = posZ + runRng.nextRange(-maxOffset, maxOffset);
        const iy = 0.35; // floating slightly for visual pickup cue

        if (itemType === "almond_water") {
          const bottle = this.createAlmondWaterBottleMesh();
          bottle.position.set(ix, iy, iz);
          group.add(bottle);

          this.consumables.push({
            mesh: bottle,
            initialY: iy,
            collected: false,
            type: "almond_water",
            x: ix,
            z: iz,
            gridX: gx,
            gridZ: gz,
          });

          this.animatingMeshes.push({
            mesh: bottle,
            type: "spin",
            initialY: iy,
            phase: runRng.nextRange(0, Math.PI * 2),
            gridX: gx,
            gridZ: gz,
          });
        } else {
          const bar = this.createEnergyBarMesh();
          bar.position.set(ix, iy, iz);
          group.add(bar);

          this.consumables.push({
            mesh: bar,
            initialY: iy,
            collected: false,
            type: "energy_bar",
            x: ix,
            z: iz,
            gridX: gx,
            gridZ: gz,
          });

          this.animatingMeshes.push({
            mesh: bar,
            type: "spin",
            initialY: iy,
            phase: runRng.nextRange(0, Math.PI * 2),
            gridX: gx,
            gridZ: gz,
          });
        }
      }
    }

    return group;
  }

  /**
   * Generates a 3D procedural layout representation for an office chair
   */
  private createChairMesh(rng: SeededRandom, isTipped: boolean, isFloating: boolean): THREE.Group {
    const chair = new THREE.Group();

    // Four-star rolling legs base (low poly)
    const leg1 = new THREE.Mesh(this.chairLegGeo, this.plasticMaterial);
    leg1.position.set(0, 0.015, 0);
    chair.add(leg1);

    const leg2 = new THREE.Mesh(this.chairLegGeo, this.plasticMaterial);
    leg2.rotateY(Math.PI / 2);
    leg2.position.set(0, 0.015, 0);
    chair.add(leg2);

    // Hydraulic stem cylinder
    const stem = new THREE.Mesh(this.chairStemGeo, this.metalMaterial);
    stem.position.set(0, 0.23, 0);
    chair.add(stem);

    // Padding seat cushion
    const seat = new THREE.Mesh(this.chairSeatGeo, this.fabricMaterial);
    seat.position.set(0, 0.46, 0);
    seat.castShadow = true;
    chair.add(seat);

    // Seat back support bar (metal support)
    const backBar = new THREE.Mesh(this.unitBoxGeo, this.metalMaterial);
    backBar.scale.set(0.1, 0.45, 0.06);
    backBar.position.set(0, 0.72, -0.22);
    chair.add(backBar);

    // Backrest pad
    const backrest = new THREE.Mesh(this.chairBackGeo, this.fabricMaterial);
    backrest.position.set(0, 0.95, -0.25);
    backrest.castShadow = true;
    chair.add(backrest);

    // If it's tipped over, we rotate the whole chair group onto its side (e.g. 80-90 degrees pitch/roll)
    if (isTipped) {
      chair.position.y = 0.28; // rest on its side
      chair.rotation.z = Math.PI / 2 - 0.15;
      chair.rotation.x = rng.nextRange(-0.2, 0.2);
    } else {
      chair.position.y = 0;
    }

    return chair;
  }

  /**
   * Generates a mysterious, messy, stacked pyramid of office chairs resting on top of each other
   */
  private createChairPyramid(rng: SeededRandom): THREE.Group {
    const pyramid = new THREE.Group();

    // Floor Base (Level 1) - 4 chairs facing each other, slightly offset
    const baseOffsets = [
      { x: -0.28, z: -0.28, ry: 0.15 + rng.nextRange(-0.1, 0.1), rx: 0.04, rz: -0.02 },
      { x: 0.28, z: -0.28, ry: -1.35 + rng.nextRange(-0.1, 0.1), rx: -0.04, rz: 0.05 },
      { x: -0.28, z: 0.28, ry: 1.75 + rng.nextRange(-0.1, 0.1), rx: 0.06, rz: 0.03 },
      { x: 0.28, z: 0.28, ry: 2.95 + rng.nextRange(-0.1, 0.1), rx: -0.02, rz: -0.04 }
    ];

    baseOffsets.forEach((offset) => {
      const chair = this.createChairMesh(rng, false, false);
      chair.position.set(offset.x, 0, offset.z);
      chair.rotation.y = offset.ry;
      chair.rotation.x = offset.rx;
      chair.rotation.z = offset.rz;
      pyramid.add(chair);
    });

    // Middle Stack (Level 2) - 2 chairs turned on top, interlocked and tilted
    const midOffsets = [
      { x: -0.16, y: 0.44, z: -0.05, ry: -0.9 + rng.nextRange(-0.15, 0.15), rx: 0.2, rz: -0.14 },
      { x: 0.18, y: 0.44, z: 0.08, ry: 1.3 + rng.nextRange(-0.15, 0.15), rx: -0.15, rz: 0.22 }
    ];

    midOffsets.forEach((offset) => {
      const chair = this.createChairMesh(rng, false, false);
      chair.position.set(offset.x, offset.y, offset.z);
      chair.rotation.y = offset.ry;
      chair.rotation.x = offset.rx;
      chair.rotation.z = offset.rz;
      pyramid.add(chair);
    });

    // Peak Chair (Level 3) - 1 single top chair sitting precariously on top
    const topChair = this.createChairMesh(rng, false, false);
    topChair.position.set(0.01, 0.88, 0.02);
    topChair.rotation.y = 2.4 + rng.nextRange(-0.2, 0.2);
    topChair.rotation.x = 0.22;
    topChair.rotation.z = -0.18;
    pyramid.add(topChair);

    return pyramid;
  }

  /**
   * Generates a 3D cardboard box mesh stacked with packing tape
   */
  private createCardboardBoxMesh(rng: SeededRandom): THREE.Group {
    const boxGroup = new THREE.Group();

    // Core box
    const mainBox = new THREE.Mesh(this.boxGeo, this.cardboardBoxMaterial);
    mainBox.position.set(0, 0.325, 0);
    mainBox.castShadow = true;
    mainBox.receiveShadow = true;
    boxGroup.add(mainBox);

    // Packing tape stripe running across top and sides using unitBoxGeo scaled
    const tapeTop = new THREE.Mesh(this.unitBoxGeo, this.tapeMaterial);
    tapeTop.scale.set(0.08, 0.012, 0.66);
    tapeTop.position.set(0, 0.655, 0);
    boxGroup.add(tapeTop);

    // Front/Back tape sides
    // Front tape side
    const tapeFront = new THREE.Mesh(this.unitBoxGeo, this.tapeMaterial);
    tapeFront.scale.set(0.08, 0.4, 0.012);
    tapeFront.position.set(0, 0.45, 0.33);
    boxGroup.add(tapeFront);

    // Back tape side
    const tapeBack = new THREE.Mesh(this.unitBoxGeo, this.tapeMaterial);
    tapeBack.scale.set(0.08, 0.4, 0.012);
    tapeBack.position.set(0, 0.45, -0.33);
    boxGroup.add(tapeBack);

    return boxGroup;
  }

  /**
   * Generates a 3D industrial metal oil drum or chemical barrel
   */
  private createMetalDrumMesh(rng: SeededRandom): THREE.Group {
    const drum = new THREE.Group();

    // Dark rusted steel barrel skin
    const barrelColor = rng.next() > 0.5 ? 0x2e3532 : 0x7c3c1a; // Gunmetal iron or oxidized rust orange!
    const drumMaterial = this.sharedMat(`drum_${barrelColor}`, () => new THREE.MeshStandardMaterial({
      color: barrelColor,
      roughness: 0.62,
      metalness: 0.88
    }));

    // Main barrel cylinder using shared geometry
    const body = new THREE.Mesh(this.barrelCylinderGeo, drumMaterial);
    body.position.set(0, 0.45, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    drum.add(body);

    // Dynamic metallic structural reinforcement rings (ribs of the oil drum) using shared geometry
    const rim1 = new THREE.Mesh(this.barrelRimGeo, drumMaterial);
    rim1.position.set(0, 0.18, 0);
    rim1.rotation.x = Math.PI / 2;
    drum.add(rim1);

    const rim2 = new THREE.Mesh(this.barrelRimGeo, drumMaterial);
    rim2.position.set(0, 0.45, 0);
    rim2.rotation.x = Math.PI / 2;
    drum.add(rim2);

    const rim3 = new THREE.Mesh(this.barrelRimGeo, drumMaterial);
    rim3.position.set(0, 0.72, 0);
    rim3.rotation.x = Math.PI / 2;
    drum.add(rim3);

    return drum;
  }

  /**
   * Generates a rigid steel shipping cargo box
   */
  private createSteelCrateMesh(rng: SeededRandom): THREE.Group {
    const crate = new THREE.Group();

    const ironColor = 0x3d4345; // industrial slate iron
    const crateMaterial = this.sharedMat("crate_iron", () => new THREE.MeshStandardMaterial({
      color: ironColor,
      roughness: 0.75,
      metalness: 0.82
    }));

    const panelMaterial = this.sharedMat("crate_panel", () => new THREE.MeshStandardMaterial({
      color: 0x272c2d, // dark steel panel inside frame
      roughness: 0.8,
      metalness: 0.75
    }));

    // Main rigid metal core box using scaled unitBoxGeo
    const core = new THREE.Mesh(this.unitBoxGeo, panelMaterial);
    core.scale.set(0.78, 0.78, 0.78);
    core.position.set(0, 0.39, 0);
    core.castShadow = true;
    core.receiveShadow = true;
    crate.add(core);

    // Frame struts (horizontal and vertical borders creating paneling look)
    // Corner struts using scaled unitBoxGeo
    const positions = [
      [-0.39, 0.39, -0.39],
      [0.39, 0.39, -0.39],
      [-0.39, 0.39, 0.39],
      [0.39, 0.39, 0.39],
    ];
    positions.forEach(([cx, cy, cz]) => {
      const strut = new THREE.Mesh(this.unitBoxGeo, crateMaterial);
      strut.scale.set(0.1, 0.8, 0.1);
      strut.position.set(cx, cy, cz);
      crate.add(strut);
    });

    // Cross braces on the crate faces representing industrial reinforced framing
    // Front cross
    const frontCross = new THREE.Mesh(this.unitBoxGeo, crateMaterial);
    frontCross.scale.set(0.04, 1.05, 0.04);
    frontCross.rotation.z = Math.PI / 4;
    frontCross.position.set(0, 0.39, 0.395);
    crate.add(frontCross);

    // Back cross
    const backCross = new THREE.Mesh(this.unitBoxGeo, crateMaterial);
    backCross.scale.set(0.04, 1.05, 0.04);
    backCross.rotation.z = -Math.PI / 4;
    backCross.position.set(0, 0.39, -0.395);
    crate.add(backCross);

    return crate;
  }

  /**
   * Generates a 3D low-poly Almond Water bottle with packaging labels & glowing energy
   */
  public createAlmondWaterBottleMesh(): THREE.Group {
    const group = new THREE.Group();
    // Bottle cylinder
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.85
    });
    const bodyObj = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6), bodyMat);
    bodyObj.position.set(0, 0.175, 0);
    group.add(bodyObj);

    // Label wrapper
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95
    });
    const labelObj = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.16, 6), labelMat);
    labelObj.position.set(0, 0.16, 0);
    group.add(labelObj);

    // Cap
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xffdd44,
      roughness: 0.2,
      metalness: 0.8
    });
    const capObj = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 6), capMat);
    capObj.position.set(0, 0.36, 0);
    group.add(capObj);

    // Soft glow billboard to attract players (cheaper and visible from further away)
    const bottleGlow = this.createItemGlow(0x88ccff, 0.9, 0.5);
    bottleGlow.position.set(0, 0.2, 0);
    group.add(bottleGlow);

    return group;
  }

  /**
   * Generates a 3D low-poly Energy Snack Bar wrap
   */
  public createEnergyBarMesh(): THREE.Group {
    const group = new THREE.Group();
    // Wrap
    const wrapMat = new THREE.MeshStandardMaterial({
      color: 0xff3355,
      roughness: 0.3,
      metalness: 0.82
    });
    const bodyObj2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.12), wrapMat);
    bodyObj2.position.set(0, 0.025, 0);
    group.add(bodyObj2);

    // Soft golden energy wrapper shine glow billboard
    const barGlow = this.createItemGlow(0xff3355, 0.8, 0.5);
    barGlow.position.set(0, 0.1, 0);
    group.add(barGlow);

    return group;
  }

  /**
   * Generates a 3D low-poly Old Polaroid Photo
   */
  public createOldPhotoMesh(): THREE.Group {
    const group = new THREE.Group();
    
    // Border / Backing (white/beige paperboard)
    const backMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5dc,
      roughness: 0.85,
      metalness: 0.05
    });
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.01, 0.28), backMat);
    backing.position.set(0, 0.005, 0);
    group.add(backing);

    // Inner picture area (sepia/faded dark grey)
    const picMat = new THREE.MeshStandardMaterial({
      color: 0x3d2c1e,
      roughness: 0.22,
      metalness: 0.08
    });
    const picture = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.012, 0.20), picMat);
    picture.position.set(0, 0.006, 0.02); // offset to match polaroid format
    group.add(picture);

    // Soft sepia-colored glow
    const photoGlow = this.createItemGlow(0xffcc66, 0.85, 0.5);
    photoGlow.position.set(0, 0.15, 0);
    group.add(photoGlow);

    return group;
  }

  /**
   * Generates a 3D low-poly Rusty Key
   */
  public createRustyKeyMesh(): THREE.Group {
    const group = new THREE.Group();
    
    const keyMat = new THREE.MeshStandardMaterial({
      color: 0x9c5c3c, // Rusty orange-brown
      roughness: 0.9,
      metalness: 0.85
    });

    // Top head loop
    const torusGeo = new THREE.TorusGeometry(0.05, 0.015, 6, 12);
    const head = new THREE.Mesh(torusGeo, keyMat);
    head.rotation.x = Math.PI / 2;
    head.position.set(0, 0.02, -0.06);
    group.add(head);

    // Key shaft
    const shaftGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.18, 6);
    const shaft = new THREE.Mesh(shaftGeo, keyMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0.02, 0.04);
    group.add(shaft);

    // Key teeth
    const teethGeo = new THREE.BoxGeometry(0.04, 0.015, 0.05);
    const teeth = new THREE.Mesh(teethGeo, keyMat);
    teeth.position.set(0.025, 0.02, 0.11);
    group.add(teeth);

    // Soft golden-rusty glow
    const keyGlow = this.createItemGlow(0xff7733, 0.85, 0.55);
    keyGlow.position.set(0, 0.15, 0);
    group.add(keyGlow);

    return group;
  }

  /**
   * Generates a 3D low-poly Cassette Tape
   */
  public createCassetteTapeMesh(): THREE.Group {
    const group = new THREE.Group();
    const caseMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.7,
      metalness: 0.2
    });
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.9
    });
    
    // Tape body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.12), caseMat);
    body.position.set(0, 0.015, 0);
    group.add(body);
    
    // Center label sticker
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.032, 0.07), labelMat);
    label.position.set(0, 0.016, 0);
    group.add(label);
    
    const tapeGlow = this.createItemGlow(0xddaa44, 0.8, 0.45);
    tapeGlow.position.set(0, 0.1, 0);
    group.add(tapeGlow);
    
    return group;
  }

  /**
   * Generates a 3D low-poly Strange Crystal
   */
  public createStrangeCrystalMesh(): THREE.Group {
    const group = new THREE.Group();
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x00ffcc,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x00ffcc,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9
    });
    
    // Low poly crystal structure
    const geom = new THREE.ConeGeometry(0.06, 0.18, 5);
    const topCone = new THREE.Mesh(geom, crystalMat);
    topCone.position.set(0, 0.09, 0);
    group.add(topCone);
    
    const bottomCone = new THREE.Mesh(geom, crystalMat);
    bottomCone.rotation.z = Math.PI;
    bottomCone.position.set(0, 0.09, 0);
    group.add(bottomCone);
    
    const crystalGlow = this.createItemGlow(0x00ffcc, 0.95, 0.6);
    crystalGlow.position.set(0, 0.15, 0);
    group.add(crystalGlow);
    
    return group;
  }

  /**
   * Generates a 3D low-poly Liquid Pain vial
   */
  public createLiquidPainMesh(): THREE.Group {
    const group = new THREE.Group();
    const flaskMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      roughness: 0.2,
      metalness: 0.9,
      transparent: true,
      opacity: 0.8
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.8
    });
    
    // Flask body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.18, 6), flaskMat);
    body.position.set(0, 0.09, 0);
    group.add(body);
    
    // Flask neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), flaskMat);
    neck.position.set(0, 0.2, 0);
    group.add(neck);
    
    // Flask cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 6), capMat);
    cap.position.set(0, 0.24, 0);
    group.add(cap);
    
    const flaskGlow = this.createItemGlow(0xff0033, 0.95, 0.6);
    flaskGlow.position.set(0, 0.15, 0);
    group.add(flaskGlow);
    
    return group;
  }

  /**
   * Generates a 3D low-poly Torn Diary Page
   */
  public createDiaryPageMesh(): THREE.Group {
    const group = new THREE.Group();
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xe6dfc3, // parchment color
      roughness: 0.95,
      metalness: 0.0
    });
    
    const page = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.005, 0.24), paperMat);
    page.rotation.y = Math.PI / 12;
    page.position.set(0, 0.003, 0);
    group.add(page);
    
    const pageGlow = this.createItemGlow(0xfff2a3, 0.8, 0.45);
    pageGlow.position.set(0, 0.1, 0);
    group.add(pageGlow);
    
    return group;
  }

  /**
   * Generates a 3D low-poly Torn Scrap of Note
   */
  public createScrapOfNoteMesh(): THREE.Group {
    const group = new THREE.Group();
    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xd9cfa1, // darker, aged paper/parchment color
      roughness: 0.98,
      metalness: 0.0
    });
    
    const page = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.004, 0.16), paperMat);
    page.rotation.y = -Math.PI / 8;
    page.rotation.x = Math.PI / 24;
    page.position.set(0, 0.002, 0);
    group.add(page);
    
    const pageGlow = this.createItemGlow(0x00f3ff, 0.85, 0.55);
    pageGlow.position.set(0, 0.12, 0);
    group.add(pageGlow);
    
    return group;
  }

  /**
   * Generates a compact industrial furnace generator or utility boiler
   */
  private createBoilerMesh(rng: SeededRandom): THREE.Group {
    const boiler = new THREE.Group();

    const metalDark = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.65,
      metalness: 0.95
    });

    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xb87333, // premium copper color
      roughness: 0.35,
      metalness: 0.95
    });

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xcd7f32, // brass yellow-orange
      roughness: 0.25,
      metalness: 0.9
    });

    // 1. Core boiler chamber body using scaled unitBoxGeo
    const body = new THREE.Mesh(this.unitBoxGeo, metalDark);
    body.scale.set(0.85, 1.45, 0.85);
    body.position.set(0, 0.725, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    boiler.add(body);

    // 2. Copper steam discharge pipe curving up out of the side
    const pipe = new THREE.Mesh(this.boilerPipeVerticalGeo, copperMat);
    pipe.position.set(0.385, 1.05, 0.22);
    pipe.rotation.x = Math.PI / 18; // slight off angles
    boiler.add(pipe);

    const pipeline = new THREE.Mesh(this.boilerPipeElbowGeo, copperMat);
    pipeline.position.set(0.385, 1.35, 0.2);
    pipeline.rotation.y = Math.PI / 2;
    boiler.add(pipeline);

    // 3. Round copper gauge dials on front
    // Glass display dial
    const gauge = new THREE.Mesh(this.boilerDialPlateGeo, brassMat);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(-0.15, 0.95, 0.43);
    boiler.add(gauge);

    // Indicator red indicator light
    const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const indicator = new THREE.Mesh(this.boilerIndicatorGeo, indicatorMat);
    indicator.position.set(0.15, 1.1, 0.43);
    boiler.add(indicator);

    // 4. Pressure valve steel wheel turn knob
    const shaft = new THREE.Mesh(this.boilerValveShaftGeo, metalDark);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0.15, 0.65, 0.46);
    boiler.add(shaft);

    const wheel = new THREE.Mesh(this.boilerValveWheelGeo, copperMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0.15, 0.65, 0.525);
    boiler.add(wheel);

    return boiler;
  }

  /**
   * Traverses list of fluorescent luminaires, updating flickering states.
   * Handles local organic flickers and random level-wide environmental events.
   * Also animates ceiling leak water droplets and floor ripples.
   */
  public updateLights(
    delta: number,
    onFlickerAudio: (durationMs: number) => void,
    onWaterDrip: (pan: number, volumeScale: number) => void,
    playerX: number,
    playerZ: number
  ) {
    // 1. Manage Global Event Cooldowns and Transitions
    if (this.globalEventState !== "normal") {
      this.globalEventTimer -= delta;
      
      // Play quick high-tension static electrical buzzing periodically during a active flicker storm
      if (this.globalEventState === "flicker_storm" && Math.random() < 0.08) {
        onFlickerAudio(150 + Math.random() * 200);
      }
      
      if (this.globalEventTimer <= 0) {
        this.globalEventState = "normal";
        this.eventCooldown = 30.0 + Math.random() * 25.0; // Cooldown for 30-55 seconds
      }
    } else {
      this.eventCooldown -= delta;
      if (this.eventCooldown <= 0) {
        // Cooldown finished! Roll for a random scare/flicker event (38% occurrence chance)
        if (Math.random() < 0.38) {
          const roll = Math.random();
          if (roll < 0.55) {
            // Flicker storm: All map lights start pulsing and popping frantically
            this.globalEventState = "flicker_storm";
            this.globalEventTimer = 5.0 + Math.random() * 6.0; // 5 to 11 seconds
            onFlickerAudio(600); // Massive initial discharge sound
          } else {
            // Full Blackout: Complete darkness across Level 0
            this.globalEventState = "blackout";
            this.globalEventTimer = 4.0 + Math.random() * 4.0; // 4 to 8 seconds
            onFlickerAudio(400); // Blackout click sound
          }
        } else {
          // If roll failed, reset cooldown slightly
          this.eventCooldown = 15.0 + Math.random() * 15.0;
        }
      }
    }

    // 2. Evaluate state of each individual lamp.
    // Only fixtures inside the streamed-in radius are simulated: the full list
    // can hold well over a thousand lamps on the larger levels.
    const fixtures = this.activeLightFixtures;
    for (let i = 0; i < fixtures.length; i++) {
      const fixture = fixtures[i];

      if (this.globalEventState === "blackout") {
        fixture.light.intensity = 0.0;
        fixture.mesh.material = this.fluorescentGlassOff;
      } else if (this.globalEventState === "flicker_storm") {
        const flashOn = Math.random() > 0.45;
        // Subtly dim the bulbs rather than dropping them to absolute blackout to reduce strobe strain
        fixture.light.intensity = flashOn ? fixture.intensity : fixture.intensity * 0.35;
        fixture.mesh.material = flashOn ? this.fluorescentGlassOn : this.fluorescentGlassOff;
      } else {
        // Normal mode: Standard individual quiet organic flickers
        if (fixture.flickerTimer > 0) {
          fixture.flickerTimer -= delta;

          // Rapid oscillating glow with comfortable visual range
          const flash = Math.random() > 0.4;
          fixture.light.intensity = flash ? fixture.intensity : fixture.intensity * 0.45;
          fixture.mesh.material = flash ? this.fluorescentGlassOn : this.fluorescentGlassOff;

          // Reset once timer completes
          if (fixture.flickerTimer <= 0) {
            fixture.light.intensity = fixture.intensity;
            fixture.mesh.material = this.fluorescentGlassOn;
          }
        } else {
          // Very rare natural spark flicker probability (0.0125% per frame)
          if (Math.random() < 0.00018) {
            const duration = Math.floor(250 + Math.random() * 500); // 250ms - 750ms flicker
            fixture.flickerTimer = duration / 1000;

            // Trigger sound only if light bulb is reasonably close to Client Player to save resources.
            // fixture.mesh sits inside the fixture group, so its position is
            // cell-local; the registered light carries the world coordinates.
            const dx = fixture.light.x - playerX;
            const dz = fixture.light.z - playerZ;
            const distSq = dx * dx + dz * dz;

            if (distSq < 225) { // within 15 meters
              onFlickerAudio(duration);
            }
          }
        }
      }

      // Animate the stagnant dust under this light
      if (fixture.dust) {
        const time = Date.now() * 0.001;
        // Gently rotate the points to simulate swirling air drafting
        fixture.dust.rotation.y += delta * 0.045;
        fixture.dust.rotation.x += delta * 0.015;
        // Mild vertical buoyancy bob
        fixture.dust.position.y = Math.sin(time * 0.75 + fixture.gridX * 2.0) * 0.035;

        // Modulate opacity under flicking light panel conditions:
        const mat = fixture.dust.material as THREE.PointsMaterial;
        if (mat) {
          const ratio = fixture.intensity > 0 ? fixture.light.intensity / fixture.intensity : 0;
          mat.opacity = 0.12 + ratio * 0.38; // Dim ambient reflection when off, glowing bright when on
        }
      }
    }

    // 2.5. Update water drips/ceiling leaks (Backrooms Level 0 carpet moisture physics)
    // Only nearby leaks are simulated; distant ones simply resume where they
    // left off when the player walks back into range.
    this.activeWaterDrips.forEach((drip) => {
      const dx = drip.puddleX - playerX;
      const dz = drip.puddleZ - playerZ;
      const distSq = dx * dx + dz * dz;
      
      // If within visible sound distance (e.g., 20m) we animate, else we just do background timers
      const isVisibleRange = distSq < 20 * 20;
      
      if (drip.timer > 0) {
        drip.timer -= delta;
        if (drip.timer <= 0) {
          drip.progress = 0.0;
          drip.hasDripped = false;
          if (isVisibleRange) {
            drip.dropMesh.position.set(drip.puddleX, 3.0, drip.puddleZ);
            drip.dropMesh.visible = true;
            drip.rippleMesh.scale.set(0.01, 1.0, 0.01);
            const ripMat = drip.rippleMesh.material as THREE.MeshBasicMaterial;
            if (ripMat) ripMat.opacity = 0.0;
          }
        }
      } else {
        drip.progress += delta / 0.8; // Takes 0.8 seconds to fall from ceiling to floor
        
        if (drip.progress < 1.0) {
          if (isVisibleRange) {
            // Accelerating quadratic fall: y = 3.0 * (1 - progress^2)
            const currentY = 3.0 * (1.0 - drip.progress * drip.progress);
            drip.dropMesh.position.y = currentY;
          }
        } else {
          // Droplet reached ground!
          if (!drip.hasDripped) {
            drip.hasDripped = true;
            if (isVisibleRange) {
              drip.dropMesh.visible = false;
              
              // Trigger spatialized sound plop!
              const dist = Math.sqrt(distSq);
              if (dist > 0.1) {
                // Approximate panning simply: -1 (left) to +1 (right) relative to player coordinates
                const panRepresentation = -dx / Math.max(0.1, dist);
                const volumeScale = Math.max(0.0, 1.0 - dist / 12.0); // complete fadeout beyond 12m
                if (volumeScale > 0) {
                  onWaterDrip(panRepresentation, volumeScale);
                }
              }
            }
          }
          
          // Animate splash ripple ring expansion
          const rippleAge = drip.progress - 1.0;
          const rippleDuration = 0.65;
          const rippleProgress = rippleAge / rippleDuration;
          
          if (rippleProgress < 1.0) {
            if (isVisibleRange) {
              const scale = 0.15 + rippleProgress * 1.6; // grows up to 1.75m circumference
              drip.rippleMesh.scale.set(scale, 1.0, scale);
              
              const ripMat = drip.rippleMesh.material as THREE.MeshBasicMaterial;
              if (ripMat) {
                ripMat.opacity = 0.75 * (1.0 - rippleProgress);
              }
            }
          } else {
            // Drip cycle complete! Reset to random wait period
            drip.timer = drip.frequence + Math.random() * 1.5;
            if (isVisibleRange) {
              drip.dropMesh.visible = false;
              drip.rippleMesh.scale.set(0.01, 1.0, 0.01);
              const ripMat = drip.rippleMesh.material as THREE.MeshBasicMaterial;
              if (ripMat) ripMat.opacity = 0.0;
            }
          }
        }
      }
    });

    // 3. Update glitch/animate meshes (gently bobbing, rotating, jitter scale pulsing)
    this.activeAnimatingMeshes.forEach((anim) => {
      anim.phase += delta * 1.5;
      if (anim.type === "bob") {
        anim.mesh.position.y = anim.initialY + Math.sin(anim.phase) * 0.12;
      } else if (anim.type === "spin") {
        anim.mesh.rotation.y += delta * 0.4;
        anim.mesh.position.y = anim.initialY + Math.sin(anim.phase * 1.5) * 0.1;
      } else if (anim.type === "glitch") {
        anim.mesh.position.y = anim.initialY + Math.sin(anim.phase * 2.5) * 0.15;
        anim.mesh.rotation.y += delta * 1.5;
        anim.mesh.rotation.x += delta * 0.8;
        
        // Rapid chaotic scale flickering/ghosting jitter for extra horror vibe
        const scaleChance = Math.random() > 0.08 ? 1.0 : 0.5;
        anim.mesh.scale.set(scaleChance, scaleChance, scaleChance);
      }
    });
  }

  /**
   * Implements Occlusion and Proximity Culling load/unload cycle.
   * Compares each grid coordinate, adding blocks within visible radius and removing ones beyond.
   */
  public performProximityCulling(scene: THREE.Scene, playerX: number, playerZ: number, force = false) {
    // Optimization check: If player has moved less than 2.5 meters (half cell width), don't run heavy loops
    const distMovedSq = (playerX - this.lastCulledX) * (playerX - this.lastCulledX) + (playerZ - this.lastCulledZ) * (playerZ - this.lastCulledZ);
    if (!force && distMovedSq < 6.25) { // 2.5 meters threshold squared is 6.25
      return;
    }
    this.lastCulledX = playerX;
    this.lastCulledZ = playerZ;

    const hSize = this.cellSize;
    const maxVisibleDistanceSq = this.maxVisibleDistance * this.maxVisibleDistance;

    const pGx = Math.floor(playerX / hSize);
    const pGz = Math.floor(playerZ / hSize);

    // Only compute cells in a 7x7 neighborhood around the player (24m visible / 4m cellSize)
    const radiusCells = Math.ceil(this.maxVisibleDistance / hSize) + 1;

    const minX = Math.max(0, pGx - radiusCells);
    const maxX = Math.min(this.gridSize - 1, pGx + radiusCells);
    const minZ = Math.max(0, pGz - radiusCells);
    const maxZ = Math.min(this.gridSize - 1, pGz + radiusCells);

    const nextVisibleCellKeys = new Set<string>();
    // Rebuilt in the same pass as the streaming loop below.
    const culling: { group: THREE.Group; box: THREE.Box3 }[] = [];

    // Only activate/instantiate cells immediately near the explorer
    for (let gx = minX; gx <= maxX; gx++) {
      for (let gz = minZ; gz <= maxZ; gz++) {
        if (this.grid[gx][gz] === CellType.SOLID) continue;

        const cellX = gx * hSize + hSize / 2;
        const cellZ = gz * hSize + hSize / 2;

        const dx = cellX - playerX;
        const dz = cellZ - playerZ;
        const distSq = dx * dx + dz * dz;

        if (distSq <= maxVisibleDistanceSq) {
          const mapKey = `${gx},${gz}`;
          nextVisibleCellKeys.add(mapKey);

          // Fast direct array lookup avoiding string/map allocations
          let cellGroup = this.cellGroupGrid[gx][gz];
          if (!cellGroup) {
            cellGroup = this.createCell3D(gx, gz);
            scene.add(cellGroup);
            this.cellGroups.set(mapKey, cellGroup);
            this.cellGroupGrid[gx][gz] = cellGroup;
          }
          if (!cellGroup.visible) {
            cellGroup.visible = true;
          }

          if (!cellGroup.userData.aabb) {
            cellGroup.userData.aabb = new THREE.Box3(
              new THREE.Vector3(gx * hSize, -0.5, gz * hSize),
              new THREE.Vector3((gx + 1) * hSize, 3.5, (gz + 1) * hSize)
            );
          }
          culling.push({ group: cellGroup, box: cellGroup.userData.aabb });
        }
      }
    }

    // Hide cells that are no longer in proximity
    this.visibleCellKeys.forEach((key) => {
      if (!nextVisibleCellKeys.has(key)) {
        const cellGroup = this.cellGroups.get(key);
        if (cellGroup) {
          cellGroup.visible = false;
        }
      }
    });

    this.visibleCellKeys = nextVisibleCellKeys;

    this.activeCellsForCulling = culling;
    this.rebuildActiveWorkLists(minX, maxX, minZ, maxZ);
  }

  /**
   * Rebuilds the per-frame simulation lists (lamps, leaks, animated props,
   * collectibles) from the cells currently streamed in.
   *
   * These used to be iterated in full every frame. On Level 2 that meant
   * thousands of `Math.random()` calls and sine evaluations per frame for props
   * the player could not possibly see.
   */
  private rebuildActiveWorkLists(minX: number, maxX: number, minZ: number, maxZ: number) {
    const inRange = (gx: number, gz: number) =>
      gx >= minX && gx <= maxX && gz >= minZ && gz <= maxZ;

    this.activeLightFixtures.length = 0;
    for (let i = 0; i < this.lightFixtures.length; i++) {
      const f = this.lightFixtures[i];
      if (inRange(f.gridX, f.gridZ)) this.activeLightFixtures.push(f);
    }

    this.activeWaterDrips.length = 0;
    for (let i = 0; i < this.waterDrips.length; i++) {
      const d = this.waterDrips[i];
      if (inRange(d.gridX, d.gridZ)) this.activeWaterDrips.push(d);
    }

    this.activeAnimatingMeshes.length = 0;
    for (let i = 0; i < this.animatingMeshes.length; i++) {
      const a = this.animatingMeshes[i];
      if (inRange(a.gridX, a.gridZ)) this.activeAnimatingMeshes.push(a);
    }

    this.activeConsumables.length = 0;
    for (let i = 0; i < this.consumables.length; i++) {
      const c = this.consumables[i];
      if (!c.collected && inRange(c.gridX, c.gridZ)) this.activeConsumables.push(c);
    }
  }

  /**
   * Performs rapid, CPU-efficient view frustum culling on active cell groups.
   * Completely avoids drawing or processing meshes/lights outside the player's field of view (frustum).
   */
  public performFrustumCulling(camera: THREE.Camera) {
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const len = this.activeCellsForCulling.length;
    for (let i = 0; i < len; i++) {
      const item = this.activeCellsForCulling[i];
      const isVisible = this.frustum.intersectsBox(item.box);
      item.group.visible = isVisible;
    }
  }

  /**
   * Pre-creates all non-solid cells of the map asynchronously to completely eliminate runtime gameplay execution lags.
   */
  public async precreateAllCellsAsync(scene: THREE.Scene, onProgress?: (p: number) => void): Promise<void> {
    const list: [number, number][] = [];
    for (let gx = 0; gx < this.gridSize; gx++) {
      for (let gz = 0; gz < this.gridSize; gz++) {
        if (this.grid[gx][gz] !== CellType.SOLID) {
          list.push([gx, gz]);
        }
      }
    }

    const total = list.length;
    if (total === 0) return;

    // Process in sequential chunks to let browser handle and paint screen
    const chunkSize = 20;
    for (let i = 0; i < total; i += chunkSize) {
      const end = Math.min(i + chunkSize, total);
      for (let j = i; j < end; j++) {
        const [gx, gz] = list[j];
        const mapKey = `${gx},${gz}`;
        if (!this.cellGroups.has(mapKey)) {
          const cellGroup = this.createCell3D(gx, gz);
          cellGroup.visible = false;
          scene.add(cellGroup);
          this.cellGroups.set(mapKey, cellGroup);
          this.cellGroupGrid[gx][gz] = cellGroup;
        }
      }
      if (onProgress) {
        onProgress(end / total);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // Cells created here bypassed the streaming pass, so invalidate the culling
    // cache to make the next tick rebuild the active work lists.
    this.lastCulledX = -9999;
    this.lastCulledZ = -9999;
  }

  /**
   * Clean up all instantiated level cell groups from Three Scene.
   */
  public clearAll(scene: THREE.Scene) {
    this.lastCulledX = -9999;
    this.lastCulledZ = -9999;
    this.visibleCellKeys.clear();
    this.activeCellsForCulling = [];
    this.cellGroups.forEach((cellGroup) => {
      scene.remove(cellGroup);
    });
    this.cellGroups.clear();
    this.cellObstacles.clear();
    this.obstacleGrid = Array.from({ length: 48 }, () => Array(48).fill(null));
    this.cellGroupGrid = Array.from({ length: 48 }, () => Array(48).fill(null));
    this.lightFixtures = [];
    this.animatingMeshes = [];
    this.waterDrips = [];
    this.consumables = [];
    this.dynamicLights = [];
    this.activeLightFixtures = [];
    this.activeWaterDrips = [];
    this.activeAnimatingMeshes = [];
    this.activeConsumables = [];
    this.wetSpills.clear();

    // Release the shared prop cache. Without this, every level transition
    // leaked one full set of geometries, materials and canvas textures.
    this.sharedGeometries.forEach((geo) => geo.dispose());
    this.sharedGeometries.clear();
    this.sharedMaterials.forEach((mat) => mat.dispose());
    this.sharedMaterials.clear();
    this.sharedTextures.forEach((tex) => tex.dispose());
    this.sharedTextures = [];
    this.glowTexture = null;
    if (this.dustTexture) {
      this.dustTexture.dispose();
      this.dustTexture = null;
    }

    // Dispose shared static geometries completely to prevent memory leaks on level change
    if (this.floorGeo) this.floorGeo.dispose();
    if (this.ceilGeo) this.ceilGeo.dispose();
    if (this.wallGeo) this.wallGeo.dispose();
    if (this.baseGeo) this.baseGeo.dispose();
    if (this.pillarGeo) this.pillarGeo.dispose();
    if (this.caseGeo) this.caseGeo.dispose();
    if (this.tubeGeo) this.tubeGeo.dispose();
    
    // Dispose prop geometries
    if (this.dividerGeo) this.dividerGeo.dispose();
    if (this.partitionBaseGeo) this.partitionBaseGeo.dispose();
    if (this.chairSeatGeo) this.chairSeatGeo.dispose();
    if (this.chairBackGeo) this.chairBackGeo.dispose();
    if (this.chairStemGeo) this.chairStemGeo.dispose();
    if (this.chairLegGeo) this.chairLegGeo.dispose();
    if (this.boxGeo) this.boxGeo.dispose();
    if (this.unitBoxGeo) this.unitBoxGeo.dispose();
    if (this.pitGeoWall) this.pitGeoWall.dispose();
    if (this.pitGeoFloor) this.pitGeoFloor.dispose();
    if (this.barrelCylinderGeo) this.barrelCylinderGeo.dispose();
    if (this.barrelRimGeo) this.barrelRimGeo.dispose();
    if (this.boilerPipeVerticalGeo) this.boilerPipeVerticalGeo.dispose();
    if (this.boilerPipeElbowGeo) this.boilerPipeElbowGeo.dispose();
    if (this.boilerDialPlateGeo) this.boilerDialPlateGeo.dispose();
    if (this.boilerIndicatorGeo) this.boilerIndicatorGeo.dispose();
    if (this.boilerValveShaftGeo) this.boilerValveShaftGeo.dispose();
    if (this.boilerValveWheelGeo) this.boilerValveWheelGeo.dispose();
    if (this.anomalyOuterGeo) this.anomalyOuterGeo.dispose();
    if (this.anomalyInnerGeo) this.anomalyInnerGeo.dispose();
    if (this.deskTopGeo) this.deskTopGeo.dispose();
    if (this.deskLegGeo) this.deskLegGeo.dispose();
    if (this.paperGeo) this.paperGeo.dispose();
    if (this.lampBaseGeo) this.lampBaseGeo.dispose();
    if (this.lampShadeGeo) this.lampShadeGeo.dispose();

    // Dispose damp levels geometries and materials
    if (this.puddleGeo) this.puddleGeo.dispose();
    if (this.leakStainGeo) this.leakStainGeo.dispose();
    if (this.dropGeo) this.dropGeo.dispose();
    if (this.rippleGeo) this.rippleGeo.dispose();

    if (this.puddleMaterial) this.puddleMaterial.dispose();
    if (this.leakStainMaterial) this.leakStainMaterial.dispose();
    if (this.dropMaterial) this.dropMaterial.dispose();
    if (this.rippleMaterial) this.rippleMaterial.dispose();
  }
}
