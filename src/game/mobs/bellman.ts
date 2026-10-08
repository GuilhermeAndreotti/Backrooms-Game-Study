import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import type { MobDefinition } from "./types";
import { hotelSightClear } from "../levels/hotelLayout";

/** The hotel employee never breaks into the game's generic sprint-chase. */
export const bellman: MobDefinition = {
  type: EntityType.BELLMAN, baseSpeed: 0.7, baseHeight: 1.05, strideLength: 1.6, stepWeight: 0.45,
  bobFreq: 2, bobAmp: 0.015, speechBubbleLocalY: 1.6, forcedChaseSpeed: 1.7,
  calmIgnoresViewer: true, catchRadius: 1.05,
  build(c) {
    const cloth = c.smat("bellman_cloth", () => new THREE.MeshStandardMaterial({ color: 0x591921, roughness: 0.88 }));
    const black = c.smat("bellman_black", () => new THREE.MeshStandardMaterial({ color: 0x090708, roughness: 0.8 }));
    const gold = c.smat("bellman_gold", () => new THREE.MeshStandardMaterial({ color: 0xc7a255, metalness: 0.7, roughness: 0.3 }));
    const skin = c.smat("bellman_skin", () => new THREE.MeshStandardMaterial({ color: 0xaba38f, roughness: 0.9 }));
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z = 0) => {
      const o = new THREE.Mesh(c.sgeo(`bellman_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); return o;
    };
    c.group.add(box(0.55, 0.8, 0.32, cloth, 0, 0.2));
    c.group.add(box(0.58, 0.06, 0.35, gold, 0, -0.12));
    for (const x of [-0.11, 0.11]) for (const y of [0.02, 0.19, 0.36, 0.53]) c.group.add(box(0.045, 0.045, 0.035, gold, x, y, 0.18));
    for (const side of [-1, 1]) {
      const leg = c.joint(`leg${side}`, side * 0.15, -0.2, 0);
      c.put(leg, box(0.19, 0.8, 0.23, black, side * 0.15, -0.62));
      c.put(leg, box(0.23, 0.12, 0.37, black, side * 0.15, -0.99, 0.06));
      const arm = c.joint(`arm${side}`, side * 0.35, 0.48, 0);
      c.put(arm, box(0.17, 0.72, 0.2, cloth, side * 0.35, 0.13));
      c.put(arm, box(0.17, 0.07, 0.22, gold, side * 0.35, -0.18));
      c.put(arm, box(0.13, 0.2, 0.15, skin, side * 0.35, -0.3));
    }
    const head = c.joint("head", 0, 0.72, 0);
    c.put(head, box(0.3, 0.4, 0.29, skin, 0, 0.8));
    c.put(head, box(0.25, 0.08, 0.015, black, 0, 0.85, 0.151));
    c.put(head, box(0.13, 0.025, 0.02, black, 0, 0.69, 0.151));
    c.put(head, box(0.4, 0.2, 0.38, cloth, 0, 1.07));
    c.put(head, box(0.41, 0.035, 0.4, gold, 0, 0.99));
  },
  sense(c) {
    const hotel = c.map.hotel;
    const seeing = hotelSightClear(c.entityPos.x, c.entityPos.z, c.playerX, c.playerZ, (x, z) => hotel?.isBlocked(x, z) ?? false);
    const mode = hotel?.bellmanMode ?? 0;
    return { chasing: mode === 2 && seeing, speed: mode === 0 ? 0 : mode === 2 ? 1.7 : 0.65, agitated: mode === 2, pose: mode };
  },
  animate(c) {
    for (const side of [-1, 1]) {
      c.joints[`leg${side}`].rotation.x = Math.sin(c.phase) * c.move * 0.35 * side;
      c.joints[`arm${side}`].rotation.x = -Math.sin(c.phase) * c.move * 0.18 * side;
    }
    c.joints.head.rotation.y = c.lookYaw * 0.4;
    c.joints.head.rotation.z = c.chasing ? -0.12 : 0.025;
  },
  radar: { color: "#a76a48", strokeColor: "#5b1c23", labelKey: "hotel.bellman" },
};
