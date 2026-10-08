/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Abandoned Office's windows: the office is the ~50th floor of a lone
 * tower, in a storm, with a city and hills far off on the horizon.
 *
 * - The tower itself: its outline follows the office's rooms (wings and
 *   recesses, see ProceduralMap.officeMassTexture), extruded from the ground
 *   200 m below to a few floors above. The glass traces each view ray through
 *   that outline, so from a window near an inner corner you see the other
 *   wing's dark facade, with true parallax, floors above and below.
 * - Everything farther away (the plain, roads, the city kilometres off at the
 *   foot of the hills) is real 3D rendered once into a cube map by
 *   {@link buildOfficeSkyline}; the glass looks it up along the view ray.
 * - Rain falls outside in three sheets at different depths (parallax again).
 * - On the glass: beads that form and evaporate, and drops that run down
 *   leaving clear trails. They refract (a drop is a little upside-down lens)
 *   and the rest of the pane is misted in patches.
 * - Lightning lights the sky, the hills and the tower and draws a bolt.
 *
 * One material is shared by every window (see LevelDecor.officeWindow); the
 * engine drives it through {@link setOfficeWindowState}.
 */

import * as THREE from "three";

/** Size of the glass (m; the drops are sized in metres) and the height of its sill. */
export const OFFICE_GLASS_W = 3.3;
export const OFFICE_GLASS_H = 1.85;
export const OFFICE_GLASS_SILL = 0.75;

/** The tower: storey height, how far below the office the ground is, and its roof. */
const STOREY = 4;
const GROUND_Y = -200;
const ROOF_Y = STOREY * 4;

const HORIZON = 0x2e353c;
const ZENITH = 0x0e1216;

const VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vLocalView;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  mat3 m = mat3(modelMatrix);
  vLocalView = transpose(m) * (wp.xyz - cameraPosition);
  vTangent = normalize(m * vec3(1.0, 0.0, 0.0));
  vBitangent = normalize(m * vec3(0.0, 1.0, 0.0));
  vNormal = normalize(m * vec3(0.0, 0.0, 1.0));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform samplerCube uCity;
uniform float uHasCity;
uniform float uCityAz;
uniform sampler2D uMass;
uniform float uHasMass;
uniform float uGrid;
uniform float uCell;
uniform float uTime;
uniform float uFlash;
uniform float uBoltAz;
uniform vec2 uSize;
uniform vec3 uHorizon;
uniform vec3 uZenith;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vLocalView;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec3 vNormal;

const float STOREY = ${STOREY.toFixed(1)};
const float GROUND_Y = ${GROUND_Y.toFixed(1)};
const float ROOF_Y = ${ROOF_Y.toFixed(1)};

float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y);
}

// Beads sitting on the glass: each grows, lingers and evaporates on its own clock.
float beads(vec2 g) {
  vec2 q = g * 26.0;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = h12(id);
  if (h < 0.72) return 0.0;
  vec2 o = vec2(h12(id + 7.1), h12(id + 3.7)) - 0.5;
  float life = fract(uTime * (0.03 + 0.05 * h) + h * 7.0);
  float r = mix(0.1, 0.3, h12(id + 1.3)) * smoothstep(0.0, 0.2, life) * smoothstep(1.0, 0.8, life);
  float d = length(f - o * 0.5);
  return max(0.0, 1.0 - d * d / (r * r + 1e-4));
}

// Drops running down the pane in columns ~1/scale m wide; x = dome height, y = wet trail.
vec2 runners(vec2 g, float scale, float seed) {
  float cellH = 3.0 / scale;
  float col = floor(g.x * scale);
  float h = h12(vec2(col, seed));
  float phase = uTime * (0.12 + 0.25 * h) + h * 17.0;
  float cycle = floor(phase);
  if (h12(vec2(col + seed, cycle)) < 0.45) return vec2(0.0);
  float p = fract(phase);
  // Stop-and-go, as a real drop snags on the glass then lets go.
  p = p + 0.05 * sin(p * 25.0 + h * 6.0);
  float headY = (1.0 - p) * uSize.y * 1.3 - 0.1 * uSize.y;
  float y = g.y;
  float wiggle = sin(y * 22.0 + col * 3.1) * 0.0035 + sin(y * 9.0 + h * 5.0) * 0.003;
  float cx = (col + 0.5 + (h - 0.5) * 0.5) / scale + wiggle;
  float dx = g.x - cx;
  float dy = y - headY;
  float r = 0.011 + 0.007 * h;
  float dome = max(0.0, 1.0 - (dx * dx + dy * dy * 0.6) / (r * r));
  float tail = dy / cellH;
  float trail = 0.0;
  if (dy > 0.0 && tail < 1.0) {
    float w = r * 0.45 * (1.0 - tail);
    trail = smoothstep(w, 0.0, abs(dx)) * (1.0 - tail);
    // Little droplets left behind in the trail.
    float bead = smoothstep(0.5, 1.0, sin(y * 140.0 + col * 7.0)) * trail;
    dome = max(dome, bead * 0.45);
  }
  return vec2(dome, trail);
}

float heightAt(vec2 g, out float trail) {
  vec2 a = runners(g, 9.0, 1.7);
  vec2 b = runners(g + vec2(0.031, 0.0), 15.0, 8.3);
  trail = max(a.y, b.y * 0.8);
  return beads(g) * 0.8 + a.x + b.x * 0.7;
}

// Sheets of rain outside, \`depth\` metres behind the glass (seen with parallax).
float rainSheet(vec2 g, vec3 lv, float depth, float scale, float speed, float seed) {
  vec2 p = g + lv.xy / max(-lv.z, 0.2) * depth;
  p.x += p.y * 0.18; // the wind slants it
  p *= scale;
  float col = floor(p.x);
  float h = h12(vec2(col, seed));
  float y = p.y * 0.12 + uTime * speed * (0.8 + 0.4 * h) + h * 10.0;
  float seg = floor(y);
  float on = step(0.55, h12(vec2(col, seg + seed)));
  float fy = fract(y);
  float streak = smoothstep(0.0, 0.08, fy) * smoothstep(0.55, 0.15, fy);
  float fx = abs(fract(p.x) - 0.5 - (h - 0.5) * 0.6);
  return on * streak * smoothstep(0.06, 0.0, fx);
}

float angleTo(float az, float target) {
  return abs(mod(az - target + 3.14159265, 6.2831853) - 3.14159265);
}

vec3 skyColor(vec3 d) {
  float el = d.y;
  float az = atan(d.x, d.z);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, el));
  // Low clouds scudding past.
  vec2 cp = d.xz / max(el + 0.15, 0.05) * 1.5 + vec2(uTime * 0.04, uTime * 0.015);
  float c = vnoise(cp) * 0.6 + vnoise(cp * 2.3) * 0.4;
  sky *= 0.75 + 0.5 * c;
  // The far city's sodium glow on the underside of the clouds.
  float glow = exp(-angleTo(az, uCityAz) * 2.2) * exp(-max(el, 0.0) * 7.0) * uHasCity;
  sky += vec3(0.16, 0.085, 0.035) * glow * (0.7 + 0.3 * c);
  return sky;
}

vec3 outside(vec3 d, float bias) {
  vec3 sky = skyColor(d);
  float el = d.y;
  vec4 far = uHasCity > 0.5 ? textureCube(uCity, d, bias) : vec4(0.0);
  vec3 col = mix(sky, far.rgb * (1.0 + uFlash * 2.5), far.a);
  // Lightning: the clouds light up, and a bolt cracks down somewhere.
  float skyMask = 1.0 - far.a;
  col += uFlash * vec3(0.75, 0.8, 1.0) * (0.25 + 0.75 * smoothstep(-0.05, 0.5, el)) * skyMask;
  float az = atan(d.x, d.z);
  float jag = sin(el * 40.0 + uBoltAz * 3.0) * 0.02 + sin(el * 97.0 + uBoltAz) * 0.008 + el * 0.15;
  float bolt = smoothstep(0.006, 0.0, angleTo(az - jag, uBoltAz)) * step(0.0, el) * step(el, 0.55) * skyMask;
  col += bolt * smoothstep(0.35, 0.8, uFlash) * vec3(1.6, 1.7, 2.0);
  return col;
}

float massAt(ivec2 c) {
  int n = int(uGrid);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return 0.0;
  return texelFetch(uMass, c, 0).r;
}

/**
 * The ray from the glass against the tower's own walls (2D DDA over the
 * office's outline, extruded from GROUND_Y to ROOF_Y). Returns the distance
 * (-1 = misses the tower) and the surface normal; kind 1 = facade, 2 = roof.
 */
float traceTower(vec3 o, vec3 d, out vec3 nrm, out float kind) {
  kind = 0.0;
  nrm = vec3(0.0);
  vec2 p = o.xz / uCell;
  vec2 dir = d.xz;
  ivec2 c = ivec2(floor(p));
  vec2 st = vec2(dir.x >= 0.0 ? 1.0 : -1.0, dir.y >= 0.0 ? 1.0 : -1.0);
  vec2 inv = 1.0 / max(abs(dir), vec2(1e-5));
  vec2 tMax = vec2(
    (dir.x >= 0.0 ? float(c.x) + 1.0 - p.x : p.x - float(c.x)) * uCell * inv.x,
    (dir.y >= 0.0 ? float(c.y) + 1.0 - p.y : p.y - float(c.y)) * uCell * inv.y);
  vec2 tDelta = uCell * inv;
  for (int i = 0; i < 160; i++) {
    float tEnter;
    bool xAxis = tMax.x < tMax.y;
    if (xAxis) { c.x += int(st.x); tEnter = tMax.x; tMax.x += tDelta.x; }
    else { c.y += int(st.y); tEnter = tMax.y; tMax.y += tDelta.y; }
    int n = int(uGrid);
    if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) break; // off the tower's lot: nothing more to hit
    float y = o.y + d.y * tEnter;
    if (y < GROUND_Y) break;
    if (massAt(c) > 0.5) {
      if (y <= ROOF_Y) {
        nrm = xAxis ? vec3(-st.x, 0.0, 0.0) : vec3(0.0, 0.0, -st.y);
        kind = 1.0;
        return tEnter;
      }
      if (d.y < 0.0) {
        float tr = (ROOF_Y - o.y) / d.y;
        if (tr <= min(tMax.x, tMax.y)) { nrm = vec3(0.0, 1.0, 0.0); kind = 2.0; return tr; }
      }
    }
  }
  return -1.0;
}

/** The tower seen from outside: dark spandrels and glass, mullions, the odd dying light. */
vec3 towerColor(vec3 pos, vec3 nrm, vec3 d, float t, float kind) {
  vec3 concrete = vec3(0.055, 0.057, 0.06) * (1.0 + uFlash * 3.0);
  vec3 col;
  if (kind > 1.5) {
    col = concrete * 0.8;
  } else {
    float u = dot(pos.xz, vec2(-nrm.z, nrm.x));
    float fv = fract(pos.y / STOREY);
    float storey = floor(pos.y / STOREY);
    float bay = floor(u / 1.6);
    float fu = fract(u / 1.6);
    vec3 refl = skyColor(reflect(d, nrm)) * 0.35 + uFlash * vec3(0.5, 0.55, 0.65);
    vec3 glass = vec3(0.006, 0.007, 0.009) + refl;
    float face = nrm.x * 91.0 + nrm.z * 37.0;
    float lit = step(0.992, h12(vec2(bay + face, storey)));
    float flicker = step(0.3, vnoise(vec2(uTime * 7.0, bay * 3.0 + storey)));
    glass += lit * flicker * vec3(0.5, 0.6, 0.65);
    float mullion = smoothstep(0.035, 0.0, min(fu, 1.0 - fu));
    col = fv < 0.25 ? concrete * (0.8 + 0.4 * smoothstep(0.0, 0.25, fv)) : mix(glass, concrete * 0.6, mullion);
    // Rain sheeting down the facade.
    col += vec3(0.02) * step(0.8, h12(vec2(floor(u * 6.0), floor(pos.y * 0.3 + uTime * 2.0))));
  }
  return mix(col, uHorizon, 1.0 - exp(-t * 0.004));
}

void main() {
  vec2 g = vUv * uSize;
  vec3 lv = normalize(vLocalView);
  vec3 d = normalize(vWorld - cameraPosition);

  // The glass: drops, their slopes (finite differences), and wet trails.
  float trail;
  float hC = heightAt(g, trail);
  float t2;
  float e = 0.0025;
  float hX = heightAt(g + vec2(e, 0.0), t2);
  float hY = heightAt(g + vec2(0.0, e), t2);
  vec2 n = vec2(hX - hC, hY - hC) / e * 0.004;
  float drop = smoothstep(0.02, 0.25, hC);

  // A drop is a tiny lens: it bends (and flips) what's behind it, and shows it sharp.
  vec3 dr = normalize(d - (vTangent * n.x + vBitangent * n.y) * 1.1);
  // Condensation comes in patches: thick at the bottom of the pane, thin in places.
  float fog = smoothstep(0.25, 0.85, vnoise(g * 2.2 + 3.0) * 0.7 + (1.0 - vUv.y) * 0.45);
  float mist = fog * (1.0 - clamp(drop + trail * 0.85, 0.0, 1.0));

  vec3 col;
  vec3 nrm;
  float kind;
  // Start just past the outside face of the wall the window is set in.
  float ahead = max(dot(dr, -vNormal), 1e-3);
  vec3 start = vWorld + dr * (0.05 / ahead);
  float t = uHasMass > 0.5 ? traceTower(start, dr, nrm, kind) : -1.0;
  if (t >= 0.0) {
    col = towerColor(start + dr * t, nrm, dr, t, kind);
    col = mix(col, uHorizon * 1.2, mist * 0.5);
  } else {
    col = outside(dr, mix(0.0, 2.6, mist));
  }

  // Rain falling outside, near sheets brighter, bigger and quicker across the glass.
  vec3 rainCol = mix(uHorizon * 3.0 + 0.05, vec3(1.0), uFlash * 0.7);
  float rain = rainSheet(g, lv, 0.8, 9.0, 3.2, 1.0) * 0.55
             + rainSheet(g, lv, 3.0, 14.0, 2.6, 2.0) * 0.4
             + rainSheet(g, lv, 9.0, 22.0, 2.0, 3.0) * 0.28;
  col = mix(col, rainCol, clamp(rain * (1.0 - drop), 0.0, 1.0));

  // Mist on the pane, the rims of the drops catching the room's light.
  col = mix(col, uHorizon * 1.6 + vec3(0.02), 0.25 * mist);
  float rim = clamp(length(n) * 3.0, 0.0, 1.0) * drop;
  col += rim * (0.06 + uFlash * 0.4) + max(0.0, n.y) * drop * 0.25 * (0.3 + uFlash);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The shared window-glass material (one per map: LevelDecor builds it through its kit). */
export function createOfficeWindowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uCity: { value: null },
        uHasCity: { value: 0 },
        uCityAz: { value: 0 },
        uMass: { value: null },
        uHasMass: { value: 0 },
        uGrid: { value: 1 },
        uCell: { value: 4 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uBoltAz: { value: 0 },
        uSize: { value: new THREE.Vector2(OFFICE_GLASS_W, OFFICE_GLASS_H) },
        uHorizon: { value: new THREE.Color(HORIZON) },
        uZenith: { value: new THREE.Color(ZENITH) },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
  });
}

/** Per-frame: time (s), lightning flash (0..1), and the azimuth (rad) of the bolt. */
export function setOfficeWindowState(mat: THREE.ShaderMaterial, time: number, flash: number, boltAz: number) {
  mat.uniforms.uTime.value = time % 1000;
  mat.uniforms.uFlash.value = flash;
  mat.uniforms.uBoltAz.value = boltAz;
}

/** What lies outside: the far landscape (cube map + where the city is) and the tower's outline. */
export interface OfficeOutlook {
  far: OfficeSkyline | null;
  /** One texel per map cell (x = gx, y = gz), red > 0.5 where the tower stands. */
  mass: THREE.Texture | null;
  gridSize: number;
  cellSize: number;
}

export function setOfficeWindowOutlook(mat: THREE.ShaderMaterial, outlook: OfficeOutlook) {
  const u = mat.uniforms;
  u.uCity.value = outlook.far?.target.texture ?? null;
  u.uHasCity.value = outlook.far ? 1 : 0;
  u.uCityAz.value = outlook.far?.cityAz ?? 0;
  u.uMass.value = outlook.mass;
  u.uHasMass.value = outlook.mass ? 1 : 0;
  u.uGrid.value = outlook.gridSize;
  u.uCell.value = outlook.cellSize;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The far landscape rendered into a cube map, and the bearing of the city (rad, atan(x, z)). */
export interface OfficeSkyline {
  target: THREE.WebGLCubeRenderTarget;
  cityAz: number;
}

/**
 * Builds what the tower looks out on and renders it once into a cube map
 * from the office's floor, 200 m up, then throws the scene away:
 *
 * - a dark plain all around, crossed by a couple of roads of orange lamps,
 * - a city 5-7 km off, at the foot of the hills: dark blocks and thousands
 *   of window lights, red aviation lights on the tallest,
 * - rolling hills 7-16 km out closing the horizon, masts blinking on top.
 *
 * The sky is left transparent (alpha 0) so the glass draws its own moving
 * sky, clouds, city glow and lightning behind the landscape.
 */
export function buildOfficeSkyline(renderer: THREE.WebGLRenderer, seed: number, size = 512): OfficeSkyline {
  const rng = mulberry(seed ^ 0x51ca1e);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 1200, 24000);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const cityAz = rng() * Math.PI * 2;
  const dirAt = (az: number, r: number, y: number) => new THREE.Vector3(Math.sin(az) * r, y, Math.cos(az) * r);

  // The plain.
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: 0x07090a })));
  ground.position.y = GROUND_Y;
  scene.add(ground);

  // Hills: low wide domes in rings, the nearer ones darker against the haze.
  const hillGeo = keep(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const hillMat = keep(new THREE.MeshBasicMaterial({ color: 0x0b100e }));
  const hillTops: THREE.Vector3[] = [];
  for (let i = 0; i < 90; i++) {
    // Thicker behind the city, but all the way around.
    const az = rng() < 0.45 ? cityAz + (rng() - 0.5) * 1.8 : rng() * Math.PI * 2;
    const radius = 1500 + rng() * 3500;
    const r = 8000 + radius + rng() * 7000; // the near edge stays behind the city
    const h = 250 + rng() * rng() * 1100;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.scale.set(radius, h, radius * (0.6 + rng() * 0.8));
    hill.rotation.y = rng() * Math.PI;
    hill.position.copy(dirAt(az, r, GROUND_Y));
    scene.add(hill);
    if (h > 700) hillTops.push(dirAt(az, r, GROUND_Y + h + 40));
  }

  // The city: dark blocks and their lights, 5-7 km off at the foot of the hills.
  const blockGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const blockMat = keep(new THREE.MeshBasicMaterial({ color: 0x0e1114 }));
  const lights: number[] = [];
  const lightColors: number[] = [];
  const reds: number[] = [];
  const palette = [new THREE.Color(0xffc97a), new THREE.Color(0xffe2b0), new THREE.Color(0xcfe2ff), new THREE.Color(0xff9a3c)];
  const pushLight = (v: THREE.Vector3, color: THREE.Color, k: number) => {
    lights.push(v.x, v.y, v.z);
    lightColors.push(color.r * k, color.g * k, color.b * k);
  };
  for (let i = 0; i < 520; i++) {
    const az = cityAz + (rng() - 0.5) * 0.55 * (0.4 + rng());
    const r = 5000 + rng() * 2200;
    const w = 25 + rng() * 60;
    const dpt = 25 + rng() * 60;
    const tall = rng();
    const h = 15 + tall * tall * tall * 220;
    const block = new THREE.Mesh(blockGeo, blockMat);
    block.scale.set(w, h, dpt);
    block.position.copy(dirAt(az, r, GROUND_Y + h / 2));
    block.rotation.y = rng() * Math.PI;
    scene.add(block);
    // Lit windows on the side facing the tower.
    const facing = dirAt(az, -1, 0).normalize();
    const lit = Math.floor(h / 12) + 2;
    for (let k = 0; k < lit; k++) {
      const p = block.position.clone().addScaledVector(facing, Math.max(w, dpt) * 0.5 + 1);
      p.x += (rng() - 0.5) * w; p.z += (rng() - 0.5) * dpt;
      p.y = GROUND_Y + 3 + rng() * (h - 4);
      pushLight(p, palette[Math.floor(rng() * palette.length)], 0.6 + rng() * 1.4);
    }
    if (h > 150) reds.push(block.position.x, GROUND_Y + h + 3, block.position.z);
  }
  // Street lights through the city.
  for (let i = 0; i < 900; i++) {
    const az = cityAz + (rng() - 0.5) * 0.7;
    pushLight(dirAt(az, 4700 + rng() * 2800, GROUND_Y + 4), palette[3], 1.2);
  }
  // A couple of roads from the tower's lot out across the plain, one to the city.
  const roads = [cityAz + (rng() - 0.5) * 0.1, cityAz + Math.PI * (0.6 + rng() * 0.6), rng() * Math.PI * 2];
  roads.forEach((az0, ri) => {
    const bend = (rng() - 0.5) * 0.4;
    const len = ri === 0 ? 5000 : 3000 + rng() * 5000;
    for (let r = 260; r < len; r += 45) {
      const az = az0 + bend * (r / len) * (r / len);
      pushLight(dirAt(az, r, GROUND_Y + 8), palette[3], 1.6);
    }
  });
  hillTops.forEach((v) => reds.push(v.x, v.y, v.z));

  const lightGeo = keep(new THREE.BufferGeometry());
  lightGeo.setAttribute("position", new THREE.Float32BufferAttribute(lights, 3));
  lightGeo.setAttribute("color", new THREE.Float32BufferAttribute(lightColors, 3));
  scene.add(new THREE.Points(lightGeo, keep(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }))));
  const redGeo = keep(new THREE.BufferGeometry());
  redGeo.setAttribute("position", new THREE.Float32BufferAttribute(reds, 3));
  scene.add(new THREE.Points(redGeo, keep(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: new THREE.Color(4, 0.3, 0.2) }))));

  const target = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const camera = new THREE.CubeCamera(1, 40000, target);
  scene.add(camera);

  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTarget = renderer.getRenderTarget();
  const prevShadows = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  camera.update(renderer, scene);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  renderer.shadowMap.autoUpdate = prevShadows;

  disposables.forEach((d) => d.dispose());
  return { target, cityAz };
}
