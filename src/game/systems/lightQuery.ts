/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spatial "is this point lit" queries for A Sombra, built on top of
 * ProceduralMap.dynamicLights — the full per-level wishlist of light
 * sources (not ProceduralMap.activeLightFixtures, which is narrowed to
 * whatever's currently inside the *rendering* streaming radius; a
 * gameplay decision like "is the Shadow allowed to stand here" must not
 * depend on where the local camera happens to be pointed).
 *
 * No such per-point query existed before this: darkness was previously
 * only a level-wide concept (flashlight on/off + ProceduralMap's
 * globalEventState), never spatial.
 */

import { ProceduralMap } from "../ProceduralMap";

/** Below this, a light source counts as effectively off (dead bulb, blackout). */
const OFF_INTENSITY = 0.05;

/**
 * Distance (metres) to the nearest currently-lit source that actually
 * reaches (x, z), or Infinity if none does. A source's configured
 * `distance` is its falloff cutoff (as for a THREE.PointLight): beyond
 * that radius it contributes nothing, regardless of how bright it is at
 * its origin.
 */
export function nearestActiveLightDistance(map: ProceduralMap, x: number, z: number): number {
  let best = Infinity;
  for (const src of map.dynamicLights) {
    if (src.intensity < OFF_INTENSITY) continue;
    const dx = src.x - x, dz = src.z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > src.distance) continue;
    if (d < best) best = d;
  }
  return best;
}

/** Whether (x, z) currently sits inside at least one lit source's reach. */
export function isPointLit(map: ProceduralMap, x: number, z: number): boolean {
  return nearestActiveLightDistance(map, x, z) < Infinity;
}
