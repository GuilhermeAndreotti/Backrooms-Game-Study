/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *

 * The room lobby: a fenced sports ground under an open sky, where explorers
 * wait for the host to start the expedition. A soccer pitch with bleachers
 * takes the west side; a paved plaza on the east holds the cheat terminal,
 * the mirror, the wardrobe and the chess table. Everything here is plain
 * props on top of the generic map (which only carves the empty plot and
 * skips the walls/ceiling, see ProceduralMap.carveLobby / createCell3D).
 *
 * Graphics budget: one sun + one hemisphere light, no extra shadow casters,
 * and everything repeated (fence posts, trees, lamps, far buildings) is a
 * single InstancedMesh, so the whole scenery is a few dozen draw calls.
 */

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EMPTY_CHESS, fromFen, type ChessNetState, type PieceType } from "../shared/chess";
import { t } from "../i18n";
export { LOBBY_LEVEL } from "./levels/constants";

/** Layout in world metres (the hall itself is grid cells 2..21 x 2..15, 4 m each). */
export const LOBBY = {
  field: { cx: 21, cz: 24, length: 22, width: 14 },
  goalWidth: 5,
  goalDepth: 1.4,
  spawnCell: { x: 10, z: 6 },
  /** Walkable plot: world x 8..48, z 8..40 (solid, invisible cells all around). */
  hall: { minCell: 2, maxCellX: 11, maxCellZ: 9 },
  /** The paved plaza east of the pitch (world XZ bounds). */
  plaza: { minX: 34.5, maxX: 48, minZ: 8, maxZ: 40 },
  /** The cheat terminal, in the plaza's south-east corner (world XZ). */
  terminal: { x: 45, z: 36 },
  /** A big standing mirror against the east fence; its glass faces -X (toward the pitch). */
  mirror: { x: 46.9, z: 27.6, width: 2.2, height: 3.2 },
  /** The wardrobe ("Armário"), right beside the mirror, doors facing -X. */
  wardrobe: { x: 46.95, z: 23.6, width: 1.7, depth: 0.62, height: 2.25 },
  /**
   * The chess table, in the plaza's north end. White sits on its south side
   * (+z), black on the north; the board spans CHESS.board metres.
   */
  chess: { x: 41, z: 13.5 },
  /** Almond-water vending machine against the north fence (decorative, solid). */
  vending: { x: 45.6, z: 8.75 },
  /** Bleachers along the pitch's north touchline (centre of the front row's footprint). */
  bleachers: { x: 21, z: 14.1, length: 12 },
  /** Street lamps around the pitch and plaza (solid poles). */
  lamps: [[8.9, 9.1], [21, 9.1], [33.6, 9.1], [8.9, 38.9], [21, 38.9], [33.6, 38.9], [47.4, 32.5], [47.4, 16]] as [number, number][],
};

/** Where the sun is painted on the sky canvas (u across, v down from the zenith). */
const SUN_U = 0.62, SUN_V = 0.27;

/** Small deterministic PRNG for decoration placement (never gameplay). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fence just outside the walkable plot (world XZ). */
const FENCE = { minX: 7.7, maxX: 48.3, minZ: 7.7, maxZ: 40.3, height: 2.3 };
/** Far enough to hold the sky dome; restored to the default when leaving (see GameEngine.setupLobby). */
export const LOBBY_CAMERA_FAR = 230;

/** The chess table's dimensions (metres). */
export const CHESS = { top: 0.78, size: 1.7, board: 1.36, seatDist: 1.35 };

const BALL_RADIUS = 0.35;
const FRICTION = 1.25; // 1/s exponential slow-down
const RESTITUTION = 0.6;

/** Replicated ball state (short keys: it goes out ~15 times a second). */
export interface BallNetState {
  x: number; z: number; vx: number; vz: number;
  /** Goals scored so far (so late joiners and lagging clients see each goal once). */
  g: number;
}

export interface LobbyUpdateContext {
  /** This client simulates the ball (otherwise it follows the authority's frames). */
  authority: boolean;
  px: number; pz: number;
  /** Player's horizontal velocity, m/s. */
  pvx: number; pvz: number;
  /** A local kick; non-authority clients forward it to the authority. */
  onKick: (vx: number, vz: number) => void;
  onGoal: () => void;
}

export class Lobby {
  public group = new THREE.Group();
  private ball: THREE.Mesh;
  /** The mirror's glass (a planar render-to-texture reflection, see buildMirror). */
  public mirror: Reflector | null = null;

  public x = LOBBY.field.cx;
  public z = LOBBY.field.cz;
  public vx = 0;
  public vz = 0;
  public goals = 0;

  // Non-authority: last frame from the authority, extrapolated between frames.
  private netX = this.x;
  private netZ = this.z;
  private netVX = 0;
  private netVZ = 0;

  private kickCooldown = 0;
  private resetTimer = 0;
  private disposables: { dispose(): void }[] = [];

  /** Follows the player so the horizon never gets any closer. */
  private sky: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.buildSky();
    this.buildGround();
    this.buildFence();
    this.buildScenery();
    this.buildPlaza();
    this.buildField();
    this.buildGoals();
    this.buildBenches();
    this.buildBleachers();
    this.buildCheatTerminal();
    this.buildMirror();
    this.buildWardrobe();
    this.buildChessTable();
    this.ball = this.buildBall();
    scene.add(this.group);
  }

  // --- construction --------------------------------------------------------

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  /** A canvas texture this lobby owns (disposed with it). */
  private canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d")!);
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
    }
    return tex;
  }

  // --- scenery --------------------------------------------------------------

  /**
   * An equirectangular sky painted once on a canvas (gradient, a soft sun and
   * a few clouds) on an unlit inside-out sphere that follows the player, plus
   * the two lights that make everything else read as daylight. The horizon
   * colour matches the lobby's fog, so the ground melts into it.
   */
  private buildSky() {
    const rand = mulberry(7);
    const W = 2048, H = 1024;
    const tex = this.canvasTexture(W, H, (g) => {
      // The texture wraps around the sphere: anything crossing the left/right
      // edge is drawn a second time on the other side, or it shows a seam.
      const wrapped = (x: number, r: number, draw: (x: number) => void) => {
        draw(x);
        if (x - r < 0) draw(x + W);
        if (x + r > W) draw(x - W);
      };
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#2f6fbf");
      grad.addColorStop(0.36, "#5d9ad8");
      grad.addColorStop(0.5, "#a6d2f2");
      grad.addColorStop(1, "#a6d2f2");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // Sun (matches the directional light below), widened by the projection's
      // 1/sin(polar angle) so it reads round on the sphere instead of squashed.
      const sunR = 180, sunStretch = 1 / Math.sin(SUN_V * Math.PI);
      wrapped(SUN_U * W, sunR * sunStretch, (x) => {
        const sun = g.createRadialGradient(x, SUN_V * H, 0, x, SUN_V * H, sunR);
        sun.addColorStop(0, "rgba(255,255,240,1)");
        sun.addColorStop(0.12, "rgba(255,250,225,0.95)");
        sun.addColorStop(0.35, "rgba(255,240,200,0.25)");
        sun.addColorStop(1, "rgba(255,240,200,0)");
        g.fillStyle = sun;
        g.save(); g.translate(x, SUN_V * H); g.scale(sunStretch, 1); g.translate(-x, -SUN_V * H);
        g.fillRect(x - sunR, SUN_V * H - sunR, sunR * 2, sunR * 2);
        g.restore();
      });
      // Clouds: clusters of soft blobs, squashed toward the horizon.
      for (let i = 0; i < 28; i++) {
        const cx = rand() * W, cy = 250 + rand() * 230;
        const n = 4 + Math.floor(rand() * 5);
        for (let j = 0; j < n; j++) {
          const y = cy + (rand() - 0.5) * 26;
          const r = 20 + rand() * 34;
          wrapped(cx + (rand() - 0.5) * 150, r * 1.8, (x) => {
            const blob = g.createRadialGradient(x, y, 0, x, y, r);
            blob.addColorStop(0, "rgba(255,255,255,0.65)");
            blob.addColorStop(0.45, "rgba(255,255,255,0.3)");
            blob.addColorStop(1, "rgba(255,255,255,0)");
            g.fillStyle = blob;
            g.save(); g.translate(x, y); g.scale(1.8, 0.6); g.translate(-x, -y);
            g.fillRect(x - r, y - r, r * 2, r * 2);
            g.restore();
          });
        }
      }
    });
    const sky = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(200, 32, 16)),
      this.track(new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.group.add(sky);
    this.sky = sky;

    // Where the painted sun ends up on the sphere (SphereGeometry's own u/v mapping).
    const phi = SUN_U * Math.PI * 2, theta = SUN_V * Math.PI;
    const dir = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    const sunLight = new THREE.DirectionalLight(0xfff0d2, 1.7);
    sunLight.position.set(28 + dir.x * 60, dir.y * 60, 24 + dir.z * 60);
    sunLight.target.position.set(28, 0, 24);
    this.group.add(sunLight, sunLight.target);
    this.group.add(new THREE.HemisphereLight(0xcfe4ff, 0x56703a, 0.9));
  }

  /** One big grass plane out to the horizon (the plot's own cell floors are hidden, see ProceduralMap). */
  private buildGround() {
    const SIZE = 600;
    const rand = mulberry(3);
    const tex = this.canvasTexture(128, 128, (g) => {
      g.fillStyle = "#4f7a33";
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        const shade = rand();
        g.fillStyle = shade < 0.5 ? "rgba(36,70,24,0.45)" : shade < 0.85 ? "rgba(112,150,62,0.4)" : "rgba(150,140,80,0.35)";
        g.fillRect(rand() * 128, rand() * 128, 1 + rand() * 2, 2 + rand() * 3);
      }
    }, [SIZE / 4, SIZE / 4]);
    const ground = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(SIZE, SIZE)),
      this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /** Chain-link fence on a concrete curb, right where the plot's invisible collision is. */
  private buildFence() {
    const { minX, maxX, minZ, maxZ, height } = FENCE;
    const mesh = this.canvasTexture(64, 64, (g) => {
      g.clearRect(0, 0, 64, 64);
      g.strokeStyle = "rgba(170,176,178,1)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(64, 64);
      g.moveTo(64, 0); g.lineTo(0, 64);
      g.stroke();
    });
    mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
    const steel = this.track(new THREE.MeshStandardMaterial({ color: 0x8d9497, roughness: 0.45, metalness: 0.6 }));
    const concrete = this.track(new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.95 }));
    const sides: [number, number, number, number][] = [
      [minX, minZ, maxX, minZ], [maxX, minZ, maxX, maxZ], [maxX, maxZ, minX, maxZ], [minX, maxZ, minX, minZ],
    ];
    const posts: THREE.Vector3[] = [];
    for (const [x0, z0, x1, z1] of sides) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const yaw = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
      const tex = mesh.clone();
      this.track(tex);
      tex.repeat.set(len / 0.3, (height - 0.2) / 0.3);
      tex.needsUpdate = true;
      const net = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(len, height - 0.2)),
        this.track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5, metalness: 0.5 })),
      );
      net.position.set(mx, 0.2 + (height - 0.2) / 2, mz);
      net.rotation.y = yaw;
      this.group.add(net);
      const rail = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, 0.05, 0.05)), steel);
      rail.position.set(mx, height, mz);
      rail.rotation.y = yaw;
      this.group.add(rail);
      const curb = new THREE.Mesh(this.track(new THREE.BoxGeometry(len + 0.25, 0.22, 0.25)), concrete);
      curb.position.set(mx, 0.11, mz);
      curb.rotation.y = yaw;
      this.group.add(curb);
      const n = Math.max(1, Math.round(len / 2.5));
      for (let i = 0; i < n; i++) posts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n));
    }
    const postMesh = this.instanced(new THREE.CylinderGeometry(0.045, 0.045, height + 0.05, 6), steel, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((p, i) => postMesh.setMatrixAt(i, m.makeTranslation(p.x, (height + 0.05) / 2, p.z)));
    this.group.add(postMesh);
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.track(geo), mat, count);
    this.track(mesh);
    return mesh;
  }

  /**
   * Everything past the fence: a belt of low-poly trees and bushes, a few
   * street lamps inside, and a ring of far-off blocky buildings that the fog
   * turns into a skyline. Each kind is a single InstancedMesh; positions come
   * from a fixed-seed generator (pure decoration — nothing gameplay-relevant).
   */
  private buildScenery() {
    const rand = mulberry(11);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const outsideFence = (x: number, z: number, margin: number) =>
      x < FENCE.minX - margin || x > FENCE.maxX + margin || z < FENCE.minZ - margin || z > FENCE.maxZ + margin;

    // Trees (trunk + canopy) and bushes (canopy only, near the ground).
    type Plant = { x: number; z: number; scale: number; tree: boolean };
    const plants: Plant[] = [];
    for (let tries = 0; plants.length < 95 && tries < 2000; tries++) {
      const x = FENCE.minX - 34 + rand() * (FENCE.maxX - FENCE.minX + 68);
      const z = FENCE.minZ - 34 + rand() * (FENCE.maxZ - FENCE.minZ + 68);
      if (!outsideFence(x, z, 2.2)) continue;
      if (plants.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < 9)) continue;
      const nearFence = !outsideFence(x, z, 4.5);
      plants.push({ x, z, scale: 0.8 + rand() * 0.7, tree: !nearFence || rand() < 0.35 });
    }
    // A hedge of bushes hugging the fence on its outside.
    const hedge: Plant[] = [];
    for (let x = FENCE.minX; x <= FENCE.maxX; x += 1.6) {
      hedge.push({ x, z: FENCE.minZ - 0.9, scale: 0.55 + rand() * 0.3, tree: false });
      hedge.push({ x, z: FENCE.maxZ + 0.9, scale: 0.55 + rand() * 0.3, tree: false });
    }
    for (let z = FENCE.minZ; z <= FENCE.maxZ; z += 1.6) {
      hedge.push({ x: FENCE.minX - 0.9, z, scale: 0.55 + rand() * 0.3, tree: false });
      hedge.push({ x: FENCE.maxX + 0.9, z, scale: 0.55 + rand() * 0.3, tree: false });
    }
    const all = [...plants, ...hedge];
    const trees = all.filter((o) => o.tree);
    const bark = this.track(new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1, flatShading: true }));
    const leaves = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }));
    const trunks = this.instanced(new THREE.CylinderGeometry(0.16, 0.24, 2.6, 6).translate(0, 1.3, 0), bark, trees.length);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
    const canopies = this.instanced(canopyGeo, leaves, trees.length * 2 + (all.length - trees.length));
    let c = 0;
    trees.forEach((o, i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      trunks.setMatrixAt(i, m.compose(p.set(o.x, 0, o.z), q, s.setScalar(o.scale)));
      for (const [dy, r] of [[2.9, 1.5], [3.9, 1.05]] as const) {
        canopies.setMatrixAt(c, m.compose(p.set(o.x, dy * o.scale, o.z), q, s.set(r, r * 0.95, r).multiplyScalar(o.scale)));
        canopies.setColorAt(c++, color.setHSL(0.27 + rand() * 0.06, 0.45, 0.22 + rand() * 0.1));
      }
    });
    for (const o of all) {
      if (o.tree) continue;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      canopies.setMatrixAt(c, m.compose(p.set(o.x, 0.45 * o.scale, o.z), q, s.set(1.1, 0.8, 1.1).multiplyScalar(o.scale)));
      canopies.setColorAt(c++, color.setHSL(0.26 + rand() * 0.05, 0.42, 0.2 + rand() * 0.08));
    }
    this.group.add(trunks, canopies);

    // Street lamps (unlit by day — just the fixture, no light source).
    const lampSpots = LOBBY.lamps;
    const poles = this.instanced(new THREE.CylinderGeometry(0.06, 0.09, 5, 6).translate(0, 2.5, 0), this.track(new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.6 })), lampSpots.length);
    const heads = this.instanced(new THREE.BoxGeometry(0.7, 0.14, 0.32).translate(0.28, 5, 0), this.track(new THREE.MeshStandardMaterial({ color: 0x4a4f54, emissive: 0xfff2c4, emissiveIntensity: 0.15, roughness: 0.4 })), lampSpots.length);
    lampSpots.forEach(([x, z], i) => {
      // Lean the head toward the plot's middle.
      q.setFromAxisAngle(up, Math.atan2(-(24 - z), 28 - x));
      m.compose(p.set(x, 0, z), q, s.setScalar(1));
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    this.group.add(poles, heads);

    // Far-off buildings.
    const windows = this.canvasTexture(64, 128, (g) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 128);
      g.fillStyle = "#7d8790";
      for (let y = 6; y < 128; y += 12) for (let x = 5; x < 64; x += 12) g.fillRect(x, y, 7, 7);
    });
    const blocks = this.instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.track(new THREE.MeshStandardMaterial({ map: windows, roughness: 0.9 })), 34);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rand() * 0.12;
      const r = 100 + rand() * 60;
      const w = 10 + rand() * 18, d = 10 + rand() * 16, h = 7 + rand() * (rand() < 0.2 ? 32 : 14);
      q.setFromAxisAngle(up, a + (rand() - 0.5) * 0.4);
      blocks.setMatrixAt(i, m.compose(p.set(28 + Math.cos(a) * r, 0, 24 + Math.sin(a) * r), q, s.set(w, h, d)));
      blocks.setColorAt(i, color.setHSL(0.08 + rand() * 0.05, 0.12, 0.62 + rand() * 0.2));
    }
    this.group.add(blocks);
  }

  /**
   * The paved plaza east of the pitch (concrete slabs, a kerb on its pitch
   * side) and an almond-water vending machine against the north fence.
   */
  private buildPlaza() {
    const { minX, maxX, minZ, maxZ } = LOBBY.plaza;
    const w = maxX - minX, d = maxZ - minZ;
    const slabs = this.canvasTexture(128, 128, (g) => {
      g.fillStyle = "#b8b3a7"; g.fillRect(0, 0, 128, 128);
      const rand = mulberry(5);
      for (let i = 0; i < 600; i++) {
        g.fillStyle = rand() < 0.5 ? "rgba(90,86,78,0.18)" : "rgba(255,255,255,0.14)";
        g.fillRect(rand() * 128, rand() * 128, 2, 2);
      }
      g.strokeStyle = "#8b867b"; g.lineWidth = 3;
      g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 0, 64, 64); g.strokeRect(0, 64, 64, 64); g.strokeRect(64, 64, 64, 64);
    }, [w / 2, d / 2]);
    const plaza = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, d)), this.track(new THREE.MeshStandardMaterial({ map: slabs, roughness: 0.9 })));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set((minX + maxX) / 2, 0.012, (minZ + maxZ) / 2);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    const kerb = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.18, 0.06, d)), this.track(new THREE.MeshStandardMaterial({ color: 0x9d998f, roughness: 0.95 })));
    kerb.position.set(minX, 0.03, (minZ + maxZ) / 2);
    this.group.add(kerb);

    // Vending machine.
    const { x, z } = LOBBY.vending;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    this.group.add(root);
    const body = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.0, 1.9, 0.75)), this.track(new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.5, metalness: 0.3 })));
    body.position.y = 0.95;
    root.add(body);
    const front = this.canvasTexture(128, 256, (g) => {
      g.fillStyle = "#e9dfc4"; g.fillRect(0, 0, 128, 256);
      g.fillStyle = "#2f6f8f"; g.fillRect(0, 0, 128, 44);
      g.fillStyle = "#f2e8cf"; g.font = "bold 18px monospace"; g.textAlign = "center";
      g.fillText("ALMOND", 64, 20); g.fillText("WATER", 64, 38);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
        g.fillStyle = "#d8cfb4"; g.fillRect(8 + k * 22, 56 + r * 40, 18, 32);
        g.fillStyle = "#f4ecd6"; g.fillRect(12 + k * 22, 60 + r * 40, 10, 26);
        g.fillStyle = "#2f6f8f"; g.fillRect(12 + k * 22, 60 + r * 40, 10, 5);
      }
      g.fillStyle = "#222"; g.fillRect(104, 70, 18, 90);
      g.fillStyle = "#111"; g.fillRect(10, 222, 86, 24);
    });
    const glass = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.9, 1.8)), this.track(new THREE.MeshStandardMaterial({ map: front, emissive: 0xffffff, emissiveMap: front, emissiveIntensity: 0.35, roughness: 0.25 })));
    glass.position.set(0, 0.97, 0.376);
    root.add(glass);
  }

  /** Three-row aluminium bleachers along the pitch's north touchline, facing it. */
  private buildBleachers() {
    const { x, z, length } = LOBBY.bleachers;
    // Low metalness: there's no environment map to reflect, so real metal values just render black.
    const alu = this.track(new THREE.MeshStandardMaterial({ color: 0xd4d8db, roughness: 0.4, metalness: 0.25 }));
    const frame = this.track(new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.5 }));
    const seat = this.track(new THREE.BoxGeometry(length, 0.05, 0.34));
    const riser = this.track(new THREE.BoxGeometry(length, 0.42, 0.02));
    for (let row = 0; row < 3; row++) {
      const y = 0.45 + row * 0.42, zz = z + 0.9 - row * 0.75;
      const s = new THREE.Mesh(seat, alu); s.position.set(x, y, zz); this.group.add(s);
      const r = new THREE.Mesh(riser, alu); r.position.set(x, y - 0.22, zz - 0.18); this.group.add(r);
    }
    const legs: [number, number, number][] = [];
    for (let lx = -length / 2 + 0.3; lx <= length / 2 - 0.29; lx += (length - 0.6) / 4) {
      for (let row = 0; row < 3; row++) legs.push([x + lx, 0.45 + row * 0.42, z + 0.9 - row * 0.75]);
    }
    const legMesh = this.instanced(new THREE.BoxGeometry(0.06, 1, 0.06), frame, legs.length);
    const m = new THREE.Matrix4();
    legs.forEach(([lx, h, lz], i) => legMesh.setMatrixAt(i, m.makeScale(1, h, 1).setPosition(lx, h / 2, lz)));
    this.group.add(legMesh);
    // Back rail on the top row.
    const rail = new THREE.Mesh(this.track(new THREE.BoxGeometry(length, 0.05, 0.05)), frame);
    rail.position.set(x, 0.45 + 2 * 0.42 + 0.7, z + 0.9 - 2 * 0.75 - 0.2);
    this.group.add(rail);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.7, 0.05)), frame);
      post.position.set(x + sx * (length / 2 - 0.05), 0.45 + 2 * 0.42 + 0.35, z + 0.9 - 2 * 0.75 - 0.2);
      this.group.add(post);
    }
  }

  /**
   * The wardrobe ("Armário"): a tall wooden cabinet, its left door ajar on a
   * rail of spare suits, a hat left on top and a brass name plate. Using it
   * opens the WardrobeModal in React (see GameEngine.tryInteract).
   */
  private buildWardrobe() {
    const { x, z, width, depth, height } = LOBBY.wardrobe;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = -Math.PI / 2; // local +Z (the doors) -> world -X
    this.group.add(root);

    const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x6e4526, roughness: 0.65 }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x3b2414, roughness: 0.75 }));
    const brass = this.track(new THREE.MeshStandardMaterial({ color: 0xc9a13a, roughness: 0.3, metalness: 0.85 }));
    const th = 0.04, plinth = 0.12;
    const box = (w: number, h: number, d: number, mat: THREE.Material, px: number, py: number, pz: number, parent: THREE.Object3D = root) => {
      const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), mat);
      mesh.position.set(px, py, pz);
      parent.add(mesh);
      return mesh;
    };
    box(width, height - plinth, th, dark, 0, plinth + (height - plinth) / 2, -depth / 2 + th / 2); // back
    for (const sx of [-1, 1]) box(th, height - plinth, depth, wood, sx * (width / 2 - th / 2), plinth + (height - plinth) / 2, 0);
    box(width, th, depth, wood, 0, plinth + th / 2, 0); // floor
    box(width + 0.08, 0.08, depth + 0.06, wood, 0, height + 0.04, 0.01); // crown
    box(width - 0.04, plinth, depth - 0.04, dark, 0, plinth / 2, 0);
    box(width - 2 * th, th, depth - th, wood, 0, height - 0.42, 0); // hat shelf

    // Door panels: a carved-looking inset drawn on a canvas.
    const panel = this.canvasTexture(64, 160, (g) => {
      g.fillStyle = "#74492a"; g.fillRect(0, 0, 64, 160);
      g.strokeStyle = "#4a2c16"; g.lineWidth = 3;
      g.strokeRect(8, 10, 48, 62); g.strokeRect(8, 86, 48, 64);
      g.strokeStyle = "rgba(255,220,170,0.18)"; g.lineWidth = 1;
      for (let i = 0; i < 18; i++) { g.beginPath(); g.moveTo(0, i * 9 + 3); g.bezierCurveTo(20, i * 9 + 6, 44, i * 9, 64, i * 9 + 4); g.stroke(); }
    });
    const doorMat = this.track(new THREE.MeshStandardMaterial({ map: panel, roughness: 0.6 }));
    const doorW = width / 2 - 0.01, doorH = height - plinth - 0.04;
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * (width / 2), plinth + 0.02, depth / 2);
      hinge.rotation.y = side < 0 ? -1.15 : 0; // left door swung open
      root.add(hinge);
      box(doorW, doorH, 0.035, doorMat, -side * doorW / 2, doorH / 2, 0.0175, hinge);
      const knob = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.03, 8, 6)), brass);
      knob.position.set(-side * (doorW - 0.07), doorH * 0.5, 0.06);
      hinge.add(knob);
    }

    // Inside: a rail of spare suits and a tie, visible through the open door.
    const rail = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.012, 0.012, width - 2 * th, 6)), brass);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, height - 0.55, 0);
    root.add(rail);
    const suitGeo = this.track(new THREE.BoxGeometry(0.06, 0.95, 0.4));
    [0xdeb81d, 0xd94f2b, 0x2f6f8f, 0x8a3ab0, 0x3f7d3a].forEach((col, i) => {
      const mat = this.track(new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }));
      box(0.06, 0.95, 0.4, mat, -width / 2 + 0.16 + i * 0.1, height - 1.07, 0).geometry = suitGeo;
    });
    const tie = this.track(new THREE.MeshStandardMaterial({ color: 0xa81c2e, roughness: 0.6 }));
    box(0.02, 0.6, 0.07, tie, width / 2 - 0.25, height - 0.88, 0.05);
    box(0.02, 0.5, 0.07, this.track(new THREE.MeshStandardMaterial({ color: 0x15151a })), width / 2 - 0.2, height - 0.83, -0.05);

    // A top hat left on the hat shelf, and one more on top of the cabinet.
    const hatMat = this.track(new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.45 }));
    const brim = this.track(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 14));
    const crown = this.track(new THREE.CylinderGeometry(0.11, 0.115, 0.22, 12));
    for (const [hx, hy] of [[-0.45, height - 0.4], [0.3, height + 0.08]] as const) {
      const b = new THREE.Mesh(brim, hatMat); b.position.set(hx, hy + 0.008, 0.02); root.add(b);
      const c = new THREE.Mesh(crown, hatMat); c.position.set(hx, hy + 0.125, 0.02); root.add(c);
    }

    // Brass name plate above the doors.
    const plate = this.canvasTexture(256, 48, (g) => {
      g.fillStyle = "#c9a13a"; g.fillRect(0, 0, 256, 48);
      g.strokeStyle = "#6e5212"; g.lineWidth = 4; g.strokeRect(4, 4, 248, 40);
      g.fillStyle = "#3b2a06"; g.font = "bold 26px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t("wardrobe.sign"), 128, 26);
    });
    const sign = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.62, 0.115)), this.track(new THREE.MeshStandardMaterial({ map: plate, roughness: 0.35, metalness: 0.6 })));
    sign.position.set(0, height + 0.04, depth / 2 + 0.042);
    root.add(sign);
  }

  private buildField() {
    const { cx, cz, length, width } = LOBBY.field;
    const W = 1024, H = Math.round(1024 * (width / length));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? "#2f7d32" : "#2a7130";
      ctx.fillRect((i * W) / stripes, 0, W / stripes + 1, H);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 6;
    const m = 14;
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
    ctx.beginPath(); ctx.moveTo(W / 2, m); ctx.lineTo(W / 2, H - m); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.17, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 7, 0, Math.PI * 2); ctx.fill();
    const boxW = W * 0.14, boxH = H * 0.5;
    ctx.strokeRect(m, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - m - boxW, (H - boxH) / 2, boxW, boxH);
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = this.track(new THREE.PlaneGeometry(length, width));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    const field = new THREE.Mesh(geo, mat);
    field.rotation.x = -Math.PI / 2;
    field.position.set(cx, 0.02, cz);
    field.receiveShadow = true;
    this.group.add(field);
  }

  private buildGoals() {
    const { cx, cz, length } = LOBBY.field;
    const half = LOBBY.goalWidth / 2;
    const depth = LOBBY.goalDepth;
    const postMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 }));
    const netMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 }));
    const postGeo = this.track(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8));
    const barGeo = this.track(new THREE.CylinderGeometry(0.07, 0.07, LOBBY.goalWidth, 8));
    const backGeo = this.track(new THREE.PlaneGeometry(LOBBY.goalWidth, 2.4, 14, 6));
    const sideGeo = this.track(new THREE.PlaneGeometry(depth, 2.4, 4, 6));
    const topGeo = this.track(new THREE.PlaneGeometry(depth, LOBBY.goalWidth, 4, 14));

    for (const dir of [-1, 1]) {
      const lineX = cx + dir * (length / 2);
      const backX = lineX + dir * depth;
      for (const oz of [-half, half]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(lineX, 1.2, cz + oz);
        this.group.add(post);
      }
      const bar = new THREE.Mesh(barGeo, postMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(lineX, 2.4, cz);
      this.group.add(bar);

      const back = new THREE.Mesh(backGeo, netMat);
      back.rotation.y = Math.PI / 2;
      back.position.set(backX, 1.2, cz);
      this.group.add(back);
      for (const oz of [-half, half]) {
        const side = new THREE.Mesh(sideGeo, netMat);
        side.position.set((lineX + backX) / 2, 1.2, cz + oz);
        this.group.add(side);
      }
      const top = new THREE.Mesh(topGeo, netMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set((lineX + backX) / 2, 2.4, cz);
      this.group.add(top);
    }
  }

  private buildBenches() {
    const woodMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 }));
    const seat = this.track(new THREE.BoxGeometry(4, 0.12, 0.6));
    const leg = this.track(new THREE.BoxGeometry(0.12, 0.45, 0.5));
    const { cx, cz, width } = LOBBY.field;
    for (const ox of [-8, 8]) {
      const s = new THREE.Mesh(seat, woodMat);
      s.position.set(cx + ox, 0.5, cz + width / 2 + 1.8);
      this.group.add(s);
      for (const lx of [-1.7, 1.7]) {
        const l = new THREE.Mesh(leg, woodMat);
        l.position.set(cx + ox + lx, 0.25, cz + width / 2 + 1.8);
        this.group.add(l);
      }
    }
  }

  /**
   * A cheap full-length mirror: three's Reflector re-renders the scene from
   * the mirrored camera into a texture each frame — no ray tracing, one extra
   * low-res pass, and only while the glass faces the camera. GameEngine hangs
   * a copy of the local explorer's avatar in front of it that only the
   * reflection pass ever sees (see GameEngine.updateMirrorSelf).
   */
  private buildMirror() {
    const { x, z, width, height } = LOBBY.mirror;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = -Math.PI / 2; // local +Z (the glass's front) -> world -X
    this.group.add(root);

    const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 }));
    const bottom = 0.15;
    const glass = new Reflector(this.track(new THREE.PlaneGeometry(width, height)), {
      textureWidth: 768,
      textureHeight: 1024,
      clipBias: 0.003,
      color: 0xb8bcbf,
    });
    glass.position.set(0, bottom + height / 2, 0.03);
    root.add(glass);
    this.mirror = glass;
    this.disposables.push({ dispose: () => glass.dispose() });

    // Frame, back panel and two feet.
    const t = 0.08;
    const frame = [
      [width + t * 2, t, 0, bottom + height + t / 2],
      [width + t * 2, t, 0, bottom - t / 2],
      [t, height, -width / 2 - t / 2, bottom + height / 2],
      [t, height, width / 2 + t / 2, bottom + height / 2],
    ];
    for (const [w, h, fx, fy] of frame) {
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, 0.1)), wood);
      m.position.set(fx, fy, 0.02);
      root.add(m);
    }
    const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(width, height, 0.03)), wood);
    back.position.set(0, bottom + height / 2, -0.02);
    root.add(back);
    for (const fx of [-width / 2, width / 2]) {
      const foot = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.12, 0.08, 0.6)), wood);
      foot.position.set(fx, 0.04, 0);
      root.add(foot);
    }
  }

  /**
   * The cheat terminal: a standalone kiosk in the corner of the field, off
   * the pitch. A glowing amber screen with a blinking prompt marks it as
   * interactable; the actual code entry is the CheatTerminalModal in React
   * (see GameEngine.tryInteract / submitCheatCode).
   */
  private buildCheatTerminal() {
    const { x, z } = LOBBY.terminal;
    const metalMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6, metalness: 0.5 }));

    const post = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.09, 0.11, 1.05, 8)), metalMat);
    post.position.set(x, 0.525, z);
    this.group.add(post);

    const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 16)), metalMat);
    base.position.set(x, 0.03, z);
    this.group.add(base);

    // Angled console head, facing the field so it reads naturally on approach.
    const head = new THREE.Group();
    head.position.set(x, 1.05, z);
    head.rotation.y = Math.atan2(LOBBY.field.cx - x, LOBBY.field.cz - z);
    this.group.add(head);

    const bezel = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.62, 0.42, 0.06)), metalMat);
    bezel.rotation.x = -0.35;
    head.add(bezel);

    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 176;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0a0f06"; ctx.fillRect(0, 0, 256, 176);
    ctx.strokeStyle = "#ffb703"; ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 240, 160);
    ctx.fillStyle = "#ffb703";
    ctx.font = "bold 20px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.fillText("CHEATS", 128, 78);
    ctx.font = "bold 26px Courier New, monospace";
    ctx.fillText(">_", 128, 118);
    const screenTex = new THREE.CanvasTexture(canvas);
    this.track(screenTex);
    const screen = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(0.54, 0.36)),
      this.track(new THREE.MeshBasicMaterial({ map: screenTex }))
    );
    screen.rotation.x = -0.35;
    screen.position.z = 0.032;
    head.add(screen);

    const glow = new THREE.PointLight(0xffb703, 1.6, 4.5, 1.3);
    glow.position.set(x, 1.1, z);
    this.group.add(glow);
  }

  // --- chess table ---------------------------------------------------------

  private chessPieces = new THREE.Group();
  private chessLast: THREE.Mesh[] = [];
  private chessGeo = new Map<string, THREE.BufferGeometry>();
  private chessMat!: Record<"w" | "b", THREE.MeshStandardMaterial>;
  private chessLabels: Record<"w" | "b", { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string }> | null = null;
  private chessRev = -2;

  /** Centre of a square of the board, in world metres (white's side is +z; file a is on white's left). */
  public chessSquareCenter(sq: number): { x: number; z: number } {
    const s = CHESS.board / 8;
    return { x: LOBBY.chess.x + ((sq & 7) - 3.5) * s, z: LOBBY.chess.z + ((sq >> 3) - 3.5) * s };
  }

  /** A turned piece: a profile (radius, height pairs, in units of one square) spun round the Y axis. */
  private chessLathe(key: string, profile: [number, number][]): THREE.BufferGeometry {
    let g = this.chessGeo.get(key);
    if (!g) {
      const s = CHESS.board / 8;
      g = this.track(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r * s, h * s)), 20));
      this.chessGeo.set(key, g);
    }
    return g;
  }

  private chessPiece(type: PieceType, color: "w" | "b"): THREE.Group {
    const s = CHESS.board / 8;
    const mat = this.chessMat[color];
    const base: [number, number][] = [[0, 0], [0.36, 0], [0.37, 0.05], [0.3, 0.1], [0.24, 0.16]];
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const ball = (key: string, r: number) => this.chessGeo.get(key) ?? (this.chessGeo.set(key, this.track(new THREE.SphereGeometry(r * s, 14, 10))), this.chessGeo.get(key)!);
    const box = (key: string, w: number, h: number, d: number) => this.chessGeo.get(key) ?? (this.chessGeo.set(key, this.track(new THREE.BoxGeometry(w * s, h * s, d * s))), this.chessGeo.get(key)!);
    switch (type) {
      case "p":
        add(this.chessLathe("p", [...base, [0.17, 0.3], [0.22, 0.34], [0.14, 0.38], [0.1, 0.42], [0, 0.42]]));
        add(ball("p_head", 0.17), 0, 0.5 * s);
        break;
      case "r":
        add(this.chessLathe("r", [...base, [0.22, 0.4], [0.3, 0.46], [0.3, 0.62], [0.24, 0.62], [0.24, 0.56], [0, 0.56]]));
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          add(box("r_cren", 0.12, 0.1, 0.12), Math.sin(a) * 0.23 * s, 0.67 * s, Math.cos(a) * 0.23 * s);
        }
        break;
      case "n": {
        add(this.chessLathe("n", [...base, [0.2, 0.28], [0.26, 0.34], [0.2, 0.4], [0, 0.4]]));
        // The horse's head: a leaning block with a muzzle and ears, facing the opponent's side.
        const dir = color === "w" ? -1 : 1;
        const head = add(box("n_head", 0.26, 0.46, 0.5), 0, 0.64 * s, 0.02 * dir * s);
        head.rotation.x = 0.35 * dir;
        add(box("n_muzzle", 0.2, 0.2, 0.3), 0, 0.72 * s, 0.3 * dir * s).rotation.x = -0.3 * dir;
        add(box("n_ear", 0.07, 0.14, 0.07), -0.07 * s, 0.9 * s, -0.04 * dir * s);
        add(box("n_ear", 0.07, 0.14, 0.07), 0.07 * s, 0.9 * s, -0.04 * dir * s);
        break;
      }
      case "b":
        add(this.chessLathe("b", [...base, [0.17, 0.34], [0.26, 0.42], [0.2, 0.62], [0.12, 0.76], [0, 0.78]]));
        add(ball("b_top", 0.07), 0, 0.84 * s);
        break;
      case "q":
        add(this.chessLathe("q", [...base, [0.18, 0.4], [0.3, 0.52], [0.24, 0.72], [0.3, 0.84], [0.26, 0.88], [0, 0.88]]));
        add(ball("q_top", 0.11), 0, 0.97 * s);
        break;
      case "k":
        add(this.chessLathe("k", [...base, [0.18, 0.42], [0.3, 0.55], [0.24, 0.78], [0.28, 0.9], [0.22, 0.94], [0, 0.94]]));
        add(box("k_v", 0.09, 0.3, 0.09), 0, 1.1 * s);
        add(box("k_h", 0.26, 0.09, 0.09), 0, 1.12 * s);
        break;
    }
    return g;
  }

  private buildChessTable() {
    const { x, z } = LOBBY.chess;
    const { top, size, board, seatDist } = CHESS;
    const wood = this.track(new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.7 }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x3e2a18, roughness: 0.6 }));
    this.chessMat = {
      w: this.track(new THREE.MeshStandardMaterial({ color: 0xf2e8d0, roughness: 0.35 })),
      b: this.track(new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 0.3 })),
    };
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    this.group.add(root);
    const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(size, 0.07, size)), wood);
    slab.position.y = top - 0.035;
    root.add(slab);
    const leg = this.track(new THREE.BoxGeometry(0.1, top - 0.07, 0.1));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const l = new THREE.Mesh(leg, dark);
      l.position.set(sx * (size / 2 - 0.12), (top - 0.07) / 2, sz * (size / 2 - 0.12));
      root.add(l);
    }
    // The board: an inlaid 8x8 with a little rank/file lettering on its border.
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d")!;
    const border = 64, cell = (1024 - border * 2) / 8;
    g.fillStyle = "#3e2a18"; g.fillRect(0, 0, 1024, 1024);
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      g.fillStyle = (f + r) % 2 ? "#a8744a" : "#ecd9b0";
      g.fillRect(border + f * cell, border + r * cell, cell, cell);
    }
    g.fillStyle = "#d9b87a";
    g.font = "bold 40px Georgia, serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = 0; i < 8; i++) {
      const lbl = "abcdefgh"[i], num = String(8 - i);
      g.fillText(lbl, border + (i + 0.5) * cell, 1024 - border / 2);
      g.fillText(lbl, border + (i + 0.5) * cell, border / 2);
      g.fillText(num, border / 2, border + (i + 0.5) * cell);
      g.fillText(num, 1024 - border / 2, border + (i + 0.5) * cell);
    }
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const boardMesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(board * (1024 / (1024 - border * 2)), board * (1024 / (1024 - border * 2)))), this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })));
    boardMesh.rotation.x = -Math.PI / 2;
    boardMesh.position.y = top + 0.004;
    root.add(boardMesh);
    // Last move: two squares glowing under the pieces.
    const glow = this.track(new THREE.MeshBasicMaterial({ color: 0xffd95a, transparent: true, opacity: 0.55, depthWrite: false }));
    const glowGeo = this.track(new THREE.PlaneGeometry(board / 8, board / 8));
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(glowGeo, glow);
      m.rotation.x = -Math.PI / 2;
      m.position.y = top + 0.009;
      m.visible = false;
      root.add(m);
      this.chessLast.push(m);
    }
    // The pieces live in world coordinates inside the lobby group (not the table's root).
    this.group.add(this.chessPieces);
    // A chair on each side, and a name plate on the table's edge facing it.
    const seatMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.8 }));
    const cushion = this.track(new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.95 }));
    const chairBase = this.track(new THREE.BoxGeometry(0.5, 0.06, 0.5));
    const chairBack = this.track(new THREE.BoxGeometry(0.5, 0.55, 0.06));
    const chairLeg = this.track(new THREE.BoxGeometry(0.06, 0.45, 0.06));
    const cushionGeo = this.track(new THREE.BoxGeometry(0.42, 0.05, 0.42));
    const labels: Partial<NonNullable<typeof this.chessLabels>> = {};
    for (const color of ["w", "b"] as const) {
      const side = color === "w" ? 1 : -1;
      const chair = new THREE.Group();
      chair.position.set(0, 0, side * seatDist);
      // Chairs face the table; the back is on the far side.
      const seat = new THREE.Mesh(chairBase, seatMat); seat.position.y = 0.45; chair.add(seat);
      const pad = new THREE.Mesh(cushionGeo, cushion); pad.position.y = 0.5; chair.add(pad);
      const back = new THREE.Mesh(chairBack, seatMat); back.position.set(0, 0.75, side * 0.22); chair.add(back);
      for (const lx of [-0.21, 0.21]) for (const lz of [-0.21, 0.21]) {
        const l = new THREE.Mesh(chairLeg, seatMat); l.position.set(lx, 0.225, lz); chair.add(l);
      }
      root.add(chair);
      const lc = document.createElement("canvas");
      lc.width = 256; lc.height = 64;
      const lctx = lc.getContext("2d")!;
      const ltex = this.track(new THREE.CanvasTexture(lc));
      ltex.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.125)), this.track(new THREE.MeshBasicMaterial({ map: ltex })));
      plate.position.set(0, top + 0.006, side * (size / 2 - 0.085));
      plate.rotation.x = -Math.PI / 2;
      plate.rotation.z = color === "w" ? 0 : Math.PI;
      root.add(plate);
      labels[color] = { ctx: lctx, tex: ltex, key: "" };
    }
    this.chessLabels = labels as NonNullable<typeof this.chessLabels>;
    this.setChess(EMPTY_CHESS);
  }

  /** Name plates for the two seats: "WHITE · name" / "BLACK · free". */
  private drawChessLabel(color: "w" | "b", text: string, active: boolean) {
    const l = this.chessLabels?.[color];
    if (!l) return;
    const key = `${text}|${active}`;
    if (l.key === key) return;
    l.key = key;
    const { ctx } = l;
    ctx.fillStyle = color === "w" ? "#efe4c8" : "#1f1814";
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = active ? "#ffd95a" : color === "w" ? "#3e2a18" : "#8a6a3a";
    ctx.lineWidth = active ? 8 : 4;
    ctx.strokeRect(3, 3, 250, 58);
    ctx.fillStyle = color === "w" ? "#2a1e12" : "#efe4c8";
    ctx.font = "bold 28px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 16), 128, 34);
    l.tex.needsUpdate = true;
  }

  /** Puts the pieces where the server says they are. */
  public setChess(state: ChessNetState) {
    if (state.rev === this.chessRev && state.rev >= 0) return;
    this.chessRev = state.rev;
    this.chessPieces.clear();
    const pos = fromFen(state.fen);
    pos.board.forEach((p, sq) => {
      if (!p) return;
      const piece = this.chessPiece(p.t, p.c);
      const c = this.chessSquareCenter(sq);
      piece.position.set(c.x, CHESS.top + 0.004, c.z);
      this.chessPieces.add(piece);
    });
    this.chessLast.forEach((m, i) => {
      const sq = state.last?.[i];
      m.visible = sq !== undefined;
      if (sq !== undefined) {
        const c = this.chessSquareCenter(sq);
        m.position.x = c.x - LOBBY.chess.x;
        m.position.z = c.z - LOBBY.chess.z;
      }
    });
    const turn = state.status === "playing" ? pos.turn : null;
    this.drawChessLabel("w", `♙ ${state.whiteName || "—"}`, turn === "w");
    this.drawChessLabel("b", `♟ ${state.blackName || "—"}`, turn === "b");
  }

  private buildBall(): THREE.Mesh {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f5f5f5"; ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#151515";
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.arc(10 + i * 22 + (j % 2) * 11, 10 + j * 22, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = this.track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const ball = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(BALL_RADIUS, 20, 14)),
      this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }))
    );
    ball.castShadow = true;
    ball.position.set(this.x, BALL_RADIUS + 0.02, this.z);
    this.group.add(ball);
    return ball;
  }

  // --- simulation ---------------------------------------------------------

  /** Puts a kick on the ball (called locally, and by the authority for teammates' kicks). */
  public applyKick(vx: number, vz: number) {
    this.vx = vx;
    this.vz = vz;
    this.netVX = vx;
    this.netVZ = vz;
  }

  public getState(): BallNetState {
    const r = (n: number) => Math.round(n * 100) / 100;
    return { x: r(this.x), z: r(this.z), vx: r(this.vx), vz: r(this.vz), g: this.goals };
  }

  /** Adopts the authority's frame. Returns how many new goals it announces. */
  public applyState(s: BallNetState): number {
    this.netX = s.x; this.netZ = s.z;
    this.netVX = s.vx; this.netVZ = s.vz;
    const newGoals = Math.max(0, s.g - this.goals);
    this.goals = Math.max(this.goals, s.g);
    return newGoals;
  }

  public update(delta: number, ctx: LobbyUpdateContext) {
    const dt = Math.min(delta, 0.1);
    this.kickCooldown -= dt;

    // Kick: run into the ball.
    const dx = this.x - ctx.px, dz = this.z - ctx.pz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.95 && this.kickCooldown <= 0 && this.resetTimer <= 0) {
      const pSpeed = Math.hypot(ctx.pvx, ctx.pvz);
      const away = dist > 0.001 ? [dx / dist, dz / dist] : [1, 0];
      let dirX = away[0], dirZ = away[1];
      if (pSpeed > 0.4) {
        dirX = away[0] * 0.35 + (ctx.pvx / pSpeed) * 0.65;
        dirZ = away[1] * 0.35 + (ctx.pvz / pSpeed) * 0.65;
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX /= l; dirZ /= l;
      }
      const speed = Math.min(13, Math.max(3.2, pSpeed * 1.9 + 2.2));
      const kvx = dirX * speed, kvz = dirZ * speed;
      // Push it clear of the player so one touch is one kick.
      this.x = ctx.px + dirX * 1.0;
      this.z = ctx.pz + dirZ * 1.0;
      this.applyKick(kvx, kvz);
      this.kickCooldown = 0.25;
      ctx.onKick(kvx, kvz);
    }

    if (ctx.authority) {
      this.simulate(dt, ctx);
    } else {
      // Follow the authority's frames: extrapolate them, and glide onto the result.
      this.netX += this.netVX * dt;
      this.netZ += this.netVZ * dt;
      const decay = Math.exp(-FRICTION * dt);
      this.netVX *= decay; this.netVZ *= decay;
      const k = Math.min(1, 10 * dt);
      const ex = this.netX - this.x, ez = this.netZ - this.z;
      if (ex * ex + ez * ez > 36) { this.x = this.netX; this.z = this.netZ; }
      else { this.x += ex * k; this.z += ez * k; }
      this.vx = this.netVX; this.vz = this.netVZ;
    }

    // Roll the ball and place it.
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.02) {
      const axis = new THREE.Vector3(this.vz, 0, -this.vx).normalize();
      this.ball.rotateOnWorldAxis(axis, (sp * dt) / BALL_RADIUS);
    }
    this.ball.position.set(this.x, BALL_RADIUS + 0.02, this.z);
    this.sky?.position.set(ctx.px, 0, ctx.pz);
  }

  private simulate(dt: number, ctx: LobbyUpdateContext) {
    if (this.resetTimer > 0) {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) {
        this.x = LOBBY.field.cx; this.z = LOBBY.field.cz;
        this.vx = 0; this.vz = 0;
      }
      return;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const decay = Math.exp(-FRICTION * dt);
    this.vx *= decay; this.vz *= decay;
    if (Math.hypot(this.vx, this.vz) < 0.05) { this.vx = 0; this.vz = 0; }

    const { cx, cz, length, width } = LOBBY.field;
    const halfL = length / 2, halfW = width / 2;
    const inMouth = Math.abs(this.z - cz) < LOBBY.goalWidth / 2 - 0.1;

    // Side lines bounce.
    if (this.z < cz - halfW + BALL_RADIUS) { this.z = cz - halfW + BALL_RADIUS; this.vz = Math.abs(this.vz) * RESTITUTION; }
    if (this.z > cz + halfW - BALL_RADIUS) { this.z = cz + halfW - BALL_RADIUS; this.vz = -Math.abs(this.vz) * RESTITUTION; }

    // End lines: open in the goal mouth (a goal once the ball is inside), a wall elsewhere.
    for (const dir of [-1, 1]) {
      const lineX = cx + dir * halfL;
      const past = (this.x - lineX) * dir; // >0 beyond the end line
      if (past > 0 && !inMouth) {
        this.x = lineX - dir * BALL_RADIUS * 0.5;
        this.vx = -this.vx * RESTITUTION;
      } else if (past > BALL_RADIUS + 0.4) {
        this.goals++;
        this.resetTimer = 2.5;
        this.vx = 0; this.vz = 0;
        ctx.onGoal();
        return;
      }
      // Back net of the goal.
      if (past > LOBBY.goalDepth - BALL_RADIUS) {
        this.x = lineX + dir * (LOBBY.goalDepth - BALL_RADIUS);
        this.vx = -this.vx * 0.3;
      }
    }
  }

  public dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
