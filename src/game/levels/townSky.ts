/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Level 94's sky: a dome that rides along with the camera (translation only,
 * so it reads as infinitely far away) inside the camera's far plane, drawn
 * first and without depth writes so everything else covers it. No fog: the
 * fog is tinted to the sky's horizon instead, which is what makes the hills
 * melt into it.
 *
 * It is one shader with a handful of knobs (gradient, sun, moon, stars,
 * clouds, a painted ridge of far hills), and four presets the director blends
 * between: the town's postcard day, its sunset, its night, and the pale,
 * windless overcast that hangs over the hills. The sun and sky lights live
 * here too, since their colour and angle follow the same blend.
 *
 * Purely cosmetic and local.
 */

import * as THREE from "three";

export interface SkyLook {
  top: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  /** Colour of the painted far hills. */
  hills: THREE.Color;
  /** Direction towards the sun (normalised). */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** 0..1: sun disc and glow. */
  sun: number;
  /** 0..1: moon disc. */
  moon: number;
  stars: number;
  clouds: number;
  cloudColor: THREE.Color;
  /** Directional sunlight intensity and the sky's hemisphere fill. */
  light: number;
  fill: number;
  fillSky: THREE.Color;
  fillGround: THREE.Color;
}

const C = (hex: number) => new THREE.Color(hex);
const dir = (azimuth: number, elevation: number) =>
  new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).normalize();

function look(p: Omit<SkyLook, "sunDir"> & { az: number; el: number }): SkyLook {
  const { az, el, ...rest } = p;
  return { ...rest, sunDir: dir(az, el) };
}

/** The town by day: a postcard blue, fat white clouds, warm sun from the south-west. */
export const SKY_DAY = look({
  top: C(0x3f7fd0), horizon: C(0xbfe0f4), ground: C(0x8fb87a), hills: C(0x7fae86),
  az: 0.65, el: 0.85, sunColor: C(0xfff3d6), sun: 1, moon: 0, stars: 0, clouds: 0.75, cloudColor: C(0xffffff),
  light: 2.1, fill: 1.1, fillSky: C(0xcfe6ff), fillGround: C(0x8a9a5a),
});

/** The clock has started: the sun drops into the west in seconds. */
export const SKY_SUNSET = look({
  top: C(0x3a2a6a), horizon: C(0xff8a3c), ground: C(0x5a3a2a), hills: C(0x6a3a4a),
  az: 1.45, el: 0.05, sunColor: C(0xff9a4a), sun: 1, moon: 0, stars: 0.1, clouds: 0.6, cloudColor: C(0xff9a7a),
  light: 1.3, fill: 0.6, fillSky: C(0xffb07a), fillGround: C(0x4a2a2a),
});

/** The town at night: no sun, a small moon, stars, everything blue-black. */
export const SKY_NIGHT = look({
  top: C(0x02040c), horizon: C(0x0d1a2e), ground: C(0x05070a), hills: C(0x070c16),
  az: -2.2, el: 0.75, sunColor: C(0x9ab0e0), sun: 0, moon: 1, stars: 1, clouds: 0.25, cloudColor: C(0x1a2438),
  light: 0.28, fill: 0.22, fillSky: C(0x2a3a66), fillGround: C(0x05070a),
});

/** The hills: a pale overcast, green-grey haze, no sun, no shadows, no sound. */
export const SKY_HILLS = look({
  top: C(0x9fb2b8), horizon: C(0xd8e0d4), ground: C(0x8a9a76), hills: C(0x9aa898),
  az: 0.3, el: 1.1, sunColor: C(0xf2f4ea), sun: 0, moon: 0, stars: 0, clouds: 0.95, cloudColor: C(0xc8d0cc),
  light: 0.9, fill: 1.25, fillSky: C(0xe6ecea), fillGround: C(0x8a9a6a),
});

/** Linear blend of two looks into `out`. */
export function mixSky(out: SkyLook, a: SkyLook, b: SkyLook, t: number): SkyLook {
  const k = Math.max(0, Math.min(1, t));
  out.top.copy(a.top).lerp(b.top, k);
  out.horizon.copy(a.horizon).lerp(b.horizon, k);
  out.ground.copy(a.ground).lerp(b.ground, k);
  out.hills.copy(a.hills).lerp(b.hills, k);
  out.sunDir.copy(a.sunDir).lerp(b.sunDir, k).normalize();
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, k);
  out.cloudColor.copy(a.cloudColor).lerp(b.cloudColor, k);
  out.fillSky.copy(a.fillSky).lerp(b.fillSky, k);
  out.fillGround.copy(a.fillGround).lerp(b.fillGround, k);
  for (const key of ["sun", "moon", "stars", "clouds", "light", "fill"] as const) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

export function cloneSky(s: SkyLook): SkyLook {
  return {
    ...s,
    top: s.top.clone(), horizon: s.horizon.clone(), ground: s.ground.clone(), hills: s.hills.clone(),
    sunDir: s.sunDir.clone(), sunColor: s.sunColor.clone(), cloudColor: s.cloudColor.clone(),
    fillSky: s.fillSky.clone(), fillGround: s.fillGround.clone(),
  };
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uTop, uHorizon, uGround, uHills, uSunDir, uSunColor, uCloudColor, uMoonDir;
  uniform float uSun, uMoon, uStars, uClouds, uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Painted gradient, with a few soft bands like a backdrop on a stage.
    float up = pow(clamp(h, 0.0, 1.0), 0.55);
    vec3 col = mix(uHorizon, uTop, up);
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));

    // Clouds: puffy fbm on a flat ceiling far above.
    if (h > 0.02 && uClouds > 0.01) {
      vec2 p = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
      float c = smoothstep(0.52 - uClouds * 0.22, 0.78, fbm(p));
      float shade = 0.82 + 0.18 * fbm(p * 2.0 + 7.0);
      col = mix(col, uCloudColor * shade, c * smoothstep(0.02, 0.18, h) * min(1.0, uClouds * 1.2));
    }

    // Stars.
    if (uStars > 0.01 && h > 0.0) {
      vec2 g = floor(d.xz / (h + 0.4) * 180.0);
      float s = step(0.9965, hash(g)) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 3.0) * 30.0));
      col += vec3(s) * uStars * smoothstep(0.0, 0.25, h);
    }

    // Sun (a flat cartoon disc with a soft glow) and moon.
    float sd = dot(d, uSunDir);
    col += uSunColor * uSun * (smoothstep(0.9975, 0.9985, sd) * 1.5 + pow(max(sd, 0.0), 24.0) * 0.45);
    float md = dot(d, uMoonDir);
    col = mix(col, vec3(0.92, 0.94, 1.0), uMoon * smoothstep(0.9988, 0.9993, md));
    col += vec3(0.25, 0.3, 0.45) * uMoon * pow(max(md, 0.0), 60.0) * 0.6;

    // Two painted ridges of far hills all around the horizon.
    float az = atan(d.x, d.z);
    float r1 = 0.035 + 0.05 * fbm(vec2(az * 2.2, 1.3));
    float r2 = 0.015 + 0.035 * fbm(vec2(az * 3.7 + 4.0, 8.1));
    vec3 far1 = mix(uHills, uHorizon, 0.55);
    vec3 far2 = mix(uHills, uHorizon, 0.2);
    col = mix(col, far1, smoothstep(r1 + 0.004, r1, h) * step(-0.02, h));
    col = mix(col, far2, smoothstep(r2 + 0.004, r2, h) * step(-0.02, h));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_RADIUS = 300;

export class TownSky {
  readonly root = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xffffff, 0);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 0);
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private time = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uHills: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
        uCloudColor: { value: new THREE.Color() }, uMoonDir: { value: dir(-2.2, 0.62) },
        uSun: { value: 0 }, uMoon: { value: 0 }, uStars: { value: 0 }, uClouds: { value: 0 }, uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 20), this.material);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.add(this.sun);
    this.root.add(this.sun.target);
    this.root.add(this.hemi);
  }

  /** Applies a look; `viewer` is the camera's world position. */
  update(delta: number, viewer: THREE.Vector3, s: SkyLook) {
    this.time += delta;
    const u = this.material.uniforms;
    u.uTop.value.copy(s.top);
    u.uHorizon.value.copy(s.horizon);
    u.uGround.value.copy(s.ground);
    u.uHills.value.copy(s.hills);
    u.uSunDir.value.copy(s.sunDir);
    u.uSunColor.value.copy(s.sunColor);
    u.uCloudColor.value.copy(s.cloudColor);
    u.uSun.value = s.sun;
    u.uMoon.value = s.moon;
    u.uStars.value = s.stars;
    u.uClouds.value = s.clouds;
    u.uTime.value = this.time;
    this.mesh.position.copy(viewer);

    // The sunlight comes from wherever the sun (or the moon) hangs.
    const lightDir = s.sun > 0.05 ? s.sunDir : (u.uMoonDir.value as THREE.Vector3);
    this.sun.position.copy(viewer).addScaledVector(lightDir, 60);
    this.sun.target.position.copy(viewer);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.light;
    this.hemi.color.copy(s.fillSky);
    this.hemi.groundColor.copy(s.fillGround);
    this.hemi.intensity = s.fill;
  }

  /** Indoors the sky and its lights still exist, they just don't reach in as strongly. */
  setIndoors(k: number) {
    this.sun.intensity *= 1 - 0.85 * k;
    this.hemi.intensity *= 1 - 0.7 * k;
  }

  dispose() {
    this.root.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
