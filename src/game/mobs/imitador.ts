/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O IMITADOR: a plain, deliberately generic humanoid silhouette that could
 * pass for another lost explorer at a glance — no visible eyes, standing
 * still, waiting. Answers "isso é realmente o que parece?". Reveals (eyes
 * snap open, retints darker, rushes) once the player gets close, the same
 * one-way "reveal" shape SKIN_STEALER already uses.
 *
 * Its distinguishing trait vs. SKIN_STEALER (which patrols at a slow,
 * friendly pace while calm) is that it stays completely still while
 * disguised — moveSpeed 0 — matching the doc's "permanece imóvel durante
 * grande parte do tempo". A very faint idle bob (bobAmp) is kept rather
 * than a literal zero, so it still reads as a live mesh rather than a
 * rendering glitch; per-state animation isn't something this engine's
 * MobDefinition currently supports (bob is a single static value, not
 * gated on chasing/agitated), so this is a deliberate compromise, not an
 * oversight.
 */

import * as THREE from "three";
import { sculptedHead } from "./sculpt";
import { bake, hand } from "./anatomy";
import { torsoGeometry } from "./creatureSkin";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped } from "./anim";

const REVEAL_RADIUS = 4.0;
const REVEAL_SPEED = 3.3;

export const imitador: MobDefinition = {
  type: EntityType.IMITADOR,
  baseSpeed: 0,
  baseHeight: 1.35,
  strideLength: 1.25,
  stepWeight: 0.4,
  bobFreq: 2.2, bobAmp: 0.02, // barely-there — reads as "almost too still"
  speechBubbleLocalY: 0.85,
  forcedChaseSpeed: 3.3,
  forcedChaseAgitated: true,

  build(ctx) {
    const V = ctx.V;
    // Clothes (retinted darker on reveal), a grey, bloodless skin, worn boots.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.85 });
    ctx.addTintMaterial(bodyMat);
    const skinMat = ctx.smat("imitador_skin", () => new THREE.MeshStandardMaterial({ color: 0x8c857a, roughness: 0.6 }));
    const bootMat = ctx.smat("imitador_boot", () => new THREE.MeshStandardMaterial({ color: 0x1c1915, roughness: 0.6 }));

    // Plain humanoid silhouette — deliberately generic, could pass for "just
    // another explorer": a hooded jacket, a backpack, trousers and boots.
    const spine = ctx.joint("spine", 0, -0.3, 0);
    const torso = new THREE.Mesh(ctx.sgeo("imitador_torso", () => torsoGeometry(0.2, 0.17, 0.5)), bodyMat);
    torso.position.set(0, -0.05, 0);
    ctx.put(spine, torso);
    bake(ctx, spine, bodyMat, "imitador_jacket", (p) => {
      for (const s of [-1, 1]) p.blob(V(s * 0.17, 0.13, 0), 0.07, [1, 0.85, 1]);
      p.blob(V(0, 0.19, -0.1), 0.12, [1.2, 0.6, 0.7]); // the hood, down on the shoulders
      p.box(V(0, -0.02, -0.2), [0.24, 0.32, 0.1]); // backpack
      p.lathe(V(0, -0.3, 0), [[0.17, -0.03], [0.18, 0], [0.17, 0.03]]); // waistband
    });

    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.16, 0.12, 0), elbow = V(side * 0.2, -0.16, 0.01), wrist = V(side * 0.22, -0.46, 0.03);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, bodyMat, shoulder, elbow, 0.055, 0.9);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, bodyMat, elbow, wrist.clone().lerp(elbow, 0.1), 0.048, 0.9);
      bake(ctx, fore, skinMat, `imitador_hand_${side}`, (p) => hand(p, { wrist, dir: wrist.clone().sub(elbow), across: V(0, 0, side), fingers: 4, len: 0.09, r: 0.012, curl: 0.45 }));
      const leg = ctx.joint(`leg${n}`, side * 0.09, -0.3, 0);
      ctx.limbIn(leg, bodyMat, V(side * 0.09, -0.3, 0), V(side * 0.1, -0.8, 0.02), 0.075, 0.85);
      const shin = ctx.joint(`shin${n}`, side * 0.1, -0.8, 0.02, leg);
      ctx.limbIn(shin, bodyMat, V(side * 0.1, -0.8, 0.02), V(side * 0.115, -1.15, 0.01), 0.062, 0.95);
      bake(ctx, shin, bootMat, `imitador_boot_${side}`, (p) => {
        p.limb(V(side * 0.115, -1.12, 0.01), V(side * 0.12, -1.28, 0), 0.064, 1);
        p.blob(V(side * 0.12, -1.295, 0.06), 0.062, [1, 0.6, 1.5]);
      });
    }

    // A face with every feature smoothed nearly away: brow, nose and chin are
    // only suggestions, and where the eyes should be the skin is closed over.
    const head = ctx.joint("head", 0, 0.2, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("imitador_head", () => sculptedHead(0.15, true)), skinMat);
    skull.position.set(0, 0.32, 0);
    ctx.put(head, skull);
    bake(ctx, head, skinMat, "imitador_face", (p) => {
      p.limb(V(0, 0.15, 0), V(0, 0.24, 0.02), 0.06, 0.95);
      p.limb(V(-0.06, 0.365, 0.12), V(0.06, 0.365, 0.12), 0.022, 1);
      p.limb(V(0, 0.35, 0.145), V(0, 0.31, 0.158), 0.016, 0.8);
      p.blob(V(0, 0.235, 0.11), 0.04, [1, 0.8, 0.9]);
      for (const s of [-1, 1]) p.blob(V(s * 0.145, 0.32, 0), 0.025, [0.5, 1, 0.8]); // ears
    });

    // Calm: no eyes at all — their absence is the "off" detail up close.
    const calm = new THREE.Group();
    ctx.put(head, calm);

    // Hostile: eyes snap open, wide and glowing, once revealed.
    const eyeGeo = ctx.sgeo("imitador_eye_geo", () => new THREE.SphereGeometry(0.026, 8, 6));
    const eyeMat = ctx.smat("imitador_eye", () => new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x9333ea, emissiveIntensity: 1.7 }));
    const hostile = new THREE.Group();
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.055, 0.34, 0.13); hostile.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.055, 0.34, 0.13); hostile.add(eR);
    hostile.visible = false;
    ctx.put(head, hostile);

    ctx.setCalmHostileEyes(calm, hostile);
  },

  animate(ctx) {
    // Mimics an explorer's walk a little too perfectly; once revealed, it
    // sprints with its arms dead at its sides and its head locked on you.
    animateBiped(ctx, { stride: 0.4, armSwing: ctx.agitated ? 0.05 : 0.35, knee: 0.7, elbow: 0.1, lean: 0.3, bounce: 0.04, breathe: 0.015, headReach: ctx.agitated ? 1.3 : 0.8 });
  },

  sense(ctx) {
    if (ctx.isAgitated) return { chasing: true, speed: REVEAL_SPEED };
    if (ctx.distanceMeters < REVEAL_RADIUS) {
      return { chasing: true, speed: REVEAL_SPEED, agitated: true };
    }
    return { chasing: false, speed: 0 };
  },

  speech(ctx) {
    if (ctx.isAgitated) {
      const lines = [0, 1, 2].map((n) => `sp.imitador.reveal${n}`);
      return { key: lines[Math.floor(ctx.random() * lines.length)] };
    }
    const lines = [0, 1, 2, 3].map((n) => `sp.imitador.calm${n}`);
    return { key: lines[Math.floor(ctx.random() * lines.length)] };
  },

  updateVisual(ctx) {
    if (!ctx.calmEyes || !ctx.hostileEyes) return;
    ctx.hostileEyes.visible = ctx.isAgitated;
    const tint = ctx.isAgitated ? 0x1a0f24 : 0x3a3630;
    ctx.tintMaterials.forEach((m) => { m.color.setHex(tint); m.needsUpdate = true; });
  },

  radar: { color: "#a855f7", strokeColor: "#6b21a8", labelKey: "radar.imitador" },
};
