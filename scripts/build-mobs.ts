/** Offline, deterministic GLB compiler. Generated files ship with the game; never run on a client. */
import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer";
import { MeshBVH } from "three-mesh-bvh";
import { createMobBuildContext, bodyNodes } from "../src/game/mobs/buildContext";
import { creatureSurface } from "../src/game/mobs/surfaceProfile";

// Only the builders' painted faces/badges need a canvas. No WebGL or browser in this build.
Object.assign(globalThis, {
  document: { createElement: (tag: string) => {
    if (tag !== "canvas") throw new Error(`Unexpected DOM dependency: ${tag}`);
    return createCanvas(1, 1);
  } },
  FileReader: class {
    result: ArrayBuffer | null = null;
    onloadend?: () => void;
    async readAsArrayBuffer(blob: Blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  },
});

const { MOB_DEFS } = await import("../src/game/mobs/registry");
await MeshoptSimplifier.ready;
await mkdir("public/assets/mobs", { recursive: true });
const requested = process.argv.slice(2);
const report: Record<string, unknown> = {};

/** Taubin smoothing removes voxel stair steps without shrinking thin fingers away. */
function smooth(geo: THREE.BufferGeometry) {
  const p = geo.getAttribute("position").array as Float32Array;
  const ix = geo.index!.array;
  const neighbors = Array.from({ length: p.length / 3 }, () => new Set<number>());
  for (let i = 0; i < ix.length; i += 3) {
    const [a, b, c] = [ix[i], ix[i + 1], ix[i + 2]];
    neighbors[a].add(b).add(c); neighbors[b].add(a).add(c); neighbors[c].add(a).add(b);
  }
  const out = new Float32Array(p.length);
  for (const strength of [0.45, -0.47, 0.45, -0.47]) {
    neighbors.forEach((ns, i) => {
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (const n of ns) sum += p[n * 3 + axis];
        out[i * 3 + axis] = p[i * 3 + axis] + strength * (sum / Math.max(1, ns.size) - p[i * 3 + axis]);
      }
    });
    p.set(out);
  }
}

function compact(geo: THREE.BufferGeometry, indices: Uint32Array) {
  const remap = new Map<number, number>();
  for (const i of indices) if (!remap.has(i)) remap.set(i, remap.size);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const values: number[] = [];
    for (const old of remap.keys()) for (let k = 0; k < attr.itemSize; k++) values.push(attr.array[old * attr.itemSize + k]);
    out.setAttribute(name, name === "skinIndex" ? new THREE.Uint16BufferAttribute(values, attr.itemSize) : new THREE.Float32BufferAttribute(values, attr.itemSize));
  }
  out.setIndex(Array.from(indices, i => remap.get(i)!));
  out.computeBoundingSphere();
  return out;
}

for (const def of Object.values(MOB_DEFS)) {
  if (requested.length && !requested.includes(def.type)) continue;
  const body = new THREE.Group();
  const geos = new Map<string, THREE.BufferGeometry>(), mats = new Map<string, THREE.Material>();
  const ctx = createMobBuildContext(body, {
    sgeo: (key, build) => { if (!geos.has(key)) geos.set(key, build()); return geos.get(key) as ReturnType<typeof build>; },
    smat: (key, build) => { if (!mats.has(key)) mats.set(key, build()); return mats.get(key) as ReturnType<typeof build>; },
    addTintMaterial: m => { m.name ||= `${def.type.toLowerCase()}_body`; },
    setCalmHostileEyes: () => {}, setKingEyeMaterial: m => { m.name = "king2_eye"; },
  });
  def.build(ctx);
  body.updateMatrixWorld(true);
  const nodes = bodyNodes(body);
  const paths = new Map(Array.from(nodes, ([p, n]) => [n, p]));
  const root = new THREE.Group();
  root.name = def.type;
  root.userData.schema = 1;
  const bones: THREE.Bone[] = [], boneIds = new Map<THREE.Object3D, number>();
  for (const [path, node] of nodes) {
    if (node instanceof THREE.Mesh) continue;
    const bone = new THREE.Bone();
    bone.name = `rig_${bones.length}`;
    bone.userData.driver = path;
    bone.position.copy(node.position); bone.quaternion.copy(node.quaternion); bone.scale.copy(node.scale);
    if (node === body) bone.position.set(0, 0, 0);
    const parent = boneIds.get(node.parent!);
    (parent === undefined ? root : bones[parent]).add(bone);
    boneIds.set(node, bones.length); bones.push(bone);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const materials: THREE.Material[] = [];
  const buckets = new Map<string, { material: number; visibility: string | null; parts: THREE.BufferGeometry[] }>();
  for (const node of nodes.values()) {
    if (!(node instanceof THREE.Mesh)) continue;
    const mat = node.material as THREE.Material;
    if (Array.isArray(mat)) throw new Error("Compiler expects one material per source part");
    if (!materials.includes(mat)) materials.push(mat);
    const material = materials.indexOf(mat);
    let visibility: string | null = null;
    for (let p = node.parent; p && p !== body; p = p.parent) {
      if (p.userData.visualSwitch || !p.visible) visibility = paths.get(p)!;
    }
    const key = `${material}:${visibility}`;
    if (!buckets.has(key)) buckets.set(key, { material, visibility, parts: [] });
    let geo = node.geometry.clone();
    if (geo.index) { const flat = geo.toNonIndexed(); geo.dispose(); geo = flat; }
    geo.applyMatrix4(node.matrixWorld);
    const count = geo.getAttribute("position").count;
    // Only these attributes are needed to transport UV artwork and the original rig.
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "uv") geo.deleteAttribute(name);
    if (!geo.hasAttribute("uv")) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    geo.setAttribute("owner", new THREE.Float32BufferAttribute(new Float32Array(count).fill(boneIds.get(node.parent!) ?? 0), 1));
    buckets.get(key)!.parts.push(geo);
  }
  root.userData.materials = materials.map(m => m.name);
  const totals = [0, 0, 0];
  const sourceSize = Array.from(buckets.values()).reduce((sum, b) => sum + b.parts.reduce((n, g) => n + g.getAttribute("position").count, 0), 0);
  for (const { material, visibility, parts } of buckets.values()) {
    const source = mergeGeometries(parts, false);
    parts.forEach(p => p.dispose());
    const positions = source.getAttribute("position").array as Float32Array;
    const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
    source.setIndex(new THREE.BufferAttribute(indices, 1));
    const mat = materials[material];
    const kind = creatureSurface(mat.name);
    // Garments include open lathe shells. Solid remeshing would punch holes in
    // those surfaces; preserve their topology and UVs instead of treating them as volumes.
    const canFuse = ["skin", "flesh", "rubber", "chitin"].includes(kind) && (!(mat as THREE.MeshStandardMaterial).map || /^king2_(skin|knuckle)$/.test(mat.name)) && positions.length > 1500 && mat.name !== "vigia_limb";
    let geo: THREE.BufferGeometry;
    if (canFuse) {
      const resolution = 256;
      const surface = MeshoptSimplifier.remesh(indices, positions, 3, resolution, ["Solve"]);
      if (!surface.length) throw new Error(`Empty remesh: ${def.type}/${mat.name}`);
      const raw = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(surface, 3));
      geo = mergeVertices(raw, 0.00002); raw.dispose(); smooth(geo);
    } else {
      geo = source.clone(); geo.deleteAttribute("owner");
      geo = mergeVertices(geo, 0.00002);
    }
    // Preserve UVs on artwork, and transfer each surface point to its closest original bone.
    const bvh = new MeshBVH(source, { indirect: true });
    const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), bary = new THREE.Vector3();
    const owners = source.getAttribute("owner"), uv = source.getAttribute("uv");
    const weights: number[] = [], joints: number[] = [], uvs: number[] = [];
    const pos = geo.getAttribute("position");
    const boneOrigins = bones.map(bone => bone.getWorldPosition(new THREE.Vector3()));
    const drivers = Array.from(boneIds.keys());
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const hit = bvh.closestPointToPoint(p)!;
      const index = hit.faceIndex * 3;
      const ia = indices[index], ib = indices[index + 1], ic = indices[index + 2];
      const owner = owners.getX(ia);
      const driver = drivers[owner];
      const parent = boneIds.get(driver.parent!);
      // Smooth joints only near their hinge; eyes, jaws, crowns and rigid accessories stay rigid.
      const flexible = canFuse && /^(arm|fore|leg|shin|tail|spike|tip)/.test(driver.name) && parent !== undefined;
      const influence = flexible ? 0.5 * Math.max(0, 1 - p.distanceTo(boneOrigins[owner]) / 0.055) : 0;
      joints.push(owner, parent ?? owner, 0, 0); weights.push(1 - influence, influence, 0, 0);
      THREE.Triangle.getBarycoord(hit.point, a.fromArray(positions, ia * 3), b.fromArray(positions, ib * 3), c.fromArray(positions, ic * 3), bary);
      uvs.push(uv.getX(ia) * bary.x + uv.getX(ib) * bary.y + uv.getX(ic) * bary.z, uv.getY(ia) * bary.x + uv.getY(ib) * bary.y + uv.getY(ic) * bary.z);
    }
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
    geo.computeVertexNormals();
    const all = new Uint32Array(geo.index!.array);
    for (let lod = 0; lod < 3; lod++) {
      const budget = [42000, 16000, 5500][lod] * (positions.length / 3 / sourceSize);
      const target = Math.min(all.length, Math.max(12, Math.floor(budget) * 3));
      const [reduced] = MeshoptSimplifier.simplify(all, pos.array as Float32Array, 3, target, 0.1, ["LockBorder"]);
      const geometry = compact(geo, reduced);
      const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
      mesh.name = `surface_${material}_${lod}_${visibility ?? "body"}`;
      mesh.userData = { materialIndex: material, visibility, lod };
      root.add(mesh); mesh.bind(skeleton, new THREE.Matrix4());
      totals[lod] += reduced.length / 3;
    }
    source.dispose(); geo.dispose();
  }
  const output = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false }) as ArrayBuffer;
  await writeFile(`public/assets/mobs/${def.type.toLowerCase()}.glb`, Buffer.from(output));
  report[def.type] = { bytes: output.byteLength, triangles: totals, bones: bones.length, surfaces: buckets.size };
  console.log(def.type, report[def.type]);
}
if (!requested.length) await writeFile("public/assets/mobs/manifest.json", JSON.stringify({ schema: 1, generator: "build-mobs.ts", creatures: report }, null, 2) + "\n");
