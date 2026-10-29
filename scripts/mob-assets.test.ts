import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EntityType } from "../src/shared/entityTypes";

const root = new URL("../public/assets/mobs/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

test("every network entity has a shipped GLB", () => {
  assert.deepEqual(Object.keys(manifest.creatures).sort(), Object.values(EntityType).sort());
});

for (const type of Object.values(EntityType)) test(`${type}: bounded geometry, valid skin and all three LODs`, async () => {
  const file = await readFile(new URL(`${type.toLowerCase()}.glb`, root));
  assert.equal(file.readUInt32LE(0), 0x46546c67);
  assert.equal(file.readUInt32LE(4), 2);
  assert.equal(file.readUInt32LE(8), file.length);
  const jsonSize = file.readUInt32LE(12);
  const gltf = JSON.parse(file.toString("utf8", 20, 20 + jsonSize));
  const binary = file.subarray(20 + jsonSize + 8);
  const readAccessor = (index: number): number[] => {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    assert.ok(size);
    const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    assert.ok(bytes);
    const values: number[] = [];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) {
      const offset = (view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || size * bytes) + k * bytes;
      const v = a.componentType === 5126 ? binary.readFloatLE(offset) : binary.readUIntLE(offset, bytes);
      assert.ok(Number.isFinite(v), "finite accessor values"); values.push(v);
    }
    return values;
  };
  const totals = [0, 0, 0];
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    assert.ok([0, 1, 2].includes(node.extras.lod));
    const skin = gltf.skins[node.skin]; assert.ok(skin);
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const a = primitive.attributes;
      const positions = readAccessor(a.POSITION), joints = readAccessor(a.JOINTS_0), weights = readAccessor(a.WEIGHTS_0);
      const indices = readAccessor(primitive.indices);
      assert.equal(joints.length, positions.length / 3 * 4);
      assert.equal(weights.length, joints.length);
      for (const j of joints) assert.ok(j >= 0 && j < skin.joints.length);
      for (let i = 0; i < weights.length; i += 4) {
        assert.ok(weights.slice(i, i + 4).every(w => w >= 0 && w <= 1));
        assert.ok(Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1) < 0.0001);
      }
      for (const index of indices) assert.ok(index >= 0 && index < positions.length / 3);
      totals[node.extras.lod] += indices.length / 3;
    }
  }
  assert.deepEqual(totals, manifest.creatures[type].triangles);
  assert.ok(totals[0] <= 50000 && totals[0] >= totals[1] && totals[1] >= totals[2] && totals[2] > 0);
  assert.equal(file.length, manifest.creatures[type].bytes);
});
