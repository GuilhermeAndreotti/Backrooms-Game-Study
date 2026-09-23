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
import { animateBiped } from "./anim";

export const fingerKing: MobDefinition = {
  type: EntityType.FINGER_KING,
  baseSpeed: 1.0,
  baseHeight: 1.35,
  strideLength: 1.6,
  stepWeight: 0.6,
  bobFreq: 3.8, bobAmp: 0.08,
  speechBubbleLocalY: 1.1,
  // Never actually reached (Finger King only ever appears on Level G, id 4,
  // never on the forced-chase levels 2/3) — kept for interface completeness,
  // matching the generic `else` fallback the old forced-chase switch gave any
  // type it didn't explicitly list.
  forcedChaseSpeed: 3.2,

  build(ctx) {
    const V = ctx.V;
    const suitMat = ctx.smat("king_suit", () => new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.7 }));
    const spine = ctx.joint("spine", 0, 0.04, 0);
    const torso = new THREE.Mesh(ctx.sgeo("king_torso", () => new THREE.CylinderGeometry(0.14, 0.2, 0.62, 6)), suitMat);
    torso.position.set(0, 0.35, 0);
    ctx.put(spine, torso);

    const tieMat = ctx.smat("king_tie", () => new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 }));
    const tie = new THREE.Mesh(ctx.sgeo("king_tie_geo", () => new THREE.BoxGeometry(0.05, 0.5, 0.02)), tieMat);
    tie.position.set(0, 0.38, 0.15);
    ctx.put(spine, tie);

    // Stilt legs — this creature reads as unnaturally tall
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const leg = ctx.joint(`leg${n}`, side * 0.08, 0.04, 0);
      ctx.limbIn(leg, suitMat, V(side * 0.08, 0.04, 0), V(side * 0.09, -0.66, 0.03), 0.06);
      const shin = ctx.joint(`shin${n}`, side * 0.09, -0.66, 0.03, leg);
      ctx.limbIn(shin, suitMat, V(side * 0.09, -0.66, 0.03), V(side * 0.1, -1.35, 0), 0.052);
    }

    const skinMat = ctx.smat("king_skin", () => new THREE.MeshStandardMaterial({ color: 0xd8cfc2, roughness: 0.55 }));
    const knuckleGeo = ctx.sgeo("king_knuckle_geo", () => new THREE.SphereGeometry(0.015, 5, 5));
    const knuckleMat = ctx.smat("king_knuckle", () => new THREE.MeshStandardMaterial({ color: 0x8f8373, roughness: 0.6 }));

    // Arms ending in a hand of 5 long, impossibly jointed fingers dragging near
    // the floor — every finger bends at its knuckle.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.15, 0.55, 0);
      const elbow = V(side * 0.3, 0.2, 0.03);
      const wrist = V(side * 0.42, -0.15, 0.05);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, suitMat, shoulder, elbow, 0.045);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, suitMat, elbow, wrist, 0.04);
      const hand = ctx.joint(`hand${n}`, wrist.x, wrist.y, wrist.z, fore);
      for (let f = 0; f < 5; f++) {
        const spread = (f - 2) * 0.05;
        const tip = V(wrist.x + side * (0.15 + f * 0.03), -1.3 + Math.abs(f - 2) * 0.05, wrist.z + spread * 2);
        const knuckle = wrist.clone().lerp(tip, 0.55);
        ctx.limbIn(hand, skinMat, wrist, knuckle, 0.014, 0.8);
        const k = new THREE.Mesh(knuckleGeo, knuckleMat);
        k.position.copy(knuckle);
        ctx.put(hand, k);
        const finger = ctx.joint(`finger${n}${f}`, knuckle.x, knuckle.y, knuckle.z, hand);
        ctx.limbIn(finger, skinMat, knuckle, tip, 0.012, 0.6);
      }
    }

    const head = ctx.joint("head", 0, 0.66, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("king_head_geo", () => new THREE.SphereGeometry(0.15, 10, 10)), skinMat);
    skull.position.set(0, 0.82, 0);
    skull.scale.set(0.85, 1.35, 0.95);
    ctx.put(head, skull);

    // Crown of upright fingers, each on its own pivot so they flex
    const nailMat = ctx.smat("king_nail", () => new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.5 }));
    const nailGeo = ctx.sgeo("king_nail_geo", () => new THREE.SphereGeometry(0.012, 5, 5));
    for (let f = 0; f < 7; f++) {
      const off = (f - 3) / 3; // -1..1
      const base = V(off * 0.11, 1.0, 0);
      const tip = V(off * 0.13, 1.22 - Math.abs(off) * 0.08, 0);
      const crown = ctx.joint(`crown${f}`, base.x, base.y, base.z, head);
      ctx.limbIn(crown, skinMat, base, tip, 0.011, 0.6);
      const nail = new THREE.Mesh(nailGeo, nailMat);
      nail.position.copy(tip);
      ctx.put(crown, nail);
    }

    const eyeGeo = ctx.sgeo("king_eye_geo", () => new THREE.SphereGeometry(0.018, 6, 6));
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x000000, emissiveIntensity: 0 });
    ctx.addTintMaterial(eyeMat);
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(-0.045, 0.83, 0.11); ctx.put(head, eL);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(0.045, 0.83, 0.11); ctx.put(head, eR);
    ctx.setKingEyeMaterial(eyeMat);
  },

  animate(ctx) {
    // Long, deliberate stilt steps; hunched forward and faster once it hunts.
    animateBiped(ctx, { stride: 0.38, armSwing: 0.18, knee: 0.9, elbow: 0.25, lean: 0.35, bounce: 0.06, breathe: 0.02, reach: 0.5 });
    const j = ctx.joints;
    const { time, move, run } = ctx;
    // Fingers: dragged back while walking, drumming/curling while it waits.
    for (const n of ["L", "R"]) {
      for (let f = 0; f < 5; f++) {
        const drum = Math.sin(time * 3.2 + f * 0.9 + (n === "L" ? 0 : 1.7));
        const finger = j[`finger${n}${f}`];
        if (finger) finger.rotation.x = 0.25 * move + drum * 0.18 * (1 - move) + run * move * 0.3;
      }
      const hand = j[`hand${n}`];
      if (hand) hand.rotation.x = 0.3 * move * (1 + run);
    }
    // Crown fingers twitch, faster when it's hunting.
    const speed = ctx.chasing ? 9 : 2.4;
    for (let f = 0; f < 7; f++) {
      const crown = j[`crown${f}`];
      if (crown) crown.rotation.set(Math.sin(time * speed + f * 1.3) * 0.12, 0, Math.sin(time * speed * 0.7 + f) * 0.1);
    }
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
