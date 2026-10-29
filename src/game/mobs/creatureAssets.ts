import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { bodyNodes } from "./buildContext";
import type { EntityType } from "../../shared/entityTypes";
import { getQualityProfile, type QualityLevel } from "../Quality";

interface AssetEntry { promise: Promise<THREE.Group | null>; template?: THREE.Group; users: number }
interface Binding {
  update(distance?: number): void;
  release(): void;
}
const cache = new Map<EntityType, AssetEntry>();
let quality = getQualityProfile("medium");
let generation = 0;

export function setCreatureAssetQuality(value: QualityLevel) { quality = getQualityProfile(value); }

function disposeTemplate(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), skeletons = new Set<THREE.Skeleton>();
  root.traverse(o => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
    }
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); skeletons.forEach(s => s.dispose());
}

function entryFor(type: EntityType): AssetEntry {
  const existing = cache.get(type);
  if (existing) { cache.delete(type); cache.set(type, existing); return existing; }
  const epoch = generation;
  const entry: AssetEntry = { users: 0, promise: Promise.resolve(null) };
  entry.promise = new GLTFLoader().loadAsync(`/assets/mobs/${type.toLowerCase()}.glb`).then(gltf => {
    if (epoch !== generation || cache.get(type) !== entry) { disposeTemplate(gltf.scene); return null; }
    const root = gltf.scene.children[0] as THREE.Group;
    if (root?.userData.schema !== 1) { disposeTemplate(gltf.scene); throw new Error("Unsupported creature asset schema"); }
    entry.template = root;
    return root;
  }).catch(error => {
    // Keep the complete procedural body on failure: a failed download must never hide a threat.
    console.warn(`[Creatures] ${type}: keeping fallback body`, error);
    return null;
  });
  cache.set(type, entry);
  return entry;
}

/** Keep a small warm set across level changes; never evict an active skin or creature. */
function trimCache() {
  for (const [type, entry] of cache) {
    if (cache.size <= 8) break;
    if (entry.users !== 0) continue;
    if (entry.template) disposeTemplate(entry.template);
    cache.delete(type);
  }
}

export function preloadCreatureAssets(types: Iterable<EntityType>): Promise<void> {
  return Promise.all(Array.from(new Set(types), type => entryFor(type).promise)).then(() => {});
}

/** Called after level entities and cosmetic users have been released. Late loads cannot resurrect a cache. */
export function disposeCreatureAssets() {
  generation++;
  for (const entry of cache.values()) if (entry.template) disposeTemplate(entry.template);
  cache.clear();
}

/** Attaches compiled skin while retaining the original rig as the animation/state driver. */
export function attachCreatureAsset(body: THREE.Group, type: EntityType): void {
  const source = bodyNodes(body);
  const originalMeshes: THREE.Mesh[] = [];
  const originalVisibility = new Map<THREE.Mesh, boolean>();
  const materials: THREE.Material[] = [];
  for (const o of source.values()) if (o instanceof THREE.Mesh) {
    originalMeshes.push(o); originalVisibility.set(o, o.visible);
    const mat = o.material as THREE.Material;
    if (!materials.includes(mat)) materials.push(mat);
  }
  const entry = entryFor(type);
  entry.users++;
  let released = false, asset: THREE.Group | null = null;
  let pairs: [THREE.Bone, THREE.Object3D][] = [];
  let surfaces: { mesh: THREE.SkinnedMesh; lod: number; gate?: THREE.Object3D }[] = [];
  let selectedLod = -1;
  const binding: Binding = {
    update(distance = 0) {
      if (!asset || released) return;
      // Hysteresis prevents a model from alternating detail at a distance boundary.
      const bias = quality.creatureLodBias;
      const near = quality.creatureNearDistance, far = quality.creatureFarDistance;
      let lod = distance > far ? 2 : distance > near ? 1 : 0;
      lod = Math.min(2, lod + bias);
      if (selectedLod < 0 || lod < selectedLod || distance > (selectedLod === 0 ? near + 1 : far + 2) || bias > 0) selectedLod = lod;
      for (const [bone, driver] of pairs) {
        bone.position.copy(driver.position); bone.quaternion.copy(driver.quaternion); bone.scale.copy(driver.scale);
      }
      for (const { mesh, lod: meshLod, gate } of surfaces) mesh.visible = meshLod === selectedLod && (!gate || gate.visible);
    },
    release() {
      if (released) return;
      released = true;
      entry.users--;
      if (asset) {
        const skeletons = new Set(surfaces.map(s => s.mesh.skeleton));
        skeletons.forEach(s => s.dispose());
        body.remove(asset);
      }
      originalVisibility.forEach((v, m) => { m.visible = v; });
      pairs = []; surfaces = [];
      delete body.userData.creatureAsset;
      trimCache();
    },
  };
  body.userData.creatureAsset = binding;
  void entry.promise.then(template => {
    if (!template || released) return;
    const names = template.userData.materials as string[];
    if (names.length !== materials.length || names.some((name, i) => name !== materials[i].name)) {
      console.warn(`[Creatures] ${type}: asset/material layout changed; rebuild with npm run assets:mobs`);
      return;
    }
    asset = clone(template) as THREE.Group;
    asset.name = "creatureAsset";
    let valid = true;
    let instanceSkeleton: THREE.Skeleton | undefined;
    asset.traverse(o => {
      if (o instanceof THREE.Bone && o.userData.driver !== "body") {
        const driver = source.get(o.userData.driver);
        if (driver) pairs.push([o, driver]); else valid = false;
      }
      if (o instanceof THREE.SkinnedMesh) {
        // SkeletonUtils clones per mesh. This asset uses one rig, so one GPU
        // bone texture per instance is sufficient across all surfaces and LODs.
        if (!instanceSkeleton) instanceSkeleton = o.skeleton;
        else if (o.skeleton !== instanceSkeleton) { o.skeleton.dispose(); o.skeleton = instanceSkeleton; }
        o.material = materials[o.userData.materialIndex];
        o.castShadow = true; o.receiveShadow = true;
        // A bind-pose box is wrong for reaching fingers. Distances/LOD bound the cost instead.
        o.frustumCulled = false;
        const gate = o.userData.visibility ? source.get(o.userData.visibility) : undefined;
        if (o.userData.visibility && !gate) valid = false;
        surfaces.push({ mesh: o, lod: o.userData.lod, gate });
      }
    });
    if (!valid) { binding.release(); return; }
    originalMeshes.forEach(m => { m.visible = false; });
    body.add(asset);
    binding.update();
  });
}

export function updateCreatureAsset(body: THREE.Group, distance = 0) {
  (body.userData.creatureAsset as Binding | undefined)?.update(distance);
}

export function releaseCreatureAsset(body: THREE.Group) {
  (body.userData.creatureAsset as Binding | undefined)?.release();
}
