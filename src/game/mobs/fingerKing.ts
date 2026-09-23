/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FINGER_KING: Level G's exclusive stalker. Tall grey office-suit figure on
 * stilt legs, dragging five-fingered hands, a crown of upright fingers.
 * Senses further and moves faster the longer the level's aggression ramp
 * runs (see GameEngine's levelGAggression), and never chases past a
 * sprinting explorer's own top speed — the final chase is a race you can
 * win, not a death sentence.
 *
 * Its BFS-seeking pathing (chooseFingerKingStep/fingerCanEnter's closet gate)
 * stays hardcoded in WanderingEntity.ts, by design — it's deeply tied to
 * Level G's bespoke hide/ambush system and not worth generalizing into the
 * shared mob-behavior contract for a level-exclusive boss.
 *
 * Moved verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";

export const fingerKing: MobDefinition = {
  type: EntityType.FINGER_KING,
  baseSpeed: 1.0,
  baseHeight: 1.35,
  bobFreq: 3.8, bobAmp: 0.08,
  speechBubbleLocalY: 1.1,
  // Never actually reached (Finger King only ever appears on Level G, id 4,
  // never on the forced-chase levels 2/3) — kept for interface completeness,
  // matching the generic `else` fallback the old forced-chase switch gave any
  // type it didn't explicitly list.
  forcedChaseSpeed: 3.2,

  build(ctx) {
    const { group } = ctx;
    const suitMat = ctx.smat("king_suit", () => new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.7 }));
    const torso = new THREE.Mesh(ctx.sgeo("king_torso", () => new THREE.CylinderGeometry(0.14, 0.2, 0.62, 6)), suitMat);
    torso.position.set(0, 0.35, 0);
    group.add(torso);

    const tieMat = ctx.smat("king_tie", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 }));
    const tie = new THREE.Mesh(ctx.sgeo("king_tie_geo", () => new THREE.BoxGeometry(0.05, 0.5, 0.02)), tieMat);
    tie.position.set(0, 0.38, 0.15);
    group.add(tie);

    // Stilt legs — this creature reads as unnaturally tall
    group.add(ctx.limbBetween(suitMat, ctx.V(-0.08, 0.04, 0), ctx.V(-0.1, -1.35, 0), 0.06));
    group.add(ctx.limbBetween(suitMat, ctx.V(0.08, 0.04, 0), ctx.V(0.1, -1.35, 0), 0.06));

    const skinMat = ctx.smat("king_skin", () => new THREE.MeshStandardMaterial({ color: 0xd8cfc2, roughness: 0.55 }));
    const knuckleGeo = ctx.sgeo("king_knuckle_geo", () => new THREE.SphereGeometry(0.015, 5, 5));
    const knuckleMat = ctx.smat("king_knuckle", () => new THREE.MeshStandardMaterial({ color: 0x8f8373, roughness: 0.6 }));

    // Arms ending in a hand of 5 long, impossibly jointed fingers dragging near the floor
    for (const side of [-1, 1]) {
      const shoulder = ctx.V(side * 0.15, 0.55, 0);
      const wrist = ctx.V(side * 0.42, -0.15, 0.05);
      group.add(ctx.limbBetween(suitMat, shoulder, wrist, 0.045));
      for (let f = 0; f < 5; f++) {
        const spread = (f - 2) * 0.05;
        const fingerEnd = ctx.V(wrist.x + side * (0.15 + f * 0.03), -1.3 + Math.abs(f - 2) * 0.05, wrist.z + spread * 2);
        group.add(ctx.limbBetween(skinMat, wrist, fingerEnd, 0.014, 0.6));
        const knuckle = new THREE.Mesh(knuckleGeo, knuckleMat);
        knuckle.position.copy(wrist).lerp(fingerEnd, 0.55);
        group.add(knuckle);
      }
    }

    const head = new THREE.Mesh(ctx.sgeo("king_head_geo", () => new THREE.SphereGeometry(0.15, 10, 10)), skinMat);
    head.position.set(0, 0.82, 0);
    head.scale.set(0.85, 1.35, 0.95);
    group.add(head);

    // Crown of upright fingers
    const nailMat = ctx.smat("king_nail", () => new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.5 }));
    const nailGeo = ctx.sgeo("king_nail_geo", () => new THREE.SphereGeometry(0.012, 5, 5));
    for (let f = 0; f < 7; f++) {
      const off = (f - 3) / 3; // -1..1
      const base = ctx.V(off * 0.11, 1.0, 0);
      const tip = ctx.V(off * 0.13, 1.22 - Math.abs(off) * 0.08, 0);
      group.add(ctx.limbBetween(skinMat, base, tip, 0.011, 0.6));
      const nail = new THREE.Mesh(nailGeo, nailMat);
      nail.position.copy(tip);
      group.add(nail);
    }

    const eyeGeo = ctx.sgeo("king_eye_geo", () => new THREE.SphereGeometry(0.018, 6, 6));
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x000000, emissiveIntensity: 0 });
    ctx.addTintMaterial(eyeMat);
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.045, 0.83, 0.11); group.add(eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.045, 0.83, 0.11); group.add(eR);
    ctx.setKingEyeMaterial(eyeMat);
  },

  // Senses further and moves faster the longer you stay on Level G. Never
  // out-runs a sprinting explorer (4.2 m/s): the final chase is a race you
  // can win, not a death sentence.
  sense(ctx) {
    const senseRadius = 7 + 11 * ctx.aggression;
    if (ctx.hunting) {
      return { chasing: true, speed: 3.7 };
    }
    if (ctx.targetHidden && ctx.distanceMeters > 2.2) {
      return { chasing: false, speed: 1.0 + 0.8 * ctx.aggression };
    }
    if (ctx.distanceMeters < senseRadius) {
      return { chasing: true, speed: 1.9 + 1.5 * ctx.aggression };
    }
    return { chasing: false, speed: 1.0 + 0.8 * ctx.aggression };
  },

  speech(ctx) {
    // Mostly silent — the taps (GameEngine) carry the warning, not text.
    return { key: "" };
  },

  updateVisual(ctx) {
    if (!ctx.kingEyeMaterial) return;
    const active = ctx.isChasing || ctx.hunting;
    ctx.kingEyeMaterial.color.setHex(active ? 0xef4444 : 0x0a0a0a);
    ctx.kingEyeMaterial.emissive.setHex(active ? 0xff0000 : 0x000000);
    ctx.kingEyeMaterial.emissiveIntensity = active ? 1.6 : 0;
    ctx.kingEyeMaterial.needsUpdate = true;
  },

  // Deliberately absent from the radar (Level G's design: "you don't get
  // warnings" — you have to listen for the finger taps instead). RadarHUD
  // keeps its own hardcoded skip for FINGER_KING; this key is unused.
  radar: { color: "#000000", strokeColor: "#000000", labelKey: "radar.anomaly" },
};
