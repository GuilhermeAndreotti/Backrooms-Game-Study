/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A short-lived, authority-local record of "something made noise here"
 * events (footsteps, prop shoves, ...) for sound-reactive mobs (O Eco) to
 * poll. Not replicated — like Finger King's aggression ramp, this only
 * needs to exist wherever the AI actually runs (the level's world
 * authority; see CLAUDE.md's per-level authority-election section).
 *
 * Deliberately no wall occlusion: every distance check here is straight-line
 * Euclidean, matching the existing precedent this codebase already uses for
 * water-drip and light-buzz audio falloff (see ProceduralMap.ts's
 * onWaterDrip callback and updateLights' flicker-buzz gating).
 */

export type NoiseSource = "footstep" | "prop";

export interface NoiseEvent {
  x: number;
  z: number;
  /** 0..1: how far-reaching this sound is. See footstepLoudness() for the footstep scale. */
  loudness: number;
  source: NoiseSource;
  /** Seconds on the engine's running clock (GameEngine.totalPlayTime), for age-based pruning. */
  atS: number;
}

export class NoiseBus {
  private events: NoiseEvent[] = [];
  /** Events older than this are forgotten — roughly how long a sound "lingers" perceptually. */
  private static readonly MAX_AGE_S = 4.0;

  emit(x: number, z: number, loudness: number, source: NoiseSource, atS: number) {
    this.events.push({ x, z, loudness, source, atS });
  }

  /** Drops events older than MAX_AGE_S. Call once per frame (authority only) before querying. */
  prune(nowS: number) {
    if (this.events.length === 0) return;
    const cutoff = nowS - NoiseBus.MAX_AGE_S;
    this.events = this.events.filter((e) => e.atS >= cutoff);
  }

  /** Every live event within `radius` metres of (x, z), loudest first. */
  near(x: number, z: number, radius: number): NoiseEvent[] {
    const r2 = radius * radius;
    return this.events
      .filter((e) => {
        const dx = e.x - x, dz = e.z - z;
        return dx * dx + dz * dz <= r2;
      })
      .sort((a, b) => b.loudness - a.loudness);
  }

  clear() {
    this.events = [];
  }
}

/** How far-reaching (0..1) a footstep at this movement speed is. Mirrors PlayerController's own step-cadence scale (run fastest/loudest, crouch slowest/quietest). */
export function footstepLoudness(speed: "walk" | "run" | "crouch"): number {
  switch (speed) {
    case "run": return 1.0;
    case "walk": return 0.5;
    case "crouch": return 0.08;
  }
}
