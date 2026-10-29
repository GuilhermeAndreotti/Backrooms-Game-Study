import * as THREE from "three";
import { roundedLimbGeometry } from "./creatureSkin";
import type { MobBuildCtx } from "./types";

/** Shared by the runtime and the offline asset compiler. Coordinates stay in body space. */
export function createMobBuildContext(
  group: THREE.Group,
  cache: Pick<MobBuildCtx, "sgeo" | "smat" | "addTintMaterial" | "setCalmHostileEyes" | "setKingEyeMaterial">,
): MobBuildCtx {
  const origin = (o: THREE.Object3D) => {
    const v = new THREE.Vector3();
    for (let n: THREE.Object3D | null = o; n && n !== group; n = n.parent) v.add(n.position);
    return v;
  };
  const limbBetween: MobBuildCtx["limbBetween"] = (mat, a, b, radius, taper = 0.75) => {
    const dir = b.clone().sub(a);
    const cm = Math.max(1, Math.round(dir.length() * 100));
    const geo = cache.sgeo(`limb_${radius}_${taper}_${cm}`, () => roundedLimbGeometry(radius, taper, cm / 100));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.castShadow = true;
    return mesh;
  };
  const ctx: MobBuildCtx = {
    ...cache, group, joints: {}, limbBetween,
    V: (x, y, z) => new THREE.Vector3(x, y, z),
    smat: (key, build) => {
      const mat = cache.smat(key, build);
      mat.name = key;
      return mat;
    },
    setCalmHostileEyes: (calm, hostile) => {
      calm.userData.visualSwitch = hostile.userData.visualSwitch = true;
      cache.setCalmHostileEyes(calm, hostile);
    },
    joint: (name, x, y, z, parent = group) => {
      const joint = new THREE.Group();
      joint.name = name;
      joint.position.set(x, y, z).sub(origin(parent));
      joint.userData.rest = joint.position.clone();
      parent.add(joint);
      ctx.joints[name] = joint;
      return joint;
    },
    limbIn: (joint, mat, a, b, radius, taper) => {
      const o = origin(joint);
      const mesh = limbBetween(mat, a.clone().sub(o), b.clone().sub(o), radius, taper);
      joint.add(mesh);
      return mesh;
    },
    put: (joint, obj) => {
      obj.position.sub(origin(joint));
      joint.add(obj);
      return obj;
    },
  };
  return ctx;
}

/** Stable paths, including invisible groups; shared by compiler and asset attachment. */
export function bodyNodes(body: THREE.Group): Map<string, THREE.Object3D> {
  const nodes = new Map<string, THREE.Object3D>();
  const visit = (node: THREE.Object3D, path: string) => {
    nodes.set(path, node);
    node.children.forEach((child, i) => visit(child, `${path}/${i}`));
  };
  visit(body, "body");
  return nodes;
}
