/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 79's view outside the windows: a star field, a black hole with its
 * accretion disk, and a calm blue-green planet hanging just "behind" it.
 *
 * Everything here rides along with the camera (translation only) so it reads
 * as infinitely far away, and sits inside the camera's 45 m far plane. It is
 * drawn in the transparent pass with depth *testing* but no depth writes, so
 * the station's opaque walls hide it and only the glass lets it through. No
 * material here uses fog: the scene fog is the station's air, not space's.
 *
 * The sky is purely cosmetic and local; the director drives its few knobs
 * (hole size, planet size/fade/drift, star drift) from the shared puzzle state.
 */

import * as THREE from "three";
import { spaceRng } from "./spaceLayout";

const STAR_RADIUS = 40;
const HOLE_DISTANCE = 30;
const HOLE_SIZE = 19;
const PLANET_DISTANCE = 34;
const PLANET_RADIUS = 2.6;

/** Where things hang, as directions from the viewer (north is -z). */
const HOLE_DIR = new THREE.Vector3(-0.12, 0.045, -1).normalize();
const PLANET_DIR = new THREE.Vector3(0.14, 0.115, -1).normalize();
/** Light on the planet: from the upper left, so its day side faces the station. */
const SUN_DIR = new THREE.Vector3(-0.45, 0.3, 0.85).normalize();

const HOLE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A Schwarzschild-looking hole seen almost edge-on: the black shadow, a thin
// photon ring, the near side of the disk crossing in front of the shadow and
// the far side's lensed image arching over and under it. Output is
// premultiplied (see the material's blending) so the shadow can be truly black.
const HOLE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHeat;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    const float RS = 0.2;

    vec2 dp = vec2(p.x, (p.y + p.x * 0.06) / 0.16);
    float dr = length(dp);
    float ang = atan(dp.y, dp.x);
    float turb = noise(vec2(ang * 3.0 - uTime * 0.35, dr * 9.0)) * 0.6 + noise(vec2(ang * 9.0 + uTime * 0.6, dr * 22.0)) * 0.4;
    float disk = smoothstep(0.25, 0.31, dr) * (1.0 - smoothstep(0.55, 0.98, dr));
    disk *= (0.5 + 0.8 * turb) * (1.3 - dr);
    disk *= clamp(1.0 - 0.6 * p.x / max(dr * 0.16 + abs(p.x), 0.25), 0.35, 1.8);

    float ra = atan(p.y, p.x);
    float s = abs(sin(ra));
    float halo = exp(-pow((r - (RS + 0.07 + 0.03 * s)) / (0.025 + 0.03 * s), 2.0));
    halo *= 0.65 + 0.55 * noise(vec2(ra * 4.0 + uTime * 0.5, 3.0));
    float photon = exp(-pow((r - RS - 0.01) / 0.006, 2.0)) * 1.5;
    float glow = exp(-r * 3.0) * 0.4;

    float shadow = 1.0 - smoothstep(RS - 0.004, RS + 0.004, r);
    float nearSide = step(p.y, 0.0);
    float I = disk * mix(1.0, nearSide, shadow) + (halo + glow) * (1.0 - shadow) + photon;
    I *= 1.0 + uHeat * 0.7;

    vec3 warm = vec3(1.0, 0.5, 0.16);
    vec3 hot = vec3(1.0, 0.94, 0.82);
    vec3 col = mix(warm, hot, clamp(I * 0.7, 0.0, 1.0)) * I;
    float alpha = max(shadow, clamp(I, 0.0, 1.0));
    float edge = 1.0 - smoothstep(0.88, 1.0, r);
    gl_FragColor = vec4(col * edge, alpha * edge) * uOpacity;
  }
`;

const PLANET_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const PLANET_FRAG = /* glsl */ `
  uniform sampler2D uSurface;
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 surf = texture2D(uSurface, vUv).rgb;
    float cloud = texture2D(uClouds, vUv + vec2(uTime * 0.003, 0.0)).r;
    float diff = max(dot(n, uSun), 0.0);
    vec3 col = mix(surf * 1.2, vec3(0.97, 0.98, 1.0), cloud * 0.75) * (0.1 + 1.2 * diff);
    float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.2);
    col += vec3(0.35, 0.7, 1.0) * rim * (0.3 + 1.3 * diff);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/** Wrapping 2D value noise, a few octaves: enough for continents and cloud bands. */
function fractalNoise(width: number, height: number, seed: number, octaves: number, baseCells: number): Float32Array {
  const out = new Float32Array(width * height);
  const rng = spaceRng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = baseCells << o, cz = Math.max(2, (baseCells << o) >> 1);
    const grid = new Float32Array(cx * cz);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < height; y++) {
      const gy = (y / height) * (cz - 1);
      const y0 = Math.floor(gy), y1 = Math.min(cz - 1, y0 + 1), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < width; x++) {
        const gx = (x / width) * cx;
        const x0 = Math.floor(gx) % cx, x1 = (x0 + 1) % cx, fx = gx - Math.floor(gx);
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[x0 + y0 * cx] + (grid[x1 + y0 * cx] - grid[x0 + y0 * cx]) * sx;
        const b = grid[x0 + y1 * cx] + (grid[x1 + y1 * cx] - grid[x0 + y1 * cx]) * sx;
        out[x + y * width] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function planetTextures(): { surface: THREE.CanvasTexture; clouds: THREE.CanvasTexture } {
  const W = 512, H = 256;
  const land = fractalNoise(W, H, 79, 5, 6);
  const cloudN = fractalNoise(W, H, 7979, 4, 8);
  const surf = document.createElement("canvas");
  surf.width = W; surf.height = H;
  const clouds = document.createElement("canvas");
  clouds.width = W; clouds.height = H;
  const sctx = surf.getContext("2d")!;
  const cctx = clouds.getContext("2d")!;
  const simg = sctx.createImageData(W, H);
  const cimg = cctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = Math.abs(y / H - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = x + y * W, k = i * 4;
      const h = land[i];
      let r: number, g: number, b: number;
      if (lat > 0.86 - h * 0.12) {
        r = 232; g = 240; b = 246; // ice caps
      } else if (h > 0.53) {
        const t = Math.min(1, (h - 0.53) / 0.2);
        const dry = Math.max(0, 1 - lat * 1.6) * t;
        r = 52 + 80 * dry; g = 142 + 24 * t - 12 * dry; b = 60 + 10 * dry;
      } else {
        const depth = Math.min(1, (0.53 - h) / 0.2);
        const shelf = h > 0.49 ? 1 - (0.53 - h) / 0.04 : 0;
        r = 18 + 30 * shelf; g = 96 + 60 * shelf - 24 * depth; b = 182 + 30 * shelf - 30 * depth;
      }
      simg.data[k] = r; simg.data[k + 1] = g; simg.data[k + 2] = b; simg.data[k + 3] = 255;
      const band = 0.5 + 0.5 * Math.sin(lat * 9.0);
      const c = Math.max(0, Math.min(1, (cloudN[i] * 0.85 + band * 0.25 - 0.56) * 3.0));
      cimg.data[k] = cimg.data[k + 1] = cimg.data[k + 2] = Math.round(c * 255);
      cimg.data[k + 3] = 255;
    }
  }
  sctx.putImageData(simg, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  const surface = new THREE.CanvasTexture(surf);
  surface.colorSpace = THREE.SRGBColorSpace;
  surface.wrapS = THREE.RepeatWrapping;
  const cloudTex = new THREE.CanvasTexture(clouds);
  cloudTex.wrapS = THREE.RepeatWrapping;
  return { surface, clouds: cloudTex };
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
  g.addColorStop(0, "rgba(140,200,255,0.9)");
  g.addColorStop(0.45, "rgba(90,160,255,0.35)");
  g.addColorStop(1, "rgba(60,120,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class SpaceSky {
  readonly root = new THREE.Group();

  private readonly stars: THREE.Points;
  private readonly hole: THREE.Mesh;
  private readonly holeMat: THREE.ShaderMaterial;
  private readonly planet: THREE.Mesh;
  private readonly planetMat: THREE.ShaderMaterial;
  private readonly atmosphere: THREE.Sprite;
  private readonly disposables: { dispose(): void }[] = [];

  /** Knobs the director eases towards; applied in update(). */
  holeScale = 1;
  holeHeat = 0;
  planetScale = 1;
  planetOpacity = 1;
  /** 0 = where it starts, 1 = slid right in behind the hole's centre. */
  planetDrift = 0;
  /** Radians per second the star field turns: the station is moving. */
  starDrift = 0;

  constructor() {
    this.root.name = "level79_sky";

    // Stars: a scatter over the whole sphere plus a denser, dimmer band.
    const rng = spaceRng(0x5ea5);
    const count = 2600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const band = i > count * 0.55;
      const u = rng() * 2 - 1, th = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      v.set(s * Math.cos(th), band ? u * 0.18 : u, s * Math.sin(th)).normalize();
      if (band) v.applyAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), 0.9);
      v.multiplyScalar(STAR_RADIUS);
      pos.set([v.x, v.y, v.z], i * 3);
      const b = band ? 0.2 + rng() * 0.35 : 0.35 + rng() * 0.5;
      const tint = rng();
      col.set(tint < 0.15 ? [b * 0.8, b * 0.88, b] : tint > 0.93 ? [b, b * 0.86, b * 0.7] : [b, b, b], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const starMat = new THREE.PointsMaterial({ size: 1.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.renderOrder = -10;
    this.stars.frustumCulled = false;
    this.root.add(this.stars);
    this.disposables.push(starGeo, starMat);

    // The planet, and a soft halo of atmosphere behind it.
    const tex = planetTextures();
    const glow = glowTexture();
    this.planetMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        uSurface: { value: tex.surface },
        uClouds: { value: tex.clouds },
        uSun: { value: SUN_DIR.clone() },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    });
    const planetGeo = new THREE.SphereGeometry(PLANET_RADIUS, 48, 24);
    this.planet = new THREE.Mesh(planetGeo, this.planetMat);
    this.planet.rotation.z = 0.35;
    this.planet.renderOrder = -9;
    this.planet.frustumCulled = false;
    this.root.add(this.planet);
    const atmoMat = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.55 });
    this.atmosphere = new THREE.Sprite(atmoMat);
    this.atmosphere.renderOrder = -9.5;
    this.atmosphere.frustumCulled = false;
    this.root.add(this.atmosphere);
    this.disposables.push(tex.surface, tex.clouds, glow, this.planetMat, planetGeo, atmoMat);

    // The hole: a camera-facing card (the camera always sits at the root's origin).
    this.holeMat = new THREE.ShaderMaterial({
      vertexShader: HOLE_VERT,
      fragmentShader: HOLE_FRAG,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uHeat: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const holeGeo = new THREE.PlaneGeometry(1, 1);
    this.hole = new THREE.Mesh(holeGeo, this.holeMat);
    this.hole.position.copy(HOLE_DIR).multiplyScalar(HOLE_DISTANCE);
    this.hole.lookAt(0, 0, 0);
    this.hole.renderOrder = -8;
    this.hole.frustumCulled = false;
    this.root.add(this.hole);
    this.disposables.push(holeGeo, this.holeMat);

    this.apply();
  }

  /** Angle (radians) between the view direction and the hole: how squarely the viewer is looking at it. */
  angleToHole(viewDir: THREE.Vector3): number {
    return viewDir.angleTo(HOLE_DIR);
  }

  private readonly scratch = new THREE.Vector3();

  private apply() {
    const size = HOLE_SIZE * this.holeScale;
    this.hole.scale.set(size, size, 1);
    this.holeMat.uniforms.uHeat.value = this.holeHeat;

    const dir = this.scratch.copy(PLANET_DIR).lerp(HOLE_DIR, this.planetDrift * 0.92).normalize();
    this.planet.position.copy(dir).multiplyScalar(PLANET_DISTANCE);
    this.planet.scale.setScalar(Math.max(0.001, this.planetScale));
    this.planet.visible = this.planetOpacity > 0.005 && this.planetScale > 0.005;
    this.planetMat.uniforms.uOpacity.value = this.planetOpacity;
    this.atmosphere.position.copy(this.planet.position).multiplyScalar(1.01);
    const halo = PLANET_RADIUS * 3.1 * this.planetScale;
    this.atmosphere.scale.set(halo, halo, 1);
    this.atmosphere.visible = this.planet.visible;
    (this.atmosphere.material as THREE.SpriteMaterial).opacity = 0.55 * this.planetOpacity;
  }

  update(delta: number, time: number, viewer: THREE.Vector3) {
    this.root.position.copy(viewer);
    this.stars.rotation.y += this.starDrift * delta;
    this.holeMat.uniforms.uTime.value = time;
    this.planetMat.uniforms.uTime.value = time;
    this.planet.rotation.y += delta * 0.01;
    this.apply();
  }

  dispose() {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
