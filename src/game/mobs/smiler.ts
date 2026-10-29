import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { applyCreatureMaterial } from "./creatureMaterials";

let shared: { teeth: THREE.BufferGeometry; eye: THREE.BufferGeometry; cavity: THREE.BufferGeometry; enamel: THREE.Material; sclera: THREE.Material; dark: THREE.Material } | null = null;

function resources() {
  if (shared) return shared;
  const pieces: THREE.BufferGeometry[] = [];
  for (const row of [-1, 1]) for (let i = -7; i <= 7; i++) {
    const t = i / 7;
    const length = 0.09 + (1 - Math.abs(t)) * 0.035 + Math.sin(i * 4.7) * 0.012;
    const tooth = new THREE.SphereGeometry(1, 12, 10);
    tooth.scale(0.031 - Math.abs(t) * 0.006, length * 0.5, 0.036);
    tooth.rotateZ(-t * 0.45 + Math.sin(i * 2.3) * 0.05);
    tooth.translate(t * 0.49, -0.14 + t * t * 0.19 + row * (0.055 + (1 - Math.abs(t)) * 0.025), 0.12 - t * t * 0.08);
    pieces.push(tooth);
  }
  const teeth = mergeGeometries(pieces, false);
  pieces.forEach(p => p.dispose());
  const enamel = applyCreatureMaterial(new THREE.MeshStandardMaterial({ color: 0xe3d8b5, emissive: 0x9c9475, emissiveIntensity: 0.38, roughness: 0.27 }), "smiler_teeth");
  shared = {
    teeth, eye: new THREE.SphereGeometry(0.082, 24, 16), cavity: new THREE.SphereGeometry(1, 24, 16), enamel,
    sclera: new THREE.MeshStandardMaterial({ color: 0xe8dfca, emissive: 0xb2ab93, emissiveIntensity: 0.55, roughness: 0.16 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  };
  return shared;
}

/** Three-dimensional face, no billboard quad and no additive glow rectangle. */
export function createSmiler(): THREE.Group {
  const r = resources(), group = new THREE.Group();
  group.name = "smiler";
  const mouth = new THREE.Mesh(r.cavity, r.dark);
  mouth.scale.set(0.5, 0.15, 0.08); mouth.position.set(0, -0.08, 0);
  group.add(mouth, new THREE.Mesh(r.teeth, r.enamel));
  for (const side of [-1, 1]) {
    const eye = new THREE.Group(); eye.name = `eye${side}`;
    eye.position.set(side * 0.25, 0.25 + side * 0.013, 0.02);
    const globe = new THREE.Mesh(r.eye, r.sclera); globe.scale.set(1, 0.84, 0.75);
    const pupil = new THREE.Mesh(r.eye, r.dark); pupil.scale.set(0.28, 0.48, 0.16); pupil.position.z = 0.059;
    eye.add(globe, pupil); group.add(eye);
  }
  return group;
}

export function animateSmiler(group: THREE.Group, time: number, seed: number) {
  for (const side of [-1, 1]) {
    const eye = group.getObjectByName(`eye${side}`)!;
    const blink = Math.pow(Math.max(0, Math.sin(time * 0.61 + seed * 1.71 + side * 0.09)), 64);
    eye.scale.y = 1 - blink * 0.88;
  }
}

export function disposeSmilerAssets() {
  if (!shared) return;
  Object.values(shared).forEach(resource => resource.dispose());
  shared = null;
}
