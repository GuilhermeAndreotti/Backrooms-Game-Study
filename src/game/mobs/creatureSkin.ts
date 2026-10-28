/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural creature skin for the mobs' flat-coloured materials, injected
 * into MeshStandardMaterial: no textures, no extra draw calls.
 *
 * - mottling: uneven darker and lighter patches across the hide;
 * - relief: wrinkles and pores perturb the shading normal, so the
 *   flashlight rakes across a leathery surface instead of plastic;
 * - wetness: glossier patches break up the uniform roughness;
 * - rim: a sheen along the silhouette, scaled by the light already reaching
 *   the surface, so it reads in a lit hall and never glows in the dark.
 *
 * Everything is sampled in object space, so the pattern rides along with the
 * moving, animated body instead of swimming through it.
 */

import * as THREE from "three";

const SKIN_KEY = "creature-skin";

/** Whether `m` is a plain body material the skin should go on (not eyes, glows, glass or the Finger King's painted textures). */
function wantsSkin(m: THREE.Material): m is THREE.MeshStandardMaterial {
  if (!(m instanceof THREE.MeshStandardMaterial)) return false;
  if (m.map || m.transparent || m.metalness > 0.5 || m.userData.creatureSkin) return false;
  const e = m.emissive;
  return Math.max(e.r, e.g, e.b) * m.emissiveIntensity < 0.25;
}

/** Patches `material` in place when it is a plain creature surface; returns it either way. */
export function applyCreatureSkin<T extends THREE.Material>(material: T): T {
  if (!wantsSkin(material)) return material;
  material.userData.creatureSkin = true;

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSkinPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkinPos = position;");

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vSkinPos;
        float skHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float skNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(skHash(i + vec3(0, 0, 0)), skHash(i + vec3(1, 0, 0)), f.x),
                         mix(skHash(i + vec3(0, 1, 0)), skHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(skHash(i + vec3(0, 0, 1)), skHash(i + vec3(1, 0, 1)), f.x),
                         mix(skHash(i + vec3(0, 1, 1)), skHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        // Mottled hide: broad blotches plus a finer speckle.
        float skBlotch = skNoise(vSkinPos * 6.0);
        float skSpeckle = skNoise(vSkinPos * 21.0 + 7.3);
        diffuseColor.rgb *= mix(0.72, 1.12, skBlotch) * mix(0.9, 1.06, skSpeckle);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        // Wet, glossier patches where the blotches are darkest.
        roughnessFactor *= mix(0.62, 1.05, smoothstep(0.2, 0.7, skBlotch));`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Wrinkles and pores as a height field, turned into a normal tilt
          // from its screen-space derivatives (no tangents or bump map needed).
          float skH = skNoise(vSkinPos * vec3(34.0, 9.0, 34.0)) * 0.6 + skSpeckle * 0.4;
          vec3 skSx = dFdx(-vViewPosition);
          vec3 skSy = dFdy(-vViewPosition);
          vec3 skR1 = cross(skSy, normal);
          vec3 skR2 = cross(normal, skSx);
          float skDet = dot(skSx, skR1);
          vec3 skGrad = sign(skDet) * (dFdx(skH) * skR1 + dFdy(skH) * skR2);
          normal = normalize(abs(skDet) * normal - skGrad * 0.9);
        }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        {
          // Silhouette sheen, proportional to the light already arriving.
          float skRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
          reflectedLight.indirectDiffuse += reflectedLight.indirectDiffuse * skRim * 1.2;
          reflectedLight.directDiffuse += reflectedLight.directDiffuse * skRim * 0.6;
        }`,
      );
  };
  material.customProgramCacheKey = () => SKIN_KEY;
  material.needsUpdate = true;
  return material;
}

/**
 * A limb with rounded ends: a tapered tube of `length` along +Y (centred on
 * the origin) closed by hemispheres centred on both endpoints, so limbs that
 * meet at a joint overlap into one smooth knee/elbow instead of showing two
 * flat cut ends. Built at its real length (not scaled), so the caps stay round.
 */
export function roundedLimbGeometry(radius: number, taper: number, length: number, radial = 8): THREE.LatheGeometry {
  const r0 = radius;
  const r1 = Math.max(0.002, radius * taper);
  const h = length / 2;
  const pts: THREE.Vector2[] = [];
  const cap = 4;
  for (let i = 0; i <= cap; i++) { // bottom hemisphere, pole to equator
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, r0 * Math.cos(a)), -h + r0 * Math.sin(a)));
  }
  for (let i = 0; i <= cap; i++) { // top hemisphere, equator to pole
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, r1 * Math.cos(a)), h + r1 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/**
 * A humanoid trunk: shoulders rounding into the neck, a fuller chest and a
 * pinched waist above the hips, instead of a straight cylinder. Same
 * footprint as CylinderGeometry(rTop, rBottom, height), centred on the origin.
 */
export function torsoGeometry(rTop: number, rBottom: number, height: number, radial = 14): THREE.LatheGeometry {
  const h = height / 2;
  // [height fraction from the bottom, radius as a blend of rBottom..rTop, extra bulge]
  const profile: [number, number][] = [
    [0, rBottom * 0.55],
    [0.04, rBottom * 0.92],
    [0.14, rBottom],
    [0.38, (rBottom + rTop) / 2 * 0.86], // waist
    [0.62, rTop * 1.04], // chest
    [0.84, rTop * 1.02],
    [0.95, rTop * 0.8], // shoulders round over
    [1, rTop * 0.35],
  ];
  return new THREE.LatheGeometry(profile.map(([t, r]) => new THREE.Vector2(r, -h + t * height)), radial);
}
