/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O CEIFADOR: a tall, gaunt, hooded figure built for speed — the apex
 * threat. Answers "ele aprendeu meu padrão?". Its actual "adaptation" is
 * where it appears, not how it behaves once present: spawn/ambush
 * positioning is biased by VisitTracker (src/game/systems/visitTracker.ts)
 * toward cells the group keeps re-using — that's a bespoke SpawnDescriptor
 * concern (Phase 4/5), not this file. Once it's around, it's simply the
 * fastest, longest-sensing chaser in the roster; deliberately radar-
 * invisible (see RadarHUD.tsx — same "no warning" treatment as
 * FINGER_KING) since "no clear signal" is the point.
 *
 * Scope note: the doc also gives it corridor-blocking (same deferral as
 * O Vigia — needs the MovableProp/obstacle system plus a server message,
 * not expressible from sense() alone). Cannot be "defeated" by design —
 * true of every mob in this game already (there's no attack/kill
 * interaction anywhere; only escape/hide/outrun), so no special-casing
 * was needed for that part.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped } from "./anim";

const SENSE_RADIUS = 22;
const IDLE_SPEED = 1.3;
/** Fastest in the roster, still shy of the player's 4.2 m/s sprint cap. */
const CHASE_SPEED = 3.9;

export const ceifador: MobDefinition = {
  type: EntityType.CEIFADOR,
  baseSpeed: IDLE_SPEED,
  baseHeight: 1.45,
  strideLength: 1.8,
  stepWeight: 0.6,
  bobFreq: 4.0, bobAmp: 0.07, // fast, purposeful stride
  speechBubbleLocalY: 1.05,
  forcedChaseSpeed: CHASE_SPEED,

  build(ctx) {
    const V = ctx.V;
    const mat = ctx.smat("ceifador_body", () => new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0.3 }));

    // Tall, gaunt frame — built for speed, not bulk.
    const spine = ctx.joint("spine", 0, -0.45, 0);
    ctx.limbIn(spine, mat, V(0, 0.55, 0), V(0, -0.45, 0), 0.11);
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      // Blade-like arms, angled sharply
      const arm = ctx.joint(`arm${n}`, side * 0.08, 0.45, 0, spine);
      ctx.limbIn(arm, mat, V(side * 0.08, 0.45, 0), V(side * 0.28, 0.12, 0.04), 0.035, 0.8);
      const fore = ctx.joint(`fore${n}`, side * 0.28, 0.12, 0.04, arm);
      ctx.limbIn(fore, mat, V(side * 0.28, 0.12, 0.04), V(side * 0.5, -0.25, 0.1), 0.03, 0.3);
      // Long sprinting legs
      const leg = ctx.joint(`leg${n}`, side * 0.08, -0.45, 0);
      ctx.limbIn(leg, mat, V(side * 0.08, -0.45, 0), V(side * 0.15, -0.95, 0.04), 0.075);
      const shin = ctx.joint(`shin${n}`, side * 0.15, -0.95, 0.04, leg);
      ctx.limbIn(shin, mat, V(side * 0.15, -0.95, 0.04), V(side * 0.2, -1.43, 0), 0.065);
    }

    // Hooded head — a cowl silhouette, no face.
    const head = ctx.joint("head", 0, 0.58, 0, spine);
    const hoodMat = ctx.smat("ceifador_hood", () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.85, side: THREE.DoubleSide }));
    const hood = new THREE.Mesh(ctx.sgeo("ceifador_hood_geo", () => new THREE.ConeGeometry(0.18, 0.4, 8, 1, true)), hoodMat);
    hood.position.set(0, 0.78, 0);
    ctx.put(head, hood);

    // A single point of pale light where a face would be — all that's visible under the hood.
    const eyeMat = ctx.smat("ceifador_eye", () => new THREE.MeshStandardMaterial({ color: 0xe5e7eb, emissive: 0xf8fafc, emissiveIntensity: 1.2 }));
    const eye = new THREE.Mesh(ctx.sgeo("ceifador_eye_geo", () => new THREE.SphereGeometry(0.025, 6, 6)), eyeMat);
    eye.position.set(0, 0.68, 0.1);
    ctx.put(head, eye);
  },

  animate(ctx) {
    // A sprinter: deep knee drive, blades pumping and angled forward when it runs.
    animateBiped(ctx, { stride: 0.6, armSwing: 0.5, knee: 1.2, elbow: 0.5, lean: 0.55, bounce: 0.07, breathe: 0.02, reach: 0.4 });
  },

  sense(ctx) {
    if (ctx.distanceMeters < SENSE_RADIUS) {
      return { chasing: true, speed: CHASE_SPEED };
    }
    return { chasing: false, speed: IDLE_SPEED };
  },

  speech(ctx) {
    return { key: "" };
  },

  // Deliberately unused by RadarHUD (kept off the radar entirely, same
  // treatment as FINGER_KING) — placeholder only, for interface completeness.
  radar: { color: "#000000", strokeColor: "#000000", labelKey: "radar.anomaly" },
};
