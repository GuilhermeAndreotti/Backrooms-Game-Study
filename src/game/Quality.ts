/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Central performance/quality profile for the whole engine.
 *
 * Every heavy subsystem (render resolution, VHS post-processing, shadows,
 * dynamic light budget, particle counts) reads its budget from here instead of
 * hardcoding values, so a single preset switch reconfigures the entire renderer.
 */
export type QualityLevel = "low" | "medium" | "high";

export interface QualityProfile {
  /**
   * Fraction of the CSS viewport the 3D scene is rendered at, before the VHS
   * pass upscales it. Deliberately independent of devicePixelRatio: the cost of
   * the scene should not quadruple just because the display is HiDPI.
   */
  renderScale: number;
  /** Hard cap for window.devicePixelRatio, applied to the final VHS pass only. */
  maxPixelRatio: number;
  /** Number of concurrently active THREE.PointLight instances in the pool. */
  lightBudget: number;
  /** Radius (meters) beyond which a registered light is never bound. */
  lightRange: number;
  /** Particles in the global drifting dust cloud. */
  dustParticles: number;
  /** Particles per fluorescent-fixture dust cloud (0 disables them). */
  fixtureDustParticles: number;
  /** Cell load/unload radius in meters. */
  viewDistance: number;
  /** Enable real-time shadow mapping for the flashlight. */
  shadows: boolean;
  /** Flashlight shadow map resolution. */
  shadowMapSize: number;
  /** Enable the VHS post-processing pass. */
  vhs: boolean;
  /** Target radar redraws per second. */
  radarFps: number;
}

const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    renderScale: 0.4,
    maxPixelRatio: 1,
    lightBudget: 4,
    lightRange: 14,
    dustParticles: 60,
    fixtureDustParticles: 0,
    viewDistance: 16,
    shadows: false,
    shadowMapSize: 256,
    vhs: true,
    radarFps: 12,
  },
  medium: {
    renderScale: 0.55,
    maxPixelRatio: 1.5,
    lightBudget: 6,
    lightRange: 18,
    dustParticles: 120,
    fixtureDustParticles: 8,
    viewDistance: 20,
    shadows: true,
    shadowMapSize: 512,
    vhs: true,
    radarFps: 20,
  },
  high: {
    renderScale: 0.8,
    maxPixelRatio: 2,
    lightBudget: 8,
    lightRange: 24,
    dustParticles: 200,
    fixtureDustParticles: 14,
    viewDistance: 24,
    shadows: true,
    shadowMapSize: 1024,
    vhs: true,
    radarFps: 30,
  },
};

export function getQualityProfile(level: QualityLevel): QualityProfile {
  return PROFILES[level] ?? PROFILES.medium;
}

/**
 * Best-effort hardware guess used only as the *initial* preset. The adaptive
 * resolution controller refines the actual cost at runtime.
 */
export function detectQualityLevel(): QualityLevel {
  if (typeof navigator === "undefined") return "medium";

  const ua = navigator.userAgent || "";
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;

  if (isMobile || cores <= 2 || memory <= 2) return "low";
  if (cores <= 4 || memory <= 4) return "medium";
  return "high";
}

/**
 * Keeps a smoothed frame-time average and recommends a resolution multiplier so
 * the game trades pixels (not gameplay) for a stable frame rate.
 *
 * Scaling only moves one step per cooldown window and has a dead zone between
 * the up/down thresholds, which prevents the oscillation ("resolution pumping")
 * that naive adaptive scalers suffer from.
 */
export class AdaptiveResolution {
  private smoothedFrameMs = 16.6;
  private cooldown = 0;
  private scale = 1;

  private readonly minScale: number;
  private readonly targetMs: number;
  /** Drop resolution above this frame time (~52 FPS). */
  private readonly downThresholdMs: number;
  /** Restore resolution below this frame time (~72 FPS). */
  private readonly upThresholdMs: number;

  constructor(targetFps = 60, minScale = 0.5) {
    this.targetMs = 1000 / targetFps;
    this.downThresholdMs = this.targetMs * 1.15;
    this.upThresholdMs = this.targetMs * 0.85;
    this.minScale = minScale;
  }

  /** Returns the new scale when it changed this frame, otherwise null. */
  public update(deltaSeconds: number): number | null {
    const frameMs = Math.min(deltaSeconds * 1000, 200);
    // Exponential moving average (~1s window at 60fps).
    this.smoothedFrameMs += (frameMs - this.smoothedFrameMs) * 0.05;

    this.cooldown -= deltaSeconds;
    if (this.cooldown > 0) return null;

    if (this.smoothedFrameMs > this.downThresholdMs && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale - 0.1);
      this.cooldown = 1.5;
      return this.scale;
    }

    if (this.smoothedFrameMs < this.upThresholdMs && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.cooldown = 3.0;
      return this.scale;
    }

    return null;
  }

  public get currentScale(): number {
    return this.scale;
  }

  public get fps(): number {
    return this.smoothedFrameMs > 0 ? 1000 / this.smoothedFrameMs : 0;
  }

  public reset() {
    this.smoothedFrameMs = 16.6;
    this.cooldown = 0;
    this.scale = 1;
  }
}
