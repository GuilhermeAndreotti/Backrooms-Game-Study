/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94's circus ball: the lobby's football, out on real ground. It rides
 * the terrain, rolls back down slopes (getting it up the castle's hill is the
 * puzzle), bounces off walls, furniture and hillsides too steep to climb, and
 * comes to rest on the entrance hall's ring, which opens the way to the model.
 *
 * Networked like the lobby ball (Lobby.ts): the level's authority simulates
 * it and streams frames; everyone else extrapolates those and forwards their
 * kicks. Reaching the ring is also a shared fact ("ball"), so it's reliable
 * and replayed to late arrivals.
 */

import * as THREE from "three";
import type { BallNetState } from "../Lobby";
import { CASTLE_FLOOR, CIRCUS_BALL_START, CIRCUS_RING, TOWN_CELL, townCellAt } from "./townLayout";

export const CIRCUS_BALL_RADIUS = 0.5;
const FRICTION = 0.9; // 1/s exponential slow-down
const RESTITUTION = 0.55;
/** Downhill pull per unit of slope (m/s²): ~3.4 on the steepest walkable ground. */
const SLOPE_PULL = 4.2;
/** Below this downhill pull a resting ball stays put (grass holds it). */
const STATIC_PULL = 0.9;
/** Seconds the ball sits in town (it rolled all the way back) before it's put back in the valley. */
const LOST_DELAY = 2;
const rollAxis = new THREE.Vector3();

export interface TownBallContext {
  /** This client simulates the ball (otherwise it follows the authority's frames). */
  authority: boolean;
  /** The local explorer can touch it (alive, not in a vision or a catch). */
  canKick: boolean;
  px: number; pz: number;
  /** Player's horizontal velocity, m/s. */
  pvx: number; pvz: number;
  collide(x: number, z: number, radius: number): boolean;
  /** A local kick; non-authority clients forward it to the authority. */
  onKick(vx: number, vz: number): void;
  /** Authority only: the ball came to rest on the ring. */
  onDelivered(): void;
  /** Authority only: it rolled back into town and was put back at the start. */
  onLost(): void;
}

/** Floor under the ball: the terrain, or the ring's top. */
export function circusBallGround(x: number, z: number, ground: (x: number, z: number) => number): number {
  if (Math.hypot(x - CIRCUS_RING.x, z - CIRCUS_RING.z) < CIRCUS_RING.radius) return CASTLE_FLOOR + CIRCUS_RING.height;
  return ground(x, z);
}

export class TownBall {
  x = CIRCUS_BALL_START.x;
  z = CIRCUS_BALL_START.z;
  vx = 0;
  vz = 0;
  delivered = false;
  private netX = this.x;
  private netZ = this.z;
  private netVX = 0;
  private netVZ = 0;
  private kickCooldown = 0;
  private lostTimer = 0;

  constructor(private readonly mesh: THREE.Object3D, private readonly ground: (x: number, z: number) => number) {
    this.place(0);
  }

  /** Puts a kick on the ball (called locally, and by the authority for teammates' kicks). */
  applyKick(vx: number, vz: number) {
    if (this.delivered) return;
    this.vx = vx; this.vz = vz;
    this.netVX = vx; this.netVZ = vz;
  }

  getState(): BallNetState {
    const r = (n: number) => Math.round(n * 100) / 100;
    return { x: r(this.x), z: r(this.z), vx: r(this.vx), vz: r(this.vz), g: this.delivered ? 1 : 0 };
  }

  applyState(s: BallNetState) {
    if (this.delivered) return;
    this.netX = s.x; this.netZ = s.z;
    this.netVX = s.vx; this.netVZ = s.vz;
  }

  /** On the ring for good (locally detected, or a teammate's fact). */
  deliver() {
    this.delivered = true;
    this.x = this.netX = CIRCUS_RING.x;
    this.z = this.netZ = CIRCUS_RING.z;
    this.vx = this.vz = this.netVX = this.netVZ = 0;
  }

  update(delta: number, ctx: TownBallContext) {
    const dt = Math.min(delta, 0.1);
    if (this.delivered) {
      this.place(dt);
      return;
    }
    this.kickCooldown -= dt;

    // Kick: run into the ball (same feel as the lobby's).
    const dx = this.x - ctx.px, dz = this.z - ctx.pz;
    const dist = Math.hypot(dx, dz);
    if (ctx.canKick && dist < CIRCUS_BALL_RADIUS + 0.65 && this.kickCooldown <= 0) {
      const pSpeed = Math.hypot(ctx.pvx, ctx.pvz);
      let dirX = dist > 0.001 ? dx / dist : 1, dirZ = dist > 0.001 ? dz / dist : 0;
      if (pSpeed > 0.4) {
        dirX = dirX * 0.35 + (ctx.pvx / pSpeed) * 0.65;
        dirZ = dirZ * 0.35 + (ctx.pvz / pSpeed) * 0.65;
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX /= l; dirZ /= l;
      }
      const speed = Math.min(12, Math.max(3, pSpeed * 1.8 + 2));
      const kvx = dirX * speed, kvz = dirZ * speed;
      // Push it clear of the player so one touch is one kick (unless a wall is there).
      const nx = ctx.px + dirX * (CIRCUS_BALL_RADIUS + 0.7), nz = ctx.pz + dirZ * (CIRCUS_BALL_RADIUS + 0.7);
      if (!ctx.collide(nx, nz, CIRCUS_BALL_RADIUS)) { this.x = nx; this.z = nz; }
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
    this.place(dt);
  }

  private simulate(dt: number, ctx: TownBallContext) {
    // Downhill pull from the local slope.
    const e = 0.4;
    const gx = (this.groundAt(this.x + e, this.z) - this.groundAt(this.x - e, this.z)) / (2 * e);
    const gz = (this.groundAt(this.x, this.z + e) - this.groundAt(this.x, this.z - e)) / (2 * e);
    const ax = -SLOPE_PULL * gx, az = -SLOPE_PULL * gz;
    const resting = Math.hypot(this.vx, this.vz) < 0.08;
    if (!resting || Math.hypot(ax, az) > STATIC_PULL) {
      this.vx += ax * dt;
      this.vz += az * dt;
    }
    const decay = Math.exp(-FRICTION * dt);
    this.vx *= decay; this.vz *= decay;
    if (Math.hypot(this.vx, this.vz) < 0.05 && Math.hypot(ax, az) <= STATIC_PULL) { this.vx = 0; this.vz = 0; }

    // Move one axis at a time, bouncing off whatever stops the player too.
    const nx = this.x + this.vx * dt;
    if (ctx.collide(nx, this.z, CIRCUS_BALL_RADIUS)) this.vx = -this.vx * RESTITUTION;
    else this.x = nx;
    const nz = this.z + this.vz * dt;
    if (ctx.collide(this.x, nz, CIRCUS_BALL_RADIUS)) this.vz = -this.vz * RESTITUTION;
    else this.z = nz;

    // The ring: a slow enough ball dropping onto it stays.
    if (Math.hypot(this.x - CIRCUS_RING.x, this.z - CIRCUS_RING.z) < CIRCUS_RING.radius - 0.35 && Math.hypot(this.vx, this.vz) < 7) {
      this.deliver();
      ctx.onDelivered();
      return;
    }

    // Rolled all the way back into town (or somewhere it shouldn't be): back to the valley.
    const cell = townCellAt(Math.floor(this.x / TOWN_CELL), Math.floor(this.z / TOWN_CELL));
    if (!cell || cell.zone === "town") {
      this.lostTimer += dt;
      if (this.lostTimer >= LOST_DELAY) {
        this.lostTimer = 0;
        this.x = CIRCUS_BALL_START.x; this.z = CIRCUS_BALL_START.z;
        this.vx = this.vz = 0;
        ctx.onLost();
      }
    } else {
      this.lostTimer = 0;
    }
  }

  private groundAt(x: number, z: number): number {
    return circusBallGround(x, z, this.ground);
  }

  /** Puts the mesh on the ground and rolls it by the distance travelled. */
  private place(dt: number) {
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.02 && dt > 0) {
      this.mesh.rotateOnWorldAxis(rollAxis.set(this.vz, 0, -this.vx).normalize(), (sp * dt) / CIRCUS_BALL_RADIUS);
    }
    this.mesh.position.set(this.x, this.groundAt(this.x, this.z) + CIRCUS_BALL_RADIUS, this.z);
  }
}
