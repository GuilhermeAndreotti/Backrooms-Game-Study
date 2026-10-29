import * as THREE from "three";
import { bake } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import type { MobDefinition } from "./types";
import { hotelSightClear } from "../levels/hotelLayout";

/** Sparse low-flying moths: the existing 2D navigation drives a hovering rig. */
export const deathmoth: MobDefinition = {
  type: EntityType.DEATHMOTH, baseHeight: 1.9, baseSpeed: 0.45, bobFreq: 2.5, bobAmp: 0.22,
  strideLength: 1.2, stepWeight: 0, speechBubbleLocalY: 0.7, forcedChaseSpeed: 1.8, catchRadius: 0.75,
  build(c) {
    const V = c.V;
    const body = c.smat("moth_body", () => new THREE.MeshStandardMaterial({ color: 0x3a3126, roughness: 1 }));
    const eyeMat = c.smat("moth_eye", () => new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.2, metalness: 0.2 }));
    const wing = c.smat("moth_wing", () => new THREE.MeshStandardMaterial({ map: mothWingTexture(), side: THREE.DoubleSide, roughness: 1 }));

    // Head forward (+Z): a furred thorax, a segmented abdomen tapering behind,
    // big compound eyes, feathered antennae and six thin legs folded under.
    bake(c, c.group, body, "moth_body", (p) => {
      p.blob(V(0, 0, 0.05), 0.13, [0.9, 0.85, 1.1]);
      for (let i = 0; i < 6; i++) p.blob(V(0, -0.01 - i * 0.008, -0.08 - i * 0.075), 0.1 - i * 0.012, [1, 0.9, 0.75]);
      p.blob(V(0, 0.0, 0.19), 0.07);
      for (const s of [-1, 1]) {
        const base = V(s * 0.03, 0.05, 0.24), tip = V(s * 0.2, 0.15, 0.46);
        p.limb(base, tip, 0.008, 0.6, 5);
        for (let k = 1; k <= 5; k++) { // the feathering along each antenna
          const at = base.clone().lerp(tip, k / 6);
          p.limb(at, at.clone().add(V(s * 0.03, -0.01, -0.035)), 0.003, 0.5, 4);
          p.limb(at, at.clone().add(V(-s * 0.02, 0.015, 0.03)), 0.003, 0.5, 4);
        }
        for (const [z, reach] of [[0.12, 0.12], [0.05, 0.16], [-0.02, 0.15]] as const) {
          p.chain([V(s * 0.06, -0.06, z), V(s * (0.06 + reach * 0.7), -0.1, z + 0.02), V(s * (0.06 + reach), -0.2, z + 0.05)], 0.008, 0.004, 5);
        }
      }
    });
    bake(c, c.group, eyeMat, "moth_eyes", (p) => { for (const s of [-1, 1]) p.blob(V(s * 0.05, 0.02, 0.23), 0.04); });
    const fur = c.smat("moth_fur", () => new THREE.MeshStandardMaterial({ color: 0x8c7c60, roughness: 1 }));
    bake(c, c.group, fur, "moth_fur", p => {
      for (let i = 0; i < 110; i++) {
        const theta = i * 2.399963, y = 1 - 2 * (i + 0.5) / 110;
        const radius = Math.sqrt(1 - y * y);
        const normal = V(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
        const base = normal.clone().multiply(V(0.116, 0.11, 0.14)).add(V(0, 0, 0.05));
        p.spike(base, base.clone().addScaledVector(normal, 0.015 + (i % 7) * 0.002), 0.0015, 3);
      }
    });

    for (const side of [-1, 1]) {
      const joint = c.joint(`wing${side}`, side * 0.08, 0.02, 0.02);
      const w = new THREE.Mesh(c.sgeo("moth_wing_shape", mothWingGeometry), wing);
      w.scale.set(side, 1, 1);
      joint.add(w);
    }
  },
  sense(c) {
    const sees = c.distanceMeters < 6 && hotelSightClear(c.entityPos.x, c.entityPos.z, c.playerX, c.playerZ, (x, z) => c.map.hotel?.isBlocked(x, z) ?? false);
    const chasing = sees && !c.map.hotel?.calm && (c.isFlashlightOn || c.distanceMeters < 2);
    return { chasing, speed: chasing ? 1.65 : 0.45 };
  },
  animate(c) { for (const side of [-1, 1]) c.joints[`wing${side}`].rotation.z = side * Math.sin(c.time * 23) * 0.75; },
  radar: { color: "#baa976", strokeColor: "#524327", labelKey: "hotel.deathmoth" },
};

/**
 * One wing (fore and hind), flat in XZ, root at the origin, reaching out
 * along +X; mirrored for the left. UVs span the outline's bounds.
 */
function mothWingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Shape Y becomes -Z once laid flat: negative Y is forward.
  s.moveTo(0, -0.06);
  s.bezierCurveTo(0.3, -0.3, 0.7, -0.42, 0.95, -0.36); // leading edge to the apex
  s.bezierCurveTo(0.98, -0.2, 0.86, -0.04, 0.72, 0.02); // outer margin of the forewing
  s.bezierCurveTo(0.74, 0.18, 0.56, 0.38, 0.36, 0.4); // the hindwing's rounded lobe
  s.bezierCurveTo(0.2, 0.4, 0.08, 0.3, 0.02, 0.16);
  s.lineTo(0, -0.06);
  const geo = new THREE.ShapeGeometry(s, 10);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 1.0, (pos.getY(i) + 0.44) / 0.88);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

let wingTexture: THREE.CanvasTexture | null = null;

/** Dusty grey-brown scales: dark cross-bands, veins fanning from the root, an eyespot on the hindwing. */
function mothWingTexture(): THREE.CanvasTexture {
  if (wingTexture) return wingTexture;
  const size = 512;
  let seed = 7301;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    // u = 0 at the root (canvas left). The canvas is flipped onto the wing (flipY):
    // its top is the trailing edge (the hindwing), its bottom the leading edge.
    g.fillStyle = "#7d7159";
    g.fillRect(0, 0, size, size);
    for (const [x, w, a] of [[0.32, 0.05, 0.35], [0.58, 0.04, 0.3], [0.8, 0.07, 0.25]] as const) {
      g.fillStyle = `rgba(48, 38, 26, ${a})`;
      g.beginPath();
      g.moveTo(size * x, 0); g.lineTo(size * (x + w), 0);
      g.lineTo(size * (x + w - 0.12), size); g.lineTo(size * (x - 0.12), size);
      g.fill();
    }
    g.strokeStyle = "rgba(40, 32, 22, 0.55)";
    g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(0, size * 0.45);
      g.quadraticCurveTo(size * 0.4, size * (0.45 + (i - 4) * 0.07), size, size * (0.1 + i * 0.1));
      g.stroke();
    }
    const eye = g.createRadialGradient(size * 0.42, size * 0.2, 2, size * 0.42, size * 0.2, size * 0.11);
    eye.addColorStop(0, "#0b0907"); eye.addColorStop(0.35, "#1a140e"); eye.addColorStop(0.5, "#b8a77e"); eye.addColorStop(0.62, "#3a2e20"); eye.addColorStop(1, "rgba(58, 46, 32, 0)");
    g.fillStyle = eye;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = random() < 0.5 ? "rgba(30, 24, 16, 0.18)" : "rgba(190, 176, 140, 0.14)";
      g.fillRect(random() * size, random() * size, 2, 1);
    }
  }
  wingTexture = new THREE.CanvasTexture(canvas);
  wingTexture.colorSpace = THREE.SRGBColorSpace;
  return wingTexture;
}
