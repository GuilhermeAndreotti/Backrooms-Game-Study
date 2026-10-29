import * as THREE from "three";
import { CREATURE_COLORS, creatureSurface, SURFACE_SCALE, type CreatureSurface } from "./surfaceProfile";
import { getQualityProfile, type QualityLevel } from "../Quality";

const maps = new Map<CreatureSurface, { color: THREE.Texture; surface: THREE.Texture }>();
const detail = { value: 1 };
let anisotropy = 4;

function textures(kind: CreatureSurface) {
  let pair = maps.get(kind);
  if (pair) return pair;
  const loader = new THREE.TextureLoader();
  const load = (suffix: string, color: boolean) => {
    const texture = loader.load(`/assets/mobs/textures/${kind}-${suffix}.png`);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
  };
  pair = { color: load("color", true), surface: load("surface", false) };
  maps.set(kind, pair);
  return pair;
}

export function setCreatureMaterialQuality(quality: QualityLevel) {
  const profile = getQualityProfile(quality);
  detail.value = profile.creatureRelief;
  anisotropy = profile.anisotropy;
  for (const pair of maps.values()) for (const texture of Object.values(pair)) {
    if (texture.anisotropy === anisotropy) continue;
    texture.anisotropy = anisotropy;
    // Pending TextureLoader images will upload with this value on completion.
    if (texture.image) texture.needsUpdate = true;
  }
}

export function disposeCreatureTextures() {
  for (const pair of maps.values()) { pair.color.dispose(); pair.surface.dispose(); }
  maps.clear();
}

/** Rest-space triplanar PBR detail. Skinning happens AFTER sampling coordinates are captured. */
export function applyCreatureMaterial<T extends THREE.Material>(material: T, name: string): T {
  material.name = name;
  if (!(material instanceof THREE.MeshStandardMaterial) || material.userData.creaturePBR) return material;
  material.userData.creaturePBR = true;
  const kind = creatureSurface(name);
  if (CREATURE_COLORS[name] !== undefined) material.color.setHex(CREATURE_COLORS[name]);
  if (/eye/.test(name)) {
    material.roughness = 0.16;
    material.metalness = 0;
    material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.28);
  }
  if (kind === "none") return material;
  if (kind !== "chitin") material.metalness = 0;
  if (kind === "cloth") material.roughness = 0.95;
  // Existing authored faces, pinstripes and badges keep their UV colour artwork.
  const useColor = !material.map;
  const pair = textures(kind);
  // Height is in metres: pores are sub-millimetre, not centimetre-scale craters.
  const relief = kind === "cloth" ? 0.00035 : kind === "bone" ? 0.0002 : 0.00065;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.creatureColor = { value: pair.color };
    shader.uniforms.creatureSurface = { value: pair.surface };
    shader.uniforms.creatureDetail = detail;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
      varying vec3 vCreatureRest;
      varying vec3 vCreatureNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
      vCreatureRest = position * ${SURFACE_SCALE[kind].toFixed(2)};
      vCreatureNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform sampler2D creatureColor;
      uniform sampler2D creatureSurface;
      uniform float creatureDetail;
      varying vec3 vCreatureRest;
      varying vec3 vCreatureNormal;
      vec4 creatureSample(sampler2D tex, vec3 p, vec3 w) {
        return texture2D(tex, p.yz) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z;
      }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
      vec3 creatureWeights = pow(abs(normalize(vCreatureNormal)), vec3(6.0));
      creatureWeights /= max(dot(creatureWeights, vec3(1.0)), 0.0001);
      vec3 creatureData = creatureSample(creatureSurface, vCreatureRest, creatureWeights).rgb;
      ${useColor ? "diffuseColor.rgb *= creatureSample(creatureColor, vCreatureRest, creatureWeights).rgb * 1.45;" : ""}
      diffuseColor.rgb *= mix(0.8, 1.0, creatureData.b);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * mix(0.55, 1.1, creatureData.r), 0.13, 1.0);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      {
        vec3 cx = dFdx(-vViewPosition), cy = dFdy(-vViewPosition);
        vec3 cr1 = cross(cy, normal), cr2 = cross(normal, cx);
        float cd = dot(cx, cr1);
        vec3 cg = sign(cd) * (dFdx(creatureData.g) * cr1 + dFdy(creatureData.g) * cr2);
        normal = normalize(max(abs(cd), 0.00000001) * normal - cg * ${relief} * creatureDetail);
      }`);
  };
  material.customProgramCacheKey = () => `creature-pbr-2:${kind}:${useColor}`;
  material.needsUpdate = true;
  return material;
}
