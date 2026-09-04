/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

/**
 * A light the world *wants* to have. It carries no GPU resources: the pool
 * decides which of these get a real THREE.PointLight bound to them.
 */
export interface DynamicLightSource {
  x: number;
  y: number;
  z: number;
  color: number;
  /** Configured (maximum) intensity. */
  baseIntensity: number;
  /** Live intensity, modulated by flicker/blackout logic. */
  intensity: number;
  distance: number;
  decay: number;
  gridX: number;
  gridZ: number;
}

/**
 * Fixed-size pool of THREE.PointLight instances shared by the whole level.
 *
 * Three.js forward rendering evaluates every visible light for every fragment,
 * and the *number* of visible lights is part of the shader program cache key.
 * A map that streams hundreds of lamps in and out of view therefore pays twice:
 * a per-pixel cost that grows with the lamp count, plus a shader recompilation
 * every time that count changes (the classic "turning the camera stutters" bug).
 *
 * This pool fixes both. It allocates exactly `size` lights once, keeps all of
 * them permanently in the scene so the light count never changes, and rebinds
 * them to the nearest wanted sources as the player moves. Lights with nothing
 * to bind stay at zero intensity instead of being removed.
 */
export class LightPool {
  private lights: THREE.PointLight[] = [];
  private boundSources: (DynamicLightSource | null)[] = [];
  private scene: THREE.Scene;
  private maxRange: number;

  // Scratch buffers for the nearest-K selection, reused every rebind.
  private candidateSources: (DynamicLightSource | null)[] = [];
  private candidateDistances: number[] = [];

  private rebindTimer = 0;
  private readonly rebindInterval = 0.1; // 10 Hz is imperceptible and ~6x cheaper

  constructor(scene: THREE.Scene, size: number, maxRange: number) {
    this.scene = scene;
    this.maxRange = maxRange;

    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 1.0);
      light.castShadow = false;
      // Parked far below the level so an unbound light never touches geometry.
      light.position.set(0, -1000, 0);
      light.visible = true; // never toggled: keeps the shader variant stable
      this.scene.add(light);
      this.lights.push(light);
      this.boundSources.push(null);
      this.candidateSources.push(null);
      this.candidateDistances.push(Infinity);
    }
  }

  public get size(): number {
    return this.lights.length;
  }

  /**
   * @param sources every light the level wants, in any order
   * @param playerX/playerZ listener position used to rank the sources
   * @param delta frame time in seconds
   */
  public update(sources: DynamicLightSource[], playerX: number, playerZ: number, delta: number) {
    if (this.lights.length === 0) return;

    this.rebindTimer -= delta;
    if (this.rebindTimer <= 0) {
      this.rebindTimer = this.rebindInterval;
      this.rebind(sources, playerX, playerZ);
    }

    // Every frame: refresh only the handful of bound lights so flicker,
    // blackouts and colour changes stay perfectly responsive.
    for (let i = 0; i < this.lights.length; i++) {
      const src = this.boundSources[i];
      const light = this.lights[i];
      if (!src) {
        light.intensity = 0;
        continue;
      }
      light.intensity = src.intensity;
    }
  }

  /** Selects the nearest `size` sources with a non-zero intensity. */
  private rebind(sources: DynamicLightSource[], playerX: number, playerZ: number) {
    const k = this.lights.length;
    const maxRangeSq = this.maxRange * this.maxRange;

    for (let i = 0; i < k; i++) {
      this.candidateSources[i] = null;
      this.candidateDistances[i] = Infinity;
    }

    // Partial insertion sort: O(n·k) with a tiny k beats a full sort of n.
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s];
      if (src.intensity <= 0.001) continue;

      const dx = src.x - playerX;
      const dz = src.z - playerZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > maxRangeSq) continue;
      if (distSq >= this.candidateDistances[k - 1]) continue;

      let slot = k - 1;
      while (slot > 0 && this.candidateDistances[slot - 1] > distSq) {
        this.candidateDistances[slot] = this.candidateDistances[slot - 1];
        this.candidateSources[slot] = this.candidateSources[slot - 1];
        slot--;
      }
      this.candidateDistances[slot] = distSq;
      this.candidateSources[slot] = src;
    }

    for (let i = 0; i < k; i++) {
      const src = this.candidateSources[i];
      const light = this.lights[i];
      this.boundSources[i] = src;

      if (!src) {
        light.intensity = 0;
        light.position.set(0, -1000, 0);
        continue;
      }

      light.position.set(src.x, src.y, src.z);
      light.color.setHex(src.color);
      light.distance = src.distance;
      light.decay = src.decay;
      light.intensity = src.intensity;
    }
  }

  /** Forces a rebind on the next update (used after teleports/level loads). */
  public invalidate() {
    this.rebindTimer = 0;
  }

  public dispose() {
    this.lights.forEach((light) => {
      this.scene.remove(light);
      light.dispose();
    });
    this.lights = [];
    this.boundSources = [];
    this.candidateSources = [];
    this.candidateDistances = [];
  }
}
