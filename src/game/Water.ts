/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Poolrooms' flooded cells: a sunken tiled pool floor with animated
 * caustics, a gently moving water surface, and the ripples/splashes left by
 * whoever wades through it. Everything here is visual and local — the waves
 * are a function of world position and a shared clock, so neighbouring
 * cells' surfaces line up without any per-cell state.
 */

import * as THREE from "three";

/** Pool floor height relative to the dry floor around it (m). */
export const POOL_FLOOR_Y = -0.55;
/** Resting water surface height (m) — below the dry floor, so leaving the pool is a step up. */
export const WATER_SURFACE_Y = -0.12;

/** Shared clock for every water/caustic shader; GameEngine advances it each frame. */
export const waterUniforms = { uTime: { value: 0 } };

const WAVE_GLSL = /* glsl */ `
uniform float uTime;
float waterWave(vec2 p) {
  return sin(p.x * 1.3 + uTime * 1.1) * 0.022
       + sin(p.y * 1.7 - uTime * 0.9) * 0.018
       + sin((p.x + p.y) * 2.9 + uTime * 1.7) * 0.009
       + sin((p.x - p.y) * 4.3 - uTime * 2.3) * 0.004;
}
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

/** Transparent, slightly reflective water whose surface waves in the vertex shader. */
export function createWaterMaterial(toxic: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: toxic ? 0x3d6a1c : 0x3fc9a2,
    emissive: toxic ? 0x2c5a10 : 0x1f8f74,
    emissiveIntensity: toxic ? 0.35 : 0.6,
    roughness: 0.045,
    metalness: 0.22,
    transparent: true,
    opacity: toxic ? 0.85 : 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WAVE_GLSL}\nvarying vec3 vWaterWorld;`)
      // The surface normal follows the wave slope, so highlights ripple too.
      .replace("#include <beginnormal_vertex>", `
        vec4 wp0 = modelMatrix * vec4(position, 1.0);
        float wh = waterWave(wp0.xz);
        vec3 objectNormal = normalize(vec3(
          -(waterWave(wp0.xz + vec2(0.05, 0.0)) - wh) / 0.05,
          1.0,
          -(waterWave(wp0.xz + vec2(0.0, 0.05)) - wh) / 0.05));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace("#include <begin_vertex>", `
        vec3 transformed = vec3(position);
        transformed.y += wh;
        vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying vec3 vWaterWorld;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float glint = pow(max(0.0, sin(vWaterWorld.x * 3.1 + uTime * 1.3) * sin(vWaterWorld.z * 2.7 - uTime * 1.1)), 8.0);
        totalEmissiveRadiance += vec3(0.10, 0.22, 0.25) * glint;`);
  };
  mat.customProgramCacheKey = () => `pool-water-${toxic ? "toxic" : "clear"}`;
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
  }
  tileTexture = new THREE.CanvasTexture(canvas);
  tileTexture.wrapS = tileTexture.wrapT = THREE.RepeatWrapping;
  tileTexture.colorSpace = THREE.SRGBColorSpace;
  return tileTexture;
}

/**
 * Tiled pool floor/wall, with light caustics dancing across it. `repeat` is
 * the tile texture repeat for a 4 m surface (the pool floor); the walls use
 * their own geometry UVs.
 */
export function createPoolTileMaterial(toxic: boolean): THREE.MeshStandardMaterial {
  const map = poolTileTexture().clone();
  map.needsUpdate = true;
  map.repeat.set(4, 4);
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: toxic ? 0x9fbf7a : 0xbfeedb,
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
        // Only underwater surfaces catch caustics.
        float under = 1.0 - smoothstep(${(WATER_SURFACE_Y - 0.08).toFixed(2)}, ${(WATER_SURFACE_Y + 0.02).toFixed(2)}, vWaterWorld.y);
        totalEmissiveRadiance += vec3(${toxic ? "0.10, 0.16, 0.04" : "0.10, 0.20, 0.22"}) * caustic(vWaterWorld.xz) * under;`);
  };
  mat.customProgramCacheKey = () => `pool-tile-${toxic ? "toxic" : "clear"}`;
  return mat;
}

// ---------------------------------------------------------------------------
// Ripples and splashes
// ---------------------------------------------------------------------------

const MAX_RIPPLES = 48;
const MAX_DROPS = 160;

interface Ripple { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; size: number }
interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }

/**
 * Expanding rings on the water surface wherever a player or monster steps,
 * plus a few droplets thrown up by running. Pooled; nothing allocates per step.
 */
export class WaterRipples {
  private ripples: Ripple[] = [];
  private next = 0;
  private drops: Drop[] = [];
  private dropPoints: THREE.Points;
  private dropPositions: Float32Array;
  private ringGeo = new THREE.RingGeometry(0.82, 1, 40);

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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.dropPositions, 3));
    geo.setDrawRange(0, 0);
    this.dropPoints = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe6fbff, size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
    this.dropPoints.frustumCulled = false;
    scene.add(this.dropPoints);
  }

  /** A ring (or two, for a hard step) at the water surface; `strength` 0..1.5. */
  spawn(x: number, z: number, strength = 1, splash = false) {
    const count = strength > 1 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const r = this.ripples[this.next];
      this.next = (this.next + 1) % MAX_RIPPLES;
      r.age = -k * 0.12;
      r.life = 1.1 + strength * 0.6;
      r.size = 0.5 + strength * 0.9;
      r.mesh.position.set(x + (Math.random() - 0.5) * 0.15, WATER_SURFACE_Y + 0.03, z + (Math.random() - 0.5) * 0.15);
      r.mesh.visible = true;
    }
    if (splash) {
      for (let i = 0; i < 10 && this.drops.length < MAX_DROPS; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 0.6 + Math.random() * 1.2;
        this.drops.push({ x, y: WATER_SURFACE_Y + 0.05, z, vx: Math.cos(a) * s, vy: 1.6 + Math.random() * 1.6, vz: Math.sin(a) * s, life: 1 });
      }
    }
  }

  update(delta: number) {
    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += delta;
      if (r.age < 0) { r.mat.opacity = 0; continue; }
      const t = r.age / r.life;
      if (t >= 1) { r.mesh.visible = false; continue; }
      const s = 0.15 + r.size * Math.sqrt(t);
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = 0.45 * (1 - t) * (1 - t);
    }

    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy -= 9.8 * delta;
      d.x += d.vx * delta; d.y += d.vy * delta; d.z += d.vz * delta;
      d.life -= delta;
      if (d.y < WATER_SURFACE_Y || d.life <= 0) { this.drops.splice(i, 1); continue; }
    }
    for (const d of this.drops) {
      this.dropPositions[n * 3] = d.x; this.dropPositions[n * 3 + 1] = d.y; this.dropPositions[n * 3 + 2] = d.z;
      n++;
    }
    const geo = this.dropPoints.geometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    for (const r of this.ripples) { this.scene.remove(r.mesh); r.mat.dispose(); }
    this.ringGeo.dispose();
    this.scene.remove(this.dropPoints);
    this.dropPoints.geometry.dispose();
    (this.dropPoints.material as THREE.Material).dispose();
  }
}

let wallTileTexture: THREE.CanvasTexture | null = null;

/** Cream-white 25 cm wall/ceiling tiles with thin dark grout — the Poolrooms' walls and pillars. */
export function createWallTileMaterial(): THREE.MeshStandardMaterial {
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
    }
    wallTileTexture = new THREE.CanvasTexture(canvas);
    wallTileTexture.wrapS = wallTileTexture.wrapT = THREE.RepeatWrapping;
    wallTileTexture.colorSpace = THREE.SRGBColorSpace;
    wallTileTexture.repeat.set(4, 4);
  }
  return new THREE.MeshStandardMaterial({ map: wallTileTexture, color: 0xffffff, emissive: 0x3a3a30, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.0 });
}
