import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import type { MobDefinition } from "./types";
import { hotelSightClear } from "../levels/hotelLayout";

/** Sparse low-flying moths: the existing 2D navigation drives a hovering rig. */
export const deathmoth: MobDefinition = {
  type: EntityType.DEATHMOTH, baseHeight: 1.9, baseSpeed: 0.45, bobFreq: 2.5, bobAmp: 0.22,
  strideLength: 1.2, stepWeight: 0, speechBubbleLocalY: 0.7, forcedChaseSpeed: 1.8, catchRadius: 0.75,
  build(c) {
    const body = c.smat("moth_body", () => new THREE.MeshStandardMaterial({ color: 0x29231c, roughness: 1 }));
    const wing = c.smat("moth_wing", () => new THREE.MeshStandardMaterial({ color: 0x7e735c, side: THREE.DoubleSide, roughness: 1 }));
    const torso = new THREE.Mesh(c.sgeo("moth_body", () => new THREE.SphereGeometry(0.18, 8, 6)), body); torso.scale.set(0.7, 0.7, 2); c.group.add(torso);
    for (const side of [-1, 1]) {
      const joint = c.joint(`wing${side}`, side * 0.1, 0, 0);
      const w = new THREE.Mesh(c.sgeo("moth_wing", () => new THREE.CircleGeometry(0.68, 7)), wing);
      w.rotation.x = -Math.PI / 2; w.position.set(side * 0.5, 0, 0); w.scale.set(1, 0.7, 1); joint.add(w);
      const spot = new THREE.Mesh(c.sgeo("moth_spot", () => new THREE.CircleGeometry(0.14, 10)), body);
      spot.rotation.x = -Math.PI / 2; spot.position.set(side * 0.54, 0.01, 0.04); joint.add(spot);
    }
  },
  sense(c) {
    const sees = c.distanceMeters < 6 && hotelSightClear(c.entityPos.x, c.entityPos.z, c.playerX, c.playerZ, (x, z) => c.map.hotel?.isBlocked(x, z) ?? false);
    const chasing = sees && (c.isFlashlightOn || c.distanceMeters < 2);
    return { chasing, speed: chasing ? 1.65 : 0.45 };
  },
  animate(c) { for (const side of [-1, 1]) c.joints[`wing${side}`].rotation.z = side * Math.sin(c.time * 23) * 0.75; },
  radar: { color: "#baa976", strokeColor: "#524327", labelKey: "hotel.deathmoth" },
};
