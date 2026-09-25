/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level G: the Finger King drags its nails along the walls as it walks, and
 * the gouges stay behind for a while — they tell you where it HAS been, never
 * where it is. A small fixed pool of wall decals, recycled oldest-first.
 *
 * Every client places them locally from the King's (replicated) path, and
 * each cell/wall choice is a hash of the cell, so everyone sees the same
 * marks without any network traffic.
 */

import * as THREE from "three";
import { CellType, ProceduralMap } from "./ProceduralMap";
import { kingClawTexture } from "./mobs/fingerKingTextures";

const POOL = 18;
/** Seconds a mark stays fully visible, then how long it takes to fade out. */
const HOLD_S = 70;
const FADE_S = 20;

/** Which side of the cell each wall faces: dx, dz toward the solid neighbour. */
const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function cellHash(gx: number, gz: number, salt: number): number {
  let x = (gx * 73856093) ^ (gz * 19349663) ^ (salt * 83492791);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

interface Mark { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; key: string }

export class KingScratches {
  private marks: Mark[] = [];
  private next = 0;
  private lastCell = "";

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(0.55, 1.1);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: kingClawTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.marks.push({ mesh, mat, age: 0, key: "" });
    }
  }

  /** Call every frame with the King's current position (or null when there is none). */
  update(delta: number, map: ProceduralMap, kingX: number | null, kingZ: number | null) {
    for (const m of this.marks) {
      if (!m.mesh.visible) continue;
      m.age += delta;
      m.mat.opacity = m.age < HOLD_S ? 0.9 : Math.max(0, 0.9 * (1 - (m.age - HOLD_S) / FADE_S));
      if (m.mat.opacity <= 0) { m.mesh.visible = false; m.key = ""; }
    }
    if (kingX === null || kingZ === null) return;

    const cs = map.cellSize;
    const gx = Math.floor(kingX / cs);
    const gz = Math.floor(kingZ / cs);
    const cell = `${gx},${gz}`;
    if (cell === this.lastCell) return;
    this.lastCell = cell;
    if (cellHash(gx, gz, 1) > 0.45) return;

    const walls = SIDES.filter(([dx, dz]) => map.grid[gx + dx]?.[gz + dz] === CellType.SOLID);
    if (walls.length === 0) return;
    const [dx, dz] = walls[Math.floor(cellHash(gx, gz, 2) * walls.length)];
    const key = `${cell}:${dx},${dz}`;
    if (this.marks.some((m) => m.key === key)) return;

    const m = this.marks[this.next];
    this.next = (this.next + 1) % POOL;
    const along = (cellHash(gx, gz, 3) - 0.5) * cs * 0.6;
    const cx = gx * cs + cs / 2, cz = gz * cs + cs / 2;
    const x = cx + dx * (cs / 2 - 0.03) + (dz !== 0 ? along : 0);
    const z = cz + dz * (cs / 2 - 0.03) + (dx !== 0 ? along : 0);
    m.mesh.position.set(x, map.getFloorHeightAt(cx, cz) + 1.05 + cellHash(gx, gz, 4) * 0.5, z);
    // Face back into the cell (the plane's front is +Z).
    m.mesh.rotation.set(0, Math.atan2(-dx, -dz), (cellHash(gx, gz, 5) - 0.5) * 0.35);
    m.mesh.visible = true;
    m.age = 0;
    m.mat.opacity = 0.9;
    m.key = key;
  }

  /** Wipes every mark (new level / fresh Level G run). */
  clear() {
    for (const m of this.marks) { m.mesh.visible = false; m.age = 0; m.key = ""; }
    this.lastCell = "";
  }

  dispose() {
    for (const m of this.marks) {
      this.scene.remove(m.mesh);
      m.mat.dispose();
    }
    this.marks[0]?.mesh.geometry.dispose();
    this.marks = [];
  }
}
