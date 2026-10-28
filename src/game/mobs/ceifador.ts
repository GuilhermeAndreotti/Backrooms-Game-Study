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
import { bake } from "./anatomy";
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
    const mat = ctx.smat("ceifador_body", () => new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.5, metalness: 0.3 }));
    const clothMat = ctx.smat("ceifador_hood", () => new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.9, side: THREE.DoubleSide }));
    const bladeMat = ctx.smat("ceifador_blade", () => new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.3, metalness: 0.45 }));
    const voidMat = ctx.smat("ceifador_void", () => new THREE.MeshBasicMaterial({ color: 0x000000 }));

    // Tall, gaunt frame — built for speed, not bulk — inside a long, frayed
    // shroud that hangs from its shoulders to below the knee.
    const spine = ctx.joint("spine", 0, -0.45, 0);
    ctx.limbIn(spine, mat, V(0, 0.55, 0), V(0, -0.45, 0), 0.1);
    bake(ctx, spine, clothMat, "ceifador_shroud", (p) => {
      p.lathe(V(0, 0, 0), [[0.07, 0.6], [0.15, 0.53], [0.2, 0.42], [0.18, 0.15], [0.2, -0.2], [0.26, -0.55], [0.31, -0.8]], 16, [1, 1, 0.85]);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        const x = Math.sin(a) * 0.3, z = Math.cos(a) * 0.26;
        p.blade(V(x, -0.75, z), V(x * 1.05, -0.98 - (i % 3) * 0.06, z * 1.05), 0.12, 0.01, a);
      }
    });
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      // Arms that end not in hands but in long, bony blades.
      const shoulder = V(side * 0.12, 0.45, 0), elbow = V(side * 0.28, 0.12, 0.04), wrist = V(side * 0.42, -0.12, 0.08);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, clothMat, shoulder, elbow, 0.05, 0.85); // sleeve
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, mat, elbow, wrist, 0.03, 0.8);
      bake(ctx, fore, bladeMat, `ceifador_blade_${side}`, (p) => {
        const tip = V(side * 0.62, -0.62, 0.16);
        p.blade(wrist, tip, 0.07, 0.012);
        p.blade(elbow, wrist, 0.04, 0.012); // a ridge along the forearm
      });
      // Long sprinting legs
      const leg = ctx.joint(`leg${n}`, side * 0.08, -0.45, 0);
      ctx.limbIn(leg, mat, V(side * 0.08, -0.45, 0), V(side * 0.15, -0.95, 0.04), 0.07, 0.8);
      const shin = ctx.joint(`shin${n}`, side * 0.15, -0.95, 0.04, leg);
      bake(ctx, shin, mat, `ceifador_shin_${side}`, (p) => {
        p.limb(V(side * 0.15, -0.95, 0.04), V(side * 0.19, -1.36, 0), 0.055, 0.7);
        p.limb(V(side * 0.19, -1.38, 0.0), V(side * 0.2, -1.42, 0.16), 0.03, 0.5);
      });
    }

    // A deep cowl, peaked at the back, with nothing inside it but dark and
    // a single point of pale light where a face would be.
    const head = ctx.joint("head", 0, 0.58, 0, spine);
    bake(ctx, head, clothMat, "ceifador_cowl", (p) => {
      p.list.push([new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72),
        new THREE.Matrix4().compose(V(0, 0.74, -0.02), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.95, 0, 0)), new THREE.Vector3(1, 1.15, 1))]);
      p.spike(V(0, 0.86, -0.1), V(0, 0.98, -0.24), 0.07, 8);
    });
    bake(ctx, head, voidMat, "ceifador_void", (p) => p.blob(V(0, 0.71, 0.0), 0.13, [1, 1.15, 0.9]));
    const eyeMat = ctx.smat("ceifador_eye", () => new THREE.MeshStandardMaterial({ color: 0xe5e7eb, emissive: 0xf8fafc, emissiveIntensity: 1.2 }));
    const eye = new THREE.Mesh(ctx.sgeo("ceifador_eye_geo", () => new THREE.SphereGeometry(0.022, 8, 6)), eyeMat);
    eye.position.set(0, 0.71, 0.115);
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
