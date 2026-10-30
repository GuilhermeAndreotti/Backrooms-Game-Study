import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SuperGuardRenderer } from "./SuperGuard";

const frame = (z = 12, level = 0) => ({ targetId: "afk", level, x: 0, y: 1.7, z });

test("20Hz snapshots produce comparable motion and poses at 30/60/120 FPS", () => {
  const poses = [30, 60, 120].map(fps => {
    const renderer = new SuperGuardRenderer(), scene = new THREE.Scene();
    renderer.apply([frame()]);
    for (let i = 0; i < fps * 2; i++) {
      const snapshotTime = Math.floor(i / fps * 20) / 20;
      renderer.apply([frame(12 - snapshotTime * 4)]);
      renderer.update(scene, 0, 1 / fps, () => ({ x: 0, y: 1.7, z: 0 }));
    }
    const transforms: number[] = [];
    scene.children[0].traverse(node => transforms.push(node.position.y, node.rotation.x, node.rotation.y, node.rotation.z));
    const z = scene.children[0].position.z;
    renderer.dispose();
    return { transforms, z };
  });
  for (const pose of poses) {
    assert.ok(Math.abs(pose.z - poses[1].z) < 0.15);
    pose.transforms.forEach((value, i) => assert.ok(Math.abs(value - poses[1].transforms[i]) < 0.25));
  }
});

test("level changes and suspended tabs snap without producing a huge stride", () => {
  const renderer = new SuperGuardRenderer(), scene = new THREE.Scene();
  renderer.apply([frame()]);
  renderer.update(scene, 0, 1 / 60);
  renderer.apply([frame(200, 6)]);
  renderer.update(scene, 0, 1 / 60);
  assert.equal(scene.children[0].visible, false);
  renderer.update(scene, 6, 1 / 60);
  assert.equal(scene.children[0].position.z, 200);
  renderer.apply([frame(195, 6)]);
  renderer.update(scene, 6, 5);
  assert.equal(scene.children[0].position.z, 195);
  scene.children[0].traverse(node => {
    assert.ok(Number.isFinite(node.rotation.x));
    assert.ok(Math.abs(node.rotation.x) < 0.5);
  });
  renderer.dispose();
});

test("removing one guard disposes only its glow and preserves other guards", () => {
  const renderer = new SuperGuardRenderer(), scene = new THREE.Scene();
  renderer.apply([frame(), { ...frame(), targetId: "other" }]);
  renderer.update(scene, 0, 1 / 60);
  const materials = new Set<THREE.Material>();
  scene.children[0].traverse(node => {
    if (node instanceof THREE.Mesh) materials.add(node.material);
  });
  let disposed = 0;
  materials.forEach(material => material.addEventListener("dispose", () => disposed++));
  renderer.apply([{ ...frame(), targetId: "other" }]);
  assert.equal(disposed, 1);
  assert.equal(scene.children.length, 1);
  renderer.update(scene, 0, 1 / 60);
  renderer.dispose();
  assert.equal(disposed, 2);
  assert.equal(scene.children.length, 0);
});
