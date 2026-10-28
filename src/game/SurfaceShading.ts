/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";

/**
 * World-space weathering and contact occlusion for the maze's shared
 * wall/floor/ceiling materials, injected into MeshStandardMaterial.
 *
 * The surface textures are small and tile every metre or so; on their own a
 * corridor reads as one printed pattern repeated forever, and walls meet the
 * floor and ceiling with no shading at all. This adds, per fragment:
 *
 * - low-frequency stains and discolouration in world space, so neighbouring
 *   cells never look alike (and nothing extra is stored per cell);
 * - water damage: walls wicking damp up from the carpet, leak streaks and
 *   tide rings on the ceiling tiles;
 * - contact occlusion along every wall/floor/ceiling edge and into corners,
 *   read from a one-texel-per-cell map of which grid cells are solid. It
 *   dims the ambient/environment light fully and the lamps partly, which is
 *   what a real hallway's corners look like.
 *
 * Cost: a few ALU-only noise taps and 4-8 texelFetches into a tiny R8
 * texture per fragment, on three materials. No extra draw calls, geometry
 * or render passes. The `lite` variant (low preset) drops to one noise
 * octave and skips the outer-corner fetches.
 */

export type SurfaceKind = "wall" | "floor" | "ceiling";

export interface SurfaceWeathering {
  kind: SurfaceKind;
  /** Colour the big stains pull the surface towards (multiplied, sRGB hex). */
  stain: number;
  /** 0..1: how strongly the stains show. */
  stainStrength: number;
  /** 0..1: walls only — damp wicking up from the floor, ceilings — tide rings. */
  damp: number;
  /** 0..1: contact occlusion strength along edges and into corners. */
  occlusion: number;
}

/** One per map: which grid cells are solid, shared by all its materials. */
export class SolidCellGrid {
  readonly texture: THREE.DataTexture;
  readonly uniforms: {
    uSolidCells: { value: THREE.DataTexture };
    uCellSize: { value: number };
    uGridSize: { value: number };
  };

  constructor(isSolid: (gx: number, gz: number) => boolean, gridSize: number, cellSize: number, readonly wallHeight: number) {
    const data = new Uint8Array(gridSize * gridSize);
    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) data[gz * gridSize + gx] = isSolid(gx, gz) ? 255 : 0;
    }
    this.texture = new THREE.DataTexture(data, gridSize, gridSize, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uSolidCells: { value: this.texture },
      uCellSize: { value: cellSize },
      uGridSize: { value: gridSize },
    };
  }

  public dispose() {
    this.texture.dispose();
  }
}

const NOISE_GLSL = /* glsl */ `
  float wHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
               mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float wFbm(vec2 p) {
    #ifdef W_LITE
    return wNoise(p);
    #else
    return wNoise(p) * 0.55 + wNoise(p * 2.13 + 17.1) * 0.3 + wNoise(p * 4.37 + 3.7) * 0.15;
    #endif
  }
`;

const OCCLUSION_GLSL = /* glsl */ `
  uniform sampler2D uSolidCells;
  uniform float uCellSize;
  uniform float uGridSize;

  float wSolid(ivec2 c) {
    if (c.x < 0 || c.y < 0 || c.x >= int(uGridSize) || c.y >= int(uGridSize)) return 1.0;
    return texelFetch(uSolidCells, c, 0).r;
  }
  // 1 at the edge, 0 from \`reach\` metres away; squared for a tight contact shade.
  float wEdge(float d, float reach) {
    float k = 1.0 - smoothstep(0.0, reach, d);
    return k * k;
  }
  // How much the solid cells around world point p (on a surface with normal n)
  // shut it in. Sides parallel to the surface itself are ignored, so a wall
  // only darkens towards the walls it meets, never from the one it is.
  float wGridOcclusion(vec2 p, vec3 n) {
    p += n.xz * 0.03; // walls sit on the cell boundary: step into the open cell
    vec2 c = p / uCellSize;
    ivec2 cell = ivec2(floor(c));
    vec2 f = (c - floor(c)) * uCellSize;
    float s = uCellSize;
    float ax = 1.0 - abs(n.x);
    float az = 1.0 - abs(n.z);
    float w = wSolid(cell + ivec2(-1, 0));
    float e = wSolid(cell + ivec2(1, 0));
    float no = wSolid(cell + ivec2(0, -1));
    float so = wSolid(cell + ivec2(0, 1));
    const float R = 0.85;
    float occ = 0.0;
    occ += w * ax * wEdge(f.x, R);
    occ += e * ax * wEdge(s - f.x, R);
    occ += no * az * wEdge(f.y, R);
    occ += so * az * wEdge(s - f.y, R);
    #ifndef W_LITE
    // Outer corners: a solid diagonal with both shared sides open (pillar ends, doorways).
    occ += wSolid(cell + ivec2(-1, -1)) * (1.0 - w) * (1.0 - no) * wEdge(length(f), R) * ax * az;
    occ += wSolid(cell + ivec2(1, -1)) * (1.0 - e) * (1.0 - no) * wEdge(length(vec2(s - f.x, f.y)), R) * ax * az;
    occ += wSolid(cell + ivec2(-1, 1)) * (1.0 - w) * (1.0 - so) * wEdge(length(vec2(f.x, s - f.y)), R) * ax * az;
    occ += wSolid(cell + ivec2(1, 1)) * (1.0 - e) * (1.0 - so) * wEdge(length(vec2(s - f.x, s - f.y)), R) * ax * az;
    #endif
    return occ;
  }
`;

/**
 * Patches `material` in place (calling it again replaces the patch, e.g. on
 * a quality change). Materials sharing the same options share one compiled
 * program (see customProgramCacheKey).
 */
export function applySurfaceWeathering(material: THREE.MeshStandardMaterial, opts: SurfaceWeathering, grid: SolidCellGrid | null, lite = false) {
  const stain = new THREE.Color(opts.stain);
  const uniforms = {
    uStainColor: { value: stain },
    uStainStrength: { value: opts.stainStrength },
    uDamp: { value: opts.damp },
    uOcclusion: { value: grid ? opts.occlusion : 0 },
    uWallHeight: { value: grid?.wallHeight ?? 3.0 },
  };
  const kindDefine = opts.kind === "wall" ? "W_WALL" : opts.kind === "floor" ? "W_FLOOR" : "W_CEILING";

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (grid) Object.assign(shader.uniforms, grid.uniforms);
    shader.defines = { ...(shader.defines ?? {}), [kindDefine]: "", ...(grid ? { W_GRID: "" } : {}), ...(lite ? { W_LITE: "" } : {}) };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\nvarying float vWallV;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vWallV = uv.y;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vWallV;
        uniform vec3 uStainColor;
        uniform float uStainStrength;
        uniform float uDamp;
        uniform float uOcclusion;
        uniform float uWallHeight;
        ${NOISE_GLSL}
        #ifdef W_GRID
        ${OCCLUSION_GLSL}
        #endif`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec3 wN = normalize(vWorldNormal);
        // Surface-space coordinates in metres: walls run along whichever horizontal
        // axis they face across, floors and ceilings use the ground plane.
        #ifdef W_WALL
          vec2 wP = vec2(abs(wN.x) > 0.5 ? vWorldPos.z : vWorldPos.x, vWorldPos.y);
        #else
          vec2 wP = vWorldPos.xz;
        #endif
        float wMacro = wFbm(wP * 0.23 + 7.0);
        float wFine = wNoise(wP * 1.9);
        // Broad discolouration plus a slight per-patch brightness drift.
        diffuseColor.rgb *= mix(vec3(1.0), uStainColor, uStainStrength * smoothstep(0.42, 0.82, wMacro));
        diffuseColor.rgb *= 0.93 + 0.14 * wFine;
        float wDampMask = 0.0;
        #ifdef W_WALL
          // Height above this wall's own foot (its plane's V runs floor to
          // ceiling), so stacked garage floors weather like the ground floor.
          float wTop = uWallHeight;
          float wH = vWallV * wTop;
          // Damp wicking up from the carpet to an uneven tide line, darkest at the skirting.
          float wTide = 0.18 + 0.5 * wFbm(vec2(wP.x * 0.6, 3.1)) * smoothstep(0.3, 0.75, wMacro);
          wDampMask = 1.0 - smoothstep(wTide * 0.4, wTide, wH);
          float wTideLine = smoothstep(0.06, 0.0, abs(wH - wTide)) * step(0.22, wTide);
          // Leak streaks running down from the ceiling where it is wettest.
          float wStreak = smoothstep(0.62, 0.9, wNoise(vec2(wP.x * 5.0, 0.5)) * wMacro * 1.3)
            * smoothstep(wTop - 1.6 - wFine, wTop, wH);
          wDampMask = max(wDampMask, wStreak * 0.8);
          diffuseColor.rgb *= 1.0 - uDamp * (0.38 * wDampMask + 0.18 * wTideLine);
        #endif
        #ifdef W_CEILING
          // Tide rings left by old leaks: a dark band at the edge of each wet patch.
          float wRing = wFbm(wP * 0.45 + 31.0);
          float wBand = smoothstep(0.035, 0.0, abs(wRing - 0.66));
          wDampMask = smoothstep(0.64, 0.74, wRing);
          diffuseColor.rgb *= 1.0 - uDamp * (0.22 * wDampMask + 0.32 * wBand);
        #endif
        #ifdef W_FLOOR
          // Matted, wetter patches of carpet.
          wDampMask = smoothstep(0.55, 0.8, wFbm(wP * 0.31 + 11.0));
          diffuseColor.rgb *= 1.0 - uDamp * 0.3 * wDampMask;
        #endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        // Wet patches are glossier.
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uDamp * wDampMask);`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        {
          float wOcc = 0.0;
          #ifdef W_GRID
            wOcc = wGridOcclusion(vWorldPos.xz, wN);
            #ifdef W_WALL
              wOcc += wEdge(wH, 0.55) + wEdge(wTop - wH, 0.6);
            #endif
          #endif
          float wAO = 1.0 - uOcclusion * clamp(wOcc, 0.0, 1.6) / 1.6;
          reflectedLight.indirectDiffuse *= wAO;
          reflectedLight.indirectSpecular *= wAO;
          reflectedLight.directDiffuse *= mix(1.0, wAO, 0.45);
          reflectedLight.directSpecular *= mix(1.0, wAO, 0.45);
        }`,
      );
  };
  material.customProgramCacheKey = () => `weathering:${kindDefine}:${grid ? 1 : 0}:${lite ? 1 : 0}`;
  material.needsUpdate = true;
}
