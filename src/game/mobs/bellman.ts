import * as THREE from "three";
import { bake, hand } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import type { MobDefinition } from "./types";
import { hotelSightClear } from "../levels/hotelLayout";

/** The hotel employee never breaks into the game's generic sprint-chase. */
export const bellman: MobDefinition = {
  type: EntityType.BELLMAN, baseSpeed: 0.7, baseHeight: 1.05, strideLength: 1.6, stepWeight: 0.45,
  bobFreq: 2, bobAmp: 0.015, speechBubbleLocalY: 1.6, forcedChaseSpeed: 1.7,
  calmIgnoresViewer: true, catchRadius: 1.05,
  build(c) {
    const V = c.V;
    const cloth = c.smat("bellman_cloth", () => new THREE.MeshStandardMaterial({ color: 0x591921, roughness: 0.88 }));
    const black = c.smat("bellman_black", () => new THREE.MeshStandardMaterial({ color: 0x090708, roughness: 0.8 }));
    const gold = c.smat("bellman_gold", () => new THREE.MeshStandardMaterial({ color: 0xc7a255, metalness: 0.7, roughness: 0.3 }));
    const skin = c.smat("bellman_skin", () => new THREE.MeshStandardMaterial({ color: 0xaba38f, roughness: 0.75 }));
    const voidMat = c.smat("bellman_void", () => new THREE.MeshStandardMaterial({ color: 0x030202, roughness: 1 }));

    // The uniform: a fitted tunic, flat in the chest, brass buttons down the
    // front, a gold belt, collar and epaulettes. It still fits. He doesn't.
    bake(c, c.group, cloth, "bellman_tunic", (p) => {
      p.lathe(V(0, 0.2, 0), [[0.19, -0.42], [0.23, -0.38], [0.24, -0.2], [0.21, 0.0], [0.24, 0.25], [0.25, 0.35], [0.2, 0.42], [0.07, 0.46]], 16, [1, 1, 0.65]);
    });
    bake(c, c.group, gold, "bellman_brass", (p) => {
      p.lathe(V(0, -0.12, 0), [[0.235, -0.03], [0.245, 0], [0.235, 0.03]], 16, [1, 1, 0.66]);
      p.lathe(V(0, 0.63, 0), [[0.075, -0.025], [0.09, 0], [0.075, 0.03]], 12);
      for (const x of [-0.07, 0.07]) for (const y of [0.02, 0.17, 0.32, 0.47]) p.blob(V(x, y, 0.15), 0.017, [1, 1, 0.6], [0, 0, 0], [8, 6]);
      for (const s of [-1, 1]) p.box(V(s * 0.2, 0.61, 0), [0.14, 0.025, 0.12], [0, 0, -s * 0.2]);
    });

    for (const side of [-1, 1]) {
      // Trousers with a gold stripe down the seam, polished shoes.
      const leg = c.joint(`leg${side}`, side * 0.15, -0.2, 0);
      bake(c, leg, black, `bellman_leg_${side}`, (p) => {
        p.limb(V(side * 0.12, -0.2, 0), V(side * 0.12, -0.6, 0.02), 0.09, 0.85);
        p.limb(V(side * 0.12, -0.6, 0.02), V(side * 0.12, -0.95, 0), 0.075, 0.9);
        p.blob(V(side * 0.12, -1.0, 0.06), 0.07, [1, 0.55, 1.65]);
      });
      bake(c, leg, gold, `bellman_stripe_${side}`, (p) => p.blade(V(side * 0.2, -0.22, 0), V(side * 0.19, -0.9, 0), 0.02, 0.006));

      // Sleeves to brass-cuffed wrists, and long, pale, bare hands.
      const arm = c.joint(`arm${side}`, side * 0.35, 0.48, 0);
      const shoulder = V(side * 0.27, 0.52, 0), elbow = V(side * 0.32, 0.15, 0.02), wrist = V(side * 0.32, -0.17, 0.06);
      bake(c, arm, cloth, `bellman_sleeve_${side}`, (p) => {
        p.blob(shoulder, 0.08, [1, 0.9, 1]);
        p.limb(shoulder, elbow, 0.065, 0.9);
        p.limb(elbow, wrist, 0.058, 0.9);
      });
      bake(c, arm, gold, `bellman_cuff_${side}`, (p) => p.limb(V(wrist.x, wrist.y + 0.05, wrist.z), V(wrist.x, wrist.y - 0.0, wrist.z), 0.062, 1));
      bake(c, arm, skin, `bellman_hand_${side}`, (p) => hand(p, { wrist: V(wrist.x, wrist.y - 0.02, wrist.z), dir: V(0, -1, 0.1), across: V(0, 0, 1), fingers: 4, len: 0.12, r: 0.012, curl: 0.3 }));
    }

    // A gaunt, waxy face under the pillbox cap: sunken cheeks, empty sockets,
    // a thin painted-on smile that never moves.
    const head = c.joint("head", 0, 0.72, 0);
    bake(c, head, skin, "bellman_face", (p) => {
      p.limb(V(0, 0.6, 0), V(0, 0.7, 0.01), 0.055, 0.95);
      p.blob(V(0, 0.83, 0.01), 0.13, [0.88, 1.12, 0.95]);
      p.limb(V(-0.065, 0.87, 0.118), V(0.065, 0.87, 0.118), 0.018, 1);
      p.limb(V(0, 0.86, 0.12), V(0, 0.8, 0.135), 0.016, 0.8);
      for (const s of [-1, 1]) p.blob(V(s * 0.075, 0.8, 0.085), 0.03, [1, 0.8, 0.9]);
      p.blob(V(0, 0.715, 0.08), 0.04, [1, 0.8, 0.9]);
    });
    bake(c, head, voidMat, "bellman_hollows", (p) => {
      for (const s of [-1, 1]) p.blob(V(s * 0.045, 0.845, 0.108), 0.027, [1.1, 0.85, 0.7]);
      p.chain([V(-0.05, 0.76, 0.1), V(-0.025, 0.747, 0.112), V(0.025, 0.747, 0.112), V(0.05, 0.76, 0.1)], 0.006, 0.006, 5);
    });
    bake(c, head, cloth, "bellman_cap", (p) => p.lathe(V(0, 0.955, -0.01), [[0.0001, 0], [0.125, 0], [0.13, 0.11], [0.0001, 0.115]], 16));
    bake(c, head, gold, "bellman_cap_band", (p) => {
      p.lathe(V(0, 0.975, -0.01), [[0.128, -0.02], [0.135, 0], [0.128, 0.02]], 16);
      p.chain([V(-0.115, 0.95, 0.0), V(-0.09, 0.74, 0.05), V(0, 0.68, 0.08), V(0.09, 0.74, 0.05), V(0.115, 0.95, 0.0)], 0.005, 0.005, 4);
    });
  },
  sense(c) {
    const hotel = c.map.hotel;
    const seeing = hotelSightClear(c.entityPos.x, c.entityPos.z, c.playerX, c.playerZ, (x, z) => hotel?.isBlocked(x, z) ?? false);
    const mode = hotel?.bellmanMode ?? 0;
    if (!mode || hotel?.calm) return { chasing: false, speed: 0, agitated: false, pose: 0 };
    // Appearing (1), he walks slowly up to his guest and stops a few metres short, staring
    // (still "chasing", so he keeps facing them); angered (2), he comes for them while he can see them.
    // He stops outside the director's always-observed radius, so he can still leave unseen.
    if (mode === 1) return { chasing: true, speed: c.distanceMeters > 9 ? 0.65 : 0, agitated: false, pose: mode };
    return { chasing: mode === 2 && seeing, speed: mode === 2 ? 1.7 : 0, agitated: mode === 2, pose: mode };
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
