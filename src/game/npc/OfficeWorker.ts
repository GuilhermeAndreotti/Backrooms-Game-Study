/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The MEG employees of the Abandoned Office (see ProceduralMap.level4Employees):
 * rigged office workers who pace beside their desk, stop and watch an explorer
 * who comes close, and gesture while they talk. Purely cosmetic and local —
 * nothing here is networked; interaction still keys off the employee's grid
 * cell (GameEngine.nearMegEmployee), and pacing stays inside that cell's
 * interaction radius.
 */

import * as THREE from "three";
import { animateBiped, rot, rx } from "../mobs/anim";
import { MobAnimCtx, MobJoints } from "../mobs/types";

export type EmployeeGrade = "junior" | "pleno" | "senior";

const LOOKS: Record<EmployeeGrade, { suit: number; shirt: number; tie: number; hair: number; jacket: boolean }> = {
  junior: { suit: 0x3b4a5a, shirt: 0x9fb7cf, tie: 0x2f4f6f, hair: 0x3a2618, jacket: false },
  pleno: { suit: 0x53616a, shirt: 0xd9d4c7, tie: 0x5b5f2a, hair: 0x1c1512, jacket: true },
  senior: { suit: 0x25272c, shirt: 0xe8e4da, tie: 0x7f1d1d, hair: 0x8d8a84, jacket: true },
};

const WALK_SPEED = 0.75;
const PACE_HALF_WIDTH = 1.1;
const WATCH_RADIUS = 5;

/** Small deterministic PRNG, so every client paces its workers alike. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class OfficeWorker {
  readonly group = new THREE.Group();
  readonly name: string;
  private body = new THREE.Group();
  private joints: MobJoints = {};
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  private homeX: number;
  private floorY: number;
  private random: () => number;
  private heading = 0;
  private phase = 0;
  private time = 0;
  private waitTimer: number;
  private targetX: number;
  private moveW = 0;
  private observeW = 0;
  private lookW = 0;
  private talkW = 0;

  constructor(opts: { name: string; grade: EmployeeGrade; x: number; z: number; floorY: number; seed: number }) {
    this.name = opts.name;
    this.homeX = opts.x;
    this.floorY = opts.floorY;
    this.random = mulberry(opts.seed);
    this.waitTimer = 2 + this.random() * 4;
    this.targetX = opts.x;
    this.time = this.random() * 20;
    this.build(LOOKS[opts.grade]);
    this.group.position.set(opts.x, opts.floorY, opts.z);
  }

  // -------------------------------------------------------------------------
  // Model
  // -------------------------------------------------------------------------

  private mat(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness });
    this.materials.push(m);
    return m;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
    this.geometries.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private joint(name: string, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Group {
    const j = new THREE.Group();
    j.name = name;
    j.position.set(x, y, z);
    j.userData.rest = j.position.clone();
    parent.add(j);
    this.joints[name] = j;
    return j;
  }

  /** Office clothes over a plain humanoid rig (same joint names as the monsters' bipeds). */
  private build(look: (typeof LOOKS)[EmployeeGrade]) {
    const suit = this.mat(look.suit, 0.75);
    const shirt = this.mat(look.shirt, 0.85);
    const tieMat = this.mat(look.tie, 0.6);
    const skin = this.mat(0xb98268, 0.9);
    const hair = this.mat(look.hair, 0.95);
    const shoe = this.mat(0x141414, 0.5);
    const badge = this.mat(0xf1f1ea, 0.4);
    const torsoMat = look.jacket ? suit : shirt;
    this.group.add(this.body);

    // Legs: hip -> knee -> shoe (hips at 0.9 m)
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = this.joint(`leg${n}`, side * 0.1, 0.9, 0, this.body);
      this.mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.44, 7), suit, 0, -0.22, 0, leg);
      const shin = this.joint(`shin${n}`, 0, -0.44, 0, leg);
      this.mesh(new THREE.CylinderGeometry(0.062, 0.055, 0.42, 7), suit, 0, -0.21, 0, shin);
      this.mesh(new THREE.BoxGeometry(0.1, 0.06, 0.24), shoe, 0, -0.43, 0.05, shin);
    }

    // Torso on a spine pivot at the pelvis
    const spine = this.joint("spine", 0, 0.9, 0, this.body);
    this.mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.2, 8), suit, 0, 0.02, 0, spine); // hips/belt line
    this.mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.55, 8), torsoMat, 0, 0.38, 0, spine);
    if (look.jacket) {
      // Shirt front showing between the lapels
      this.mesh(new THREE.BoxGeometry(0.14, 0.4, 0.04), shirt, 0, 0.43, 0.18, spine);
    }
    this.mesh(new THREE.BoxGeometry(0.05, 0.34, 0.02), tieMat, 0, 0.42, 0.205, spine);
    this.mesh(new THREE.BoxGeometry(0.08, 0.1, 0.015), badge, -0.12, 0.47, 0.2, spine);

    // Arms: shoulder -> elbow -> hand
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const arm = this.joint(`arm${n}`, side * 0.26, 0.6, 0, spine);
      this.mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.3, 7), torsoMat, 0, -0.15, 0, arm);
      const fore = this.joint(`fore${n}`, 0, -0.3, 0, arm);
      this.mesh(new THREE.CylinderGeometry(0.052, 0.047, 0.27, 7), torsoMat, 0, -0.135, 0, fore);
      this.mesh(new THREE.SphereGeometry(0.05, 7, 6), skin, 0, -0.3, 0.01, fore);
    }

    // Head on a neck pivot: face, hair, the faintest eyes, and a hinged mouth.
    const head = this.joint("head", 0, 0.7, 0, spine);
    this.mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 7), skin, 0, 0.03, 0, head);
    const skull = this.mesh(new THREE.SphereGeometry(0.15, 10, 9), skin, 0, 0.2, 0, head);
    skull.scale.set(0.9, 1.08, 0.95);
    const cap = this.mesh(new THREE.SphereGeometry(0.155, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.23, -0.015, head);
    cap.scale.set(0.95, 1.0, 1.0);
    const eyeMat = this.mat(0x1a1410, 0.5);
    const eyeGeo = new THREE.SphereGeometry(0.016, 6, 6);
    this.mesh(eyeGeo, eyeMat, -0.05, 0.22, 0.13, head);
    this.mesh(eyeGeo, eyeMat, 0.05, 0.22, 0.13, head);
    const jaw = this.joint("jaw", 0, 0.14, 0.1, head);
    this.mesh(new THREE.BoxGeometry(0.07, 0.015, 0.02), this.mat(0x5a2a22, 0.9), 0, 0, 0.035, jaw);
  }

  // -------------------------------------------------------------------------
  // Behaviour
  // -------------------------------------------------------------------------

  /** `talking`: this worker's dialogue is open. */
  update(delta: number, playerX: number, playerZ: number, talking: boolean) {
    this.time += delta;
    const pos = this.group.position;
    const dx = playerX - pos.x;
    const dz = playerZ - pos.z;
    const dist = Math.hypot(dx, dz);
    const watching = talking || dist < WATCH_RADIUS;

    // Pace between two spots beside the desk; stop to watch a visitor.
    let moving = false;
    if (!watching) {
      const toTarget = this.targetX - pos.x;
      if (Math.abs(toTarget) > 0.05) {
        moving = true;
        pos.x += Math.sign(toTarget) * Math.min(Math.abs(toTarget), WALK_SPEED * delta);
      } else {
        this.waitTimer -= delta;
        if (this.waitTimer <= 0) {
          this.waitTimer = 3 + this.random() * 6;
          this.targetX = this.homeX + (this.random() * 2 - 1) * PACE_HALF_WIDTH;
        }
      }
    }
    pos.y = this.floorY;
    const damp = THREE.MathUtils.damp;
    this.moveW = damp(this.moveW, moving ? 1 : 0, 8, delta);
    this.observeW = damp(this.observeW, watching ? 1 : 0, 3, delta);
    this.lookW = damp(this.lookW, dist < WATCH_RADIUS + 3 ? 1 : 0, 4, delta);
    this.talkW = damp(this.talkW, talking ? 1 : 0, 5, delta);
    if (moving) this.phase += (WALK_SPEED / 1.3) * Math.PI * 2 * delta;

    // Facing: along the pacing line while walking, toward the visitor when watching.
    const toPlayer = Math.atan2(dx, dz);
    const want = moving ? (this.targetX > pos.x ? Math.PI / 2 : -Math.PI / 2) : watching ? toPlayer : this.heading;
    this.heading += wrap(want - this.heading) * Math.min(1, 3 * delta);
    this.group.rotation.y = this.heading;

    this.pose(delta, wrap(toPlayer - this.heading), Math.atan2(1.6 - 1.55, Math.max(dist, 0.5)));
  }

  private pose(delta: number, lookYaw: number, lookPitch: number) {
    const j = this.joints;
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    const ctx: MobAnimCtx = {
      joints: j, body: this.body, time: this.time, delta, phase: this.phase,
      move: this.moveW, run: 0, observe: this.observeW * 0.4, look: this.lookW,
      lookYaw: THREE.MathUtils.clamp(lookYaw, -1.1, 1.1), lookPitch: THREE.MathUtils.clamp(lookPitch, -0.5, 0.5),
      agitated: false, chasing: false,
    };
    animateBiped(ctx, { stride: 0.35, armSwing: 0.3, knee: 0.6, elbow: 0.12, lean: 0, bounce: 0.03, breathe: 0.02 });

    const { time } = this;
    const idle = (1 - this.moveW) * (1 - this.observeW);
    // Idle: every so often, straightens the tie.
    const tieFix = idle * Math.max(0, Math.sin(time * 0.45) - 0.8) * 5; // 0..1 pulse
    if (tieFix > 0) {
      rot(j.armR, -0.9 * tieFix, 0, -0.35 * tieFix);
      rx(j.foreR, -1.6 * tieFix);
    }
    // Talking: explains with the right hand, nods, the mouth moves.
    if (this.talkW > 0.01) {
      const t = this.talkW;
      const gesture = Math.sin(time * 2.3);
      rot(j.armR, -0.6 * t + gesture * 0.2 * t, 0, -0.15 * t);
      rx(j.foreR, -(0.9 + Math.sin(time * 3.1) * 0.35) * t);
      rot(j.armL, -0.15 * t, 0, 0.05);
      if (j.head) j.head.rotation.x += Math.sin(time * 4.2) * 0.06 * t;
      rx(j.jaw, Math.max(0, Math.sin(time * 13) * Math.sin(time * 3.7)) * 0.4 * t);
    } else {
      rx(j.jaw, 0);
    }
    // Weight shift from foot to foot while standing.
    this.body.rotation.z = Math.sin(time * 0.6) * 0.025 * (1 - this.moveW);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
