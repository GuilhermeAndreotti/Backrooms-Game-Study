/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Poolrooms' water: sunken tiled pools with caustics, a surface that
 * moves, and the disturbance whoever is in it leaves behind. Everything here
 * is visual and local — the waves are a function of world position and a
 * shared clock, so neighbouring cells' surfaces line up without per-cell state.
 *
 * The surface is shaded per fragment, not per vertex: a few slow swells, plus
 * up to RIPPLE_SLOTS travelling rings (footsteps, strokes, a body dropping in)
 * fed from WaterRipples through one shared uniform array. Its transparency
 * follows the Fresnel term — clear looking down, a mirror of the haze at a
 * grazing angle — and from below it shows Snell's window: a bright disc
 * straight up, a dark, total reflection everywhere else.
 */

import * as THREE from "three";
import { weatherCanvas } from "./surfaceTextures";

/** Pool floor height relative to the dry floor around it (m). */
export const POOL_FLOOR_Y = -0.55;
/** Resting water surface height (m) — below the dry floor, so leaving the pool is a step up. */
export const WATER_SURFACE_Y = -0.12;

/** Travelling rings the water shader evaluates at once (oldest are overwritten). */
const RIPPLE_SLOTS = 16;

/**
 * Shared uniforms for every water/caustic shader; GameEngine advances the
 * clock, WaterRipples writes the rings, PoolDirector tints the reflection.
 */
export const waterUniforms = {
  uTime: { value: 0 },
  /** x, z, start time, strength (0 = empty slot). */
  uRipples: { value: Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, -100, 0)) },
  /** What a grazing look at the surface reflects: the haze above it. */
  uReflect: { value: new THREE.Color(0xbfd6cf) },
};

export type WaterKind = "clear" | "toxic" | "shallow" | "deep";

const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uRipples[${RIPPLE_SLOTS}];
// Slow, low swells: still water that is never quite still.
float swell(vec2 p) {
  return sin(p.x * 0.9 + uTime * 0.55) * 0.012
       + sin(p.y * 1.3 - uTime * 0.42) * 0.010
       + sin((p.x + p.y) * 2.3 + uTime * 0.9) * 0.004
       + sin((p.x - p.y) * 3.7 - uTime * 1.3) * 0.002;
}
// Rings travelling out from a disturbance, damped with age and distance.
float rings(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 3.2) continue;
    float d = distance(p, r.xy);
    float front = age * 1.15;
    float x = d - front;
    float envelope = exp(-x * x * 9.0) * exp(-age * 1.35) / (1.0 + d * 1.8);
    h += sin(x * 15.0) * envelope * r.w * 0.028;
  }
  return h;
}
float waterHeight(vec2 p) { return swell(p) + rings(p); }
`;

const CAUSTIC_GLSL = /* glsl */ `
uniform float uTime;
varying vec3 vWaterWorld;
float caustic(vec2 p) {
  float a = sin(p.x * 2.1 + uTime * 0.9 + sin(p.y * 1.3 + uTime * 0.6) * 1.5);
  float b = sin(p.y * 2.4 - uTime * 0.7 + sin(p.x * 1.7 - uTime * 0.5) * 1.5);
  return pow(clamp(1.0 - abs(a + b) * 0.5, 0.0, 1.0), 6.0);
}
`;

const WATER_LOOK: Record<WaterKind, { color: number; emissive: number; emissiveIntensity: number; clarity: number; deep: string }> = {
  // Part 1's tiled pools: the classic bright, clear cyan.
  clear: { color: 0x3fc9a2, emissive: 0x1f8f74, emissiveIntensity: 0.32, clarity: 0.42, deep: "0.03, 0.16, 0.15" },
  toxic: { color: 0x3d6a1c, emissive: 0x2c5a10, emissiveIntensity: 0.3, clarity: 0.78, deep: "0.05, 0.10, 0.02" },
  // Part 2's hall: old, ankle-deep and murky green.
  shallow: { color: 0x3b8f7a, emissive: 0x123f36, emissiveIntensity: 0.16, clarity: 0.5, deep: "0.02, 0.08, 0.07" },
  // Part 3: dark, deep water you can't see the bottom of.
  deep: { color: 0x1d5a66, emissive: 0x06262c, emissiveIntensity: 0.14, clarity: 0.66, deep: "0.008, 0.04, 0.05" },
};

/** Transparent water whose surface swells and ripples; see the file comment. */
export function createWaterMaterial(kind: WaterKind | boolean): THREE.MeshStandardMaterial {
  const k: WaterKind = kind === true ? "toxic" : kind === false ? "clear" : kind;
  const look = WATER_LOOK[k];
  const mat = new THREE.MeshStandardMaterial({
    color: look.color,
    emissive: look.emissive,
    emissiveIntensity: look.emissiveIntensity,
    roughness: 0.06,
    metalness: 0.15,
    transparent: true,
    opacity: look.clarity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uRipples = waterUniforms.uRipples;
    shader.uniforms.uReflect = waterUniforms.uReflect;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WAVE_GLSL}\nvarying vec3 vWaterWorld;`)
      .replace("#include <begin_vertex>", `
        vec3 transformed = vec3(position);
        vec4 wp0 = modelMatrix * vec4(position, 1.0);
        transformed.y += waterHeight(wp0.xz);
        vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${WAVE_GLSL}\nuniform vec3 uReflect;\nvarying vec3 vWaterWorld;`)
      // Per-fragment normal from the height field: the rings are finer than the mesh.
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
        float wh = waterHeight(vWaterWorld.xz);
        vec3 nW = normalize(vec3(
          -(waterHeight(vWaterWorld.xz + vec2(0.04, 0.0)) - wh) / 0.04,
          1.0,
          -(waterHeight(vWaterWorld.xz + vec2(0.0, 0.04)) - wh) / 0.04));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz) * faceDirection;`)
      .replace("#include <opaque_fragment>", `
        vec3 viewDir = normalize(vViewPosition);
        float cosV = clamp(abs(dot(normal, viewDir)), 0.0, 1.0);
        if (gl_FrontFacing) {
          // From above: Fresnel. Clear straight down, the haze mirrored at a grazing angle.
          float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
          outgoingLight = mix(outgoingLight, uReflect * 0.55 + outgoingLight * 0.3, fres);
          diffuseColor.a = mix(diffuseColor.a, 0.96, fres);
        } else {
          // From below: Snell's window. A bright disc overhead, dark total reflection outside it.
          float window = smoothstep(0.58, 0.74, cosV);
          outgoingLight = mix(vec3(${look.deep}), outgoingLight * 1.35 + uReflect * 0.25, window);
          diffuseColor.a = mix(0.93, 0.32, window);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `pool-water-v2-${k}`;
  return mat;
}

let tileTexture: THREE.CanvasTexture | null = null;

/** Small pale pool tiles with dark grout (one texture shared by every pool surface). */
function poolTileTexture(): THREE.CanvasTexture {
  if (tileTexture) return tileTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#6f8f93";
    ctx.fillRect(0, 0, 128, 128);
    const tile = 32;
    for (let y = 0; y < 128; y += tile) {
      for (let x = 0; x < 128; x += tile) {
        const shade = 205 + ((x * 7 + y * 13) % 5) * 6;
        ctx.fillStyle = `rgb(${shade - 20}, ${shade}, ${shade + 4})`;
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      }
    }
    weatherCanvas(ctx, { grain: 0.035, blotch: 0.06, seed: 41 });
  }
  tileTexture = new THREE.CanvasTexture(canvas);
  tileTexture.wrapS = tileTexture.wrapT = THREE.RepeatWrapping;
  tileTexture.colorSpace = THREE.SRGBColorSpace;
  return tileTexture;
}

/**
 * Tiled pool floor/wall, with light caustics dancing across it — strongest
 * just under the surface and fading with depth. `repeat` is the tile texture
 * repeat for a 4 m surface (the pool floor); the walls use their own UVs.
 * `tint` darkens the tiles for the Poolrooms' older, unlit parts.
 */
export function createPoolTileMaterial(toxic: boolean, tint?: number): THREE.MeshStandardMaterial {
  const map = poolTileTexture().clone();
  map.needsUpdate = true;
  map.repeat.set(4, 4);
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: tint ?? (toxic ? 0x9fbf7a : 0xbfeedb),
    roughness: 0.35,
    metalness: 0.05,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CAUSTIC_GLSL}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        // Only underwater surfaces catch caustics, and less of them the deeper they are.
        float below = ${WATER_SURFACE_Y.toFixed(2)} - vWaterWorld.y;
        float under = smoothstep(-0.02, 0.08, below) * exp(-max(below, 0.0) * 0.32);
        totalEmissiveRadiance += vec3(${toxic ? "0.10, 0.16, 0.04" : "0.10, 0.20, 0.22"}) * caustic(vWaterWorld.xz) * under;`);
  };
  mat.customProgramCacheKey = () => `pool-tile-v2-${toxic ? "toxic" : "clear"}`;
  return mat;
}

// ---------------------------------------------------------------------------
// Ripples and splashes
// ---------------------------------------------------------------------------

const MAX_RIPPLES = 40;
const MAX_DROPS = 160;

interface Ripple { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; size: number }
interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; floor: number }

/**
 * Disturbances of the water wherever a player or monster moves through it:
 * travelling rings in the surface shader (see waterUniforms.uRipples), a faint
 * foam ring on top so they read in the dark, droplets thrown up by a run or a
 * fall, and bubbles rising from a diver. Pooled; nothing allocates per step.
 */
export class WaterRipples {
  private ripples: Ripple[] = [];
  private next = 0;
  private nextSlot = 0;
  private drops: Drop[] = [];
  private dropPoints: THREE.Points;
  private dropPositions: Float32Array;
  private bubbles: Drop[] = [];
  private bubblePoints: THREE.Points;
  private bubblePositions: Float32Array;
  private ringGeo = new THREE.RingGeometry(0.86, 1, 40);

  constructor(private scene: THREE.Scene) {
    this.ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xd9f3f7, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.ripples.push({ mesh, mat, age: 0, life: 1, size: 1 });
    }
    this.dropPositions = new Float32Array(MAX_DROPS * 3);
    this.dropPoints = this.points(this.dropPositions, 0xe6fbff, 0.045, 0.85);
    this.bubblePositions = new Float32Array(MAX_DROPS * 3);
    this.bubblePoints = this.points(this.bubblePositions, 0xcff6ff, 0.06, 0.6);
    // The rings are global uniform state: a new level starts calm.
    for (const r of waterUniforms.uRipples.value) r.set(0, 0, -100, 0);
  }

  private points(positions: Float32Array, color: number, size: number, opacity: number): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  /**
   * A disturbance at the water surface `y`; `strength` 0..1.5. A walk is
   * ~0.5, a run ~1, a body falling in 1.5. `splash` throws droplets.
   */
  spawn(x: number, z: number, strength = 1, splash = false, y = WATER_SURFACE_Y) {
    const slot = waterUniforms.uRipples.value[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % RIPPLE_SLOTS;
    slot.set(x, z, waterUniforms.uTime.value, Math.min(1.5, strength));

    const r = this.ripples[this.next];
    this.next = (this.next + 1) % MAX_RIPPLES;
    r.age = 0;
    r.life = 0.9 + strength * 0.7;
    r.size = 0.4 + strength * 1.1;
    r.mesh.position.set(x, y + 0.02, z);
    r.mesh.visible = true;
    if (splash) {
      const n = Math.round(6 + strength * 6);
      for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 0.4 + Math.random() * strength;
        this.drops.push({ x, y: y + 0.05, z, vx: Math.cos(a) * s, vy: 1.2 + Math.random() * 1.4 * strength, vz: Math.sin(a) * s, life: 1, floor: y });
      }
    }
  }

  /** Bubbles rising from (x, y, z) toward the surface at `surface`. */
  bubble(x: number, y: number, z: number, surface: number, count = 3) {
    for (let i = 0; i < count && this.bubbles.length < MAX_DROPS; i++) {
      this.bubbles.push({
        x: x + (Math.random() - 0.5) * 0.25, y: y + Math.random() * 0.1, z: z + (Math.random() - 0.5) * 0.25,
        vx: (Math.random() - 0.5) * 0.15, vy: 0.5 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.15, life: 6, floor: surface,
      });
    }
  }

  update(delta: number) {
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += delta;
      const t = r.age / r.life;
      if (t >= 1) { r.mesh.visible = false; continue; }
      const s = 0.15 + r.size * Math.sqrt(t);
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = 0.16 * (1 - t) * (1 - t);
    }

    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy -= 9.8 * delta;
      d.x += d.vx * delta; d.y += d.vy * delta; d.z += d.vz * delta;
      d.life -= delta;
      if (d.y < d.floor || d.life <= 0) this.drops.splice(i, 1);
    }
    for (const d of this.drops) {
      this.dropPositions[n * 3] = d.x; this.dropPositions[n * 3 + 1] = d.y; this.dropPositions[n * 3 + 2] = d.z;
      n++;
    }
    this.flush(this.dropPoints, n);

    n = 0;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.vy = Math.min(1.1, b.vy + delta * 0.6);
      b.x += (b.vx + Math.sin(b.life * 7 + i) * 0.08) * delta; b.y += b.vy * delta; b.z += b.vz * delta;
      b.life -= delta;
      if (b.y >= b.floor - 0.02) {
        // Breaking the surface leaves the faintest ring: how a diver gives themselves away.
        this.spawn(b.x, b.z, 0.12, false, b.floor);
        this.bubbles.splice(i, 1);
      } else if (b.life <= 0) {
        this.bubbles.splice(i, 1);
      }
    }
    for (const b of this.bubbles) {
      this.bubblePositions[n * 3] = b.x; this.bubblePositions[n * 3 + 1] = b.y; this.bubblePositions[n * 3 + 2] = b.z;
      n++;
    }
    this.flush(this.bubblePoints, n);
  }

  private flush(points: THREE.Points, n: number) {
    points.geometry.setDrawRange(0, n);
    (points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    for (const r of this.ripples) { this.scene.remove(r.mesh); r.mat.dispose(); }
    this.ringGeo.dispose();
    for (const pts of [this.dropPoints, this.bubblePoints]) {
      this.scene.remove(pts);
      pts.geometry.dispose();
      (pts.material as THREE.Material).dispose();
    }
  }
}

let wallTileTexture: THREE.CanvasTexture | null = null;

/**
 * Cream-white 25 cm wall/ceiling tiles with thin dark grout — the Poolrooms'
 * walls and pillars. `glow` is how much the tiles seem to give off light of
 * their own (Part 1's bright halls); the deeper parts keep their walls dark.
 */
export function createWallTileMaterial(glow = 0.5, tint = 0xffffff): THREE.MeshStandardMaterial {
  if (!wallTileTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#5f6a5c";
      ctx.fillRect(0, 0, 128, 128);
      const tile = 32;
      for (let y = 0; y < 128; y += tile) {
        for (let x = 0; x < 128; x += tile) {
          const shade = 236 + ((x * 7 + y * 13) % 4) * 4;
          ctx.fillStyle = `rgb(${shade}, ${shade - 2}, ${shade - 20})`;
          ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
        }
      }
      weatherCanvas(ctx, { grain: 0.03, blotch: 0.05, seed: 43 });
    }
    wallTileTexture = new THREE.CanvasTexture(canvas);
    wallTileTexture.wrapS = wallTileTexture.wrapT = THREE.RepeatWrapping;
    wallTileTexture.colorSpace = THREE.SRGBColorSpace;
    wallTileTexture.repeat.set(4, 4);
  }
  return new THREE.MeshStandardMaterial({ map: wallTileTexture, color: tint, emissive: 0x3a3a30, emissiveIntensity: glow, roughness: 0.4, metalness: 0.0 });
}
