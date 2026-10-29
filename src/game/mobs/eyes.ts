import * as THREE from "three";
import type { MobBuildCtx } from "./types";

/** A recessed iris and pupil under a glossy sclera; no light source attached to an eye. */
export function anatomicalEye(ctx: Pick<MobBuildCtx, "sgeo" | "smat" | "put">, parent: THREE.Object3D, center: THREE.Vector3, radius: number, color: number, direction = new THREE.Vector3(0, 0, 1)): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(center);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
  const sphere = ctx.sgeo("anatomical_eye_sphere", () => new THREE.SphereGeometry(1, 24, 16));
  const sclera = ctx.smat("anatomical_eye_sclera", () => new THREE.MeshStandardMaterial({ color: 0xbab09b, roughness: 0.18 }));
  const iris = ctx.smat(`anatomical_eye_iris_${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.22 }));
  const pupil = ctx.smat("anatomical_eye_pupil", () => new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 0.1 }));
  const globe = new THREE.Mesh(sphere, sclera); globe.scale.setScalar(radius);
  const ring = new THREE.Mesh(sphere, iris); ring.scale.set(radius * 0.52, radius * 0.52, radius * 0.13); ring.position.z = radius * 0.9;
  const hole = new THREE.Mesh(sphere, pupil); hole.scale.set(radius * 0.21, radius * 0.3, radius * 0.05); hole.position.z = radius * 1.015;
  group.add(globe, ring, hole);
  ctx.put(parent, group);
  return group;
}
