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
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";

export const skinStealer: MobDefinition = {
  type: EntityType.SKIN_STEALER,
  baseSpeed: 1.1,
  baseHeight: 1.35,
  bobFreq: 3.8, bobAmp: 0.08,
  speechBubbleLocalY: 0.9,
  forcedChaseSpeed: 3.8,
  forcedChaseAgitated: true,

  build(ctx) {
    const { group } = ctx;
    const suitMat = new THREE.MeshStandardMaterial({ color: 0xb39a3c, roughness: 0.85 });
    ctx.addTintMaterial(suitMat);

    const torso = new THREE.Mesh(ctx.sgeo("stealer_torso", () => new THREE.CylinderGeometry(0.19, 0.23, 0.55, 8)), suitMat);
    torso.position.set(0, -0.1, 0);
    group.add(torso);

    // Arms — left notably longer, per the original design
    group.add(ctx.limbBetween(suitMat, ctx.V(-0.17, 0.1, 0), ctx.V(-0.55, -0.35, 0.05), 0.055));
    group.add(ctx.limbBetween(suitMat, ctx.V(-0.55, -0.35, 0.05), ctx.V(-0.62, -0.8, 0.08), 0.045));
    group.add(ctx.limbBetween(suitMat, ctx.V(0.17, 0.1, 0), ctx.V(0.5, -0.15, 0), 0.055));
    group.add(ctx.limbBetween(suitMat, ctx.V(0.5, -0.15, 0), ctx.V(0.6, -0.62, 0), 0.045));
    // Legs
    group.add(ctx.limbBetween(suitMat, ctx.V(-0.1, -0.38, 0), ctx.V(-0.14, -1.3, 0), 0.07));
    group.add(ctx.limbBetween(suitMat, ctx.V(0.1, -0.38, 0), ctx.V(0.14, -1.3, 0), 0.07));

    const headMat = ctx.smat("stealer_head", () => new THREE.MeshStandardMaterial({ color: 0xe5e1da, roughness: 0.6 }));
    const head = new THREE.Mesh(ctx.sgeo("stealer_head_geo", () => new THREE.SphereGeometry(0.16, 10, 8)), headMat);
    head.position.set(0, 0.38, 0);
    group.add(head);

    // Sagging hood — a squashed half-dome sitting slightly back on the head
    const hoodMat = ctx.smat("stealer_hood", () => new THREE.MeshStandardMaterial({ color: 0x85722b, roughness: 0.9, side: THREE.DoubleSide }));
    const hood = new THREE.Mesh(ctx.sgeo("stealer_hood_geo", () => new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6)), hoodMat);
    hood.position.set(0, 0.42, -0.02);
    hood.rotation.x = 0.15;
    group.add(hood);

    const eyeGeo = ctx.sgeo("stealer_eye_geo", () => new THREE.SphereGeometry(0.022, 6, 6));
    const calmMat = ctx.smat("stealer_calm_eye", () => new THREE.MeshStandardMaterial({ color: 0x0c0a09 }));
    const calm = new THREE.Group();
    const cL = new THREE.Mesh(eyeGeo, calmMat); cL.position.set(-0.05, 0.4, 0.14); calm.add(cL);
    const cR = new THREE.Mesh(eyeGeo, calmMat); cR.position.set(0.05, 0.4, 0.14); calm.add(cR);
    group.add(calm);

    const hostileMat = ctx.smat("stealer_hostile_eye", () => new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff0000, emissiveIntensity: 1.6 }));
    const hostile = new THREE.Group();
    const hL = new THREE.Mesh(eyeGeo, hostileMat); hL.position.set(-0.05, 0.4, 0.14); hostile.add(hL);
    const hR = new THREE.Mesh(eyeGeo, hostileMat); hR.position.set(0.05, 0.4, 0.14); hostile.add(hR);
    hostile.visible = false;
    group.add(hostile);

    ctx.setCalmHostileEyes(calm, hostile);
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
      return { key: mimics[Math.floor(Math.random() * mimics.length)], agitated: false };
    }
    // Angry morph trigger close-up!
    if (!ctx.isAgitated) console.warn("[Skin-Stealer] Mask slipped! Attacking voyager.");
    const hostiles = [0, 1, 2, 3, 4].map((n) => `sp.stealer.h${n}`);
    return { key: hostiles[Math.floor(Math.random() * hostiles.length)], agitated: true };
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
