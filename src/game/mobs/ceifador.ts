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

const SENSE_RADIUS = 22;
const IDLE_SPEED = 1.3;
/** Fastest in the roster, still shy of the player's 4.2 m/s sprint cap. */
const CHASE_SPEED = 3.9;

export const ceifador: MobDefinition = {
  type: EntityType.CEIFADOR,
  baseSpeed: IDLE_SPEED,
  baseHeight: 1.45,
  bobFreq: 4.0, bobAmp: 0.07, // fast, purposeful stride
  speechBubbleLocalY: 1.05,
  forcedChaseSpeed: CHASE_SPEED,

  build(ctx) {
    const { group } = ctx;
    const mat = ctx.smat("ceifador_body", () => new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0.3 }));

    // Tall, gaunt frame — built for speed, not bulk.
    group.add(ctx.limbBetween(mat, ctx.V(0, 0.55, 0), ctx.V(0, -0.45, 0), 0.11));
    // Blade-like arms, angled sharply
    group.add(ctx.limbBetween(mat, ctx.V(0, 0.45, 0), ctx.V(-0.5, -0.1, 0.1), 0.035, 0.4));
    group.add(ctx.limbBetween(mat, ctx.V(0, 0.45, 0), ctx.V(0.5, -0.1, -0.1), 0.035, 0.4));
    // Long sprinting legs
    group.add(ctx.limbBetween(mat, ctx.V(-0.08, -0.45, 0), ctx.V(-0.22, -1.4, 0.15), 0.075));
    group.add(ctx.limbBetween(mat, ctx.V(0.08, -0.45, 0), ctx.V(0.22, -1.4, -0.15), 0.075));

    // Hooded head — a cowl silhouette, no face.
    const hoodMat = ctx.smat("ceifador_hood", () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.85, side: THREE.DoubleSide }));
    const hood = new THREE.Mesh(ctx.sgeo("ceifador_hood_geo", () => new THREE.ConeGeometry(0.18, 0.4, 8, 1, true)), hoodMat);
    hood.position.set(0, 0.78, 0);
    group.add(hood);

    // A single point of pale light where a face would be — all that's visible under the hood.
    const eyeMat = ctx.smat("ceifador_eye", () => new THREE.MeshStandardMaterial({ color: 0xe5e7eb, emissive: 0xf8fafc, emissiveIntensity: 1.2 }));
    const eye = new THREE.Mesh(ctx.sgeo("ceifador_eye_geo", () => new THREE.SphereGeometry(0.025, 6, 6)), eyeMat);
    eye.position.set(0, 0.68, 0.1);
    group.add(eye);
  },

  sense(ctx) {
    if (ctx.distanceMeters < SENSE_RADIUS) {
      return { chasing: true, speed: CHASE_SPEED };
    }
    return { chasing: false, speed: IDLE_SPEED };
  },

  speech(ctx) {
    return { key: ctx.isChasing ? "sp.ceifador.chase" : "" };
  },

  // Deliberately unused by RadarHUD (kept off the radar entirely, same
  // treatment as FINGER_KING) — placeholder only, for interface completeness.
  radar: { color: "#000000", strokeColor: "#000000", labelKey: "radar.anomaly" },
};
