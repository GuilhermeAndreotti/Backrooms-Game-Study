/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SKIN_STEALER: a lanky humanoid disguised as a friendly explorer in a
 * hazmat suit. Calm and slow-mimicking at range; once the player closes
 * within 5.5m its "mask slips" (agitated) and it lunges. Moved verbatim
 * from the old per-type switches in WanderingEntity.ts.
 *
 * The agitation flip lives in speech() (it's driven by the same 4s-throttled
 * proximity check that also picks the mimic/hostile speech line, exactly as
 * pre-migration), and sense() only *reads* it — see mobs/types.ts's
 * MobSenseCtx doc for why that split matters here specifically.
 */

import * as THREE from "three";
import { bake, hand, teeth } from "./anatomy";
import { sculptedHead } from "./sculpt";
import { torsoGeometry } from "./creatureSkin";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped } from "./anim";

export const skinStealer: MobDefinition = {
  type: EntityType.SKIN_STEALER,
  baseSpeed: 1.1,
  baseHeight: 1.35,
  strideLength: 1.3,
  stepWeight: 0.45,
  bobFreq: 3.8, bobAmp: 0.08,
  speechBubbleLocalY: 0.9,
  forcedChaseSpeed: 3.8,
  forcedChaseAgitated: true,

  build(ctx) {
    const V = ctx.V;
    const suitMat = new THREE.MeshStandardMaterial({ color: 0xb39a3c, roughness: 0.85 });
    ctx.addTintMaterial(suitMat);
    // Rubber: gloves, boots, belt, the filter pack.
    const trimMat = ctx.smat("stealer_trim", () => new THREE.MeshStandardMaterial({ color: 0x23221d, roughness: 0.55 }));

    const spine = ctx.joint("spine", 0, -0.36, 0);
    const torso = new THREE.Mesh(ctx.sgeo("stealer_torso", () => torsoGeometry(0.21, 0.19, 0.55)), suitMat);
    torso.position.set(0, -0.1, 0);
    ctx.put(spine, torso);
    // Baggy suit: puffed shoulders and a sagging seat.
    bake(ctx, spine, suitMat, "stealer_suit", (p) => {
      for (const s of [-1, 1]) p.blob(V(s * 0.2, 0.1, 0), 0.085, [1, 0.9, 1]);
      p.blob(V(0, -0.36, -0.03), 0.17, [1.15, 0.6, 0.95]);
    });
    // The kit a real explorer would carry: belt, zip, collar ring, a filter
    // pack with twin canisters and a hose up to the hood.
    bake(ctx, spine, trimMat, "stealer_kit", (p) => {
      p.lathe(V(0, -0.33, 0), [[0.2, -0.025], [0.212, -0.015], [0.212, 0.015], [0.2, 0.025]]);
      p.lathe(V(0, 0.17, 0), [[0.11, -0.02], [0.13, -0.01], [0.13, 0.015], [0.115, 0.025]]);
      p.limb(V(0, 0.14, 0.205), V(0, -0.3, 0.19), 0.008, 1, 5);
      p.box(V(0, -0.06, -0.24), [0.26, 0.34, 0.1]);
      for (const s of [-1, 1]) p.limb(V(s * 0.075, -0.24, -0.3), V(s * 0.075, 0.08, -0.3), 0.048, 1);
      p.chain([V(0.075, 0.1, -0.3), V(0.16, 0.2, -0.2), V(0.13, 0.28, 0.02), V(0.06, 0.3, 0.12)], 0.016, 0.016);
    });

    // Arms — left notably longer, per the original design — in gloves whose
    // fingers are longer than any hand inside them could be.
    const arms: [string, string, THREE.Vector3, THREE.Vector3, THREE.Vector3, number][] = [
      ["armL", "foreL", V(-0.17, 0.1, 0), V(-0.55, -0.35, 0.05), V(-0.62, -0.8, 0.08), 0.22],
      ["armR", "foreR", V(0.17, 0.1, 0), V(0.5, -0.15, 0), V(0.6, -0.62, 0), 0.17],
    ];
    for (const [armName, foreName, shoulder, elbow, wrist, fingerLen] of arms) {
      const s = Math.sign(shoulder.x);
      const arm = ctx.joint(armName, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, suitMat, shoulder, elbow, 0.058, 0.9);
      const fore = ctx.joint(foreName, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, suitMat, elbow, wrist, 0.05, 0.85);
      bake(ctx, fore, trimMat, `stealer_glove_${s}`, (p) => {
        const cuff = wrist.clone().lerp(elbow, 0.12);
        p.limb(cuff, wrist, 0.052, 0.85);
        hand(p, { wrist, dir: wrist.clone().sub(elbow), across: V(0, 0, s), fingers: 4, len: fingerLen, r: 0.016, curl: 0.35 });
      });
    }

    // Legs: hip -> knee -> heavy boots on the floor
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = ctx.joint(`leg${n}`, side * 0.1, -0.38, 0);
      ctx.limbIn(leg, suitMat, V(side * 0.1, -0.38, 0), V(side * 0.12, -0.84, 0.03), 0.075, 0.85);
      const shin = ctx.joint(`shin${n}`, side * 0.12, -0.84, 0.03, leg);
      ctx.limbIn(shin, suitMat, V(side * 0.12, -0.84, 0.03), V(side * 0.135, -1.12, 0.01), 0.065, 0.95);
      bake(ctx, shin, trimMat, `stealer_boot_${side}`, (p) => {
        p.limb(V(side * 0.135, -1.1, 0.01), V(side * 0.14, -1.28, 0.0), 0.07, 1);
        p.blob(V(side * 0.14, -1.29, 0.07), 0.068, [1, 0.6, 1.55]);
      });
    }

    // The face: pale skin worn like a mask, almost right — brow, nose,
    // cheekbones and chin all slightly too sharp — on a slack neck.
    const head = ctx.joint("head", 0, 0.22, 0, spine);
    const headMat = ctx.smat("stealer_head", () => new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.55 }));
    const skull = new THREE.Mesh(ctx.sgeo("stealer_head_geo", () => sculptedHead(0.16)), headMat);
    skull.position.set(0, 0.38, 0);
    ctx.put(head, skull);
    bake(ctx, head, headMat, "stealer_face", (p) => {
      p.limb(V(0, 0.18, 0), V(0, 0.29, 0.03), 0.07, 0.9);
      p.limb(V(-0.065, 0.432, 0.13), V(0.065, 0.432, 0.13), 0.02, 1);
      p.limb(V(0, 0.42, 0.155), V(0, 0.37, 0.172), 0.019, 0.8);
      for (const s of [-1, 1]) p.blob(V(s * 0.072, 0.37, 0.118), 0.032, [1, 0.75, 0.9]);
      p.blob(V(0, 0.29, 0.12), 0.042, [1, 0.8, 0.9]);
    });

    // Sagging hood — a squashed half-dome sitting slightly back on the head
    const hoodMat = ctx.smat("stealer_hood", () => new THREE.MeshStandardMaterial({ color: 0x85722b, roughness: 0.9, side: THREE.DoubleSide }));
    const hood = new THREE.Mesh(ctx.sgeo("stealer_hood_geo", () => new THREE.SphereGeometry(0.19, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6)), hoodMat);
    hood.position.set(0, 0.42, -0.02);
    hood.rotation.x = 0.15;
    ctx.put(head, hood);

    // The mask's mouth: a hinged slit that gapes once it's revealed.
    const jaw = ctx.joint("jaw", 0, 0.33, 0.1, head);
    const mouthMat = ctx.smat("stealer_mouth", () => new THREE.MeshStandardMaterial({ color: 0x1c0a0a, roughness: 1.0 }));
    const mouth = new THREE.Mesh(ctx.sgeo("stealer_mouth_geo", () => new THREE.SphereGeometry(0.045, 24, 16)), mouthMat);
    mouth.scale.set(1, 0.35, 0.5);
    mouth.position.set(0, 0.31, 0.14);
    ctx.put(jaw, mouth);

    const eyeGeo = ctx.sgeo("stealer_eye_geo", () => new THREE.SphereGeometry(0.022, 8, 6));
    const calmMat = ctx.smat("stealer_calm_eye", () => new THREE.MeshStandardMaterial({ color: 0x0c0a09 }));
    const calm = new THREE.Group();
    const cL = new THREE.Mesh(eyeGeo, calmMat); cL.position.set(-0.05, 0.4, 0.14); calm.add(cL);
    const cR = new THREE.Mesh(eyeGeo, calmMat); cR.position.set(0.05, 0.4, 0.14); calm.add(cR);
    ctx.put(head, calm);

    const hostileMat = ctx.smat("stealer_hostile_eye", () => new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff0000, emissiveIntensity: 1.6 }));
    const hostile = new THREE.Group();
    const hL = new THREE.Mesh(eyeGeo, hostileMat); hL.position.set(-0.05, 0.4, 0.14); hostile.add(hL);
    const hR = new THREE.Mesh(eyeGeo, hostileMat); hR.position.set(0.05, 0.4, 0.14); hostile.add(hR);
    hostile.visible = false;
    const enamel = ctx.smat("stealer_teeth", () => new THREE.MeshStandardMaterial({ color: 0xb8aa8c, roughness: 0.35 }));
    const revealedJaw = ctx.joint("revealedJaw", 0, 0.31, 0.14, jaw);
    revealedJaw.userData.visualSwitch = true;
    revealedJaw.visible = false;
    bake(ctx, revealedJaw, enamel, "stealer_teeth", p => teeth(p, V(0, 0.305, 0.16), 0.035, 0.014, 9, 0.025, true, 0.005));
    ctx.put(head, hostile);

    ctx.setCalmHostileEyes(calm, hostile);
  },

  animate(ctx) {
    if (ctx.joints.revealedJaw) ctx.joints.revealedJaw.visible = ctx.agitated;
    // Calm: a stiff, almost-human shuffle. Revealed: a lunging sprint, arms out.
    animateBiped(ctx, { stride: 0.45, armSwing: ctx.agitated ? 0.15 : 0.3, knee: 0.8, elbow: 0.15, lean: 0.45, bounce: 0.05, breathe: 0.025, reach: 0.9 });
    if (ctx.agitated) {
      // The mask slipped: head twitches at wrong angles.
      const head = ctx.joints.head;
      if (head) head.rotation.z += Math.sin(ctx.time * 23) * Math.sin(ctx.time * 3.1) * 0.25;
    }
  },

  // Skin-Stealer locks onto player and rushes when agitated (< 5.5m). The
  // 5.5m threshold itself lives in speech() below, which is what flips
  // isAgitated — sense() only reacts to it.
  sense(ctx) {
    if (ctx.isAgitated) return { chasing: true, speed: 3.1 };
    return { chasing: false, speed: 1.0 };
  },

  speech(ctx) {
    if (ctx.distanceMeters > 5.5) {
      // Innocent explorer mimicking phrases.
      const mimics = [0, 1, 2, 3, 4, 5].map((n) => `sp.stealer.m${n}`);
      return { key: mimics[Math.floor(ctx.random() * mimics.length)], agitated: false };
    }
    // Angry morph trigger close-up!
    if (!ctx.isAgitated) console.warn("[Skin-Stealer] Mask slipped! Attacking voyager.");
    const hostiles = [0, 1, 2, 3, 4].map((n) => `sp.stealer.h${n}`);
    return { key: hostiles[Math.floor(ctx.random() * hostiles.length)], agitated: true };
  },

  updateVisual(ctx) {
    if (!ctx.calmEyes || !ctx.hostileEyes) return;
    ctx.calmEyes.visible = !ctx.isAgitated;
    ctx.hostileEyes.visible = ctx.isAgitated;
    const tint = ctx.isAgitated ? 0x3f320b : 0xb39a3c;
    ctx.tintMaterials.forEach((m) => { m.color.setHex(tint); m.needsUpdate = true; });
  },

  radar: { color: "#eab308", strokeColor: "#a16207", labelKey: "radar.mimic" },
};
