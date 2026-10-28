/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O OBSERVADOR: a tall humanoid covered in small eyes. Answers "ele está me
 * vendo?" — the inverse of HOUND's gaze-freeze: sustained direct eye
 * contact from the player escalates it instead of intimidating it. Once
 * the stare crosses the threshold it commits fully and rushes, the same
 * one-way "reveal" shape SKIN_STEALER already uses (isAgitated, once true,
 * never resets) — reused here rather than invented fresh.
 *
 * Scope note: every mob's mesh is billboarded to always face the player
 * (WanderingEntity.update()'s step 2), so a true "is the player inside
 * MY forward cone" check would be vacuous today (it always is). The doc's
 * "possui campo de visão" is therefore expressed as the player's gaze
 * cone onto it (mirroring HOUND's own gaze math) rather than its own —
 * avoiding the player's eye contact is still the whole mechanic, just
 * without a sneak-through-its-peripheral-vision nuance.
 */

import * as THREE from "three";
import { bake, hand, ribcage } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped } from "./anim";

const GAZE_COS_THRESHOLD = 0.86; // a fairly direct stare, narrower cone than HOUND's 0.81
const SENSE_RADIUS = 18;
const STARE_THRESHOLD_S = 3.0;
const WATCH_SPEED = 1.05;
const RUSH_SPEED = 3.55;

/** Eyes scattered over the body. */
const EYES = 22;

export const observador: MobDefinition = {
  type: EntityType.OBSERVADOR,
  baseSpeed: WATCH_SPEED,
  baseHeight: 1.5, // unnaturally tall
  strideLength: 1.1,
  stepWeight: 0.5,
  facesViewer: true,
  bobFreq: 1.4, bobAmp: 0.04, // mostly still, a slow watching sway
  speechBubbleLocalY: 1.0,
  forcedChaseSpeed: 3.6,

  build(ctx) {
    const V = ctx.V;
    const skinMat = ctx.smat("observador_skin", () => new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.6 }));
    const lidMat = ctx.smat("observador_lid", () => new THREE.MeshStandardMaterial({ color: 0x12080c, roughness: 0.45 }));

    // Tall, thin torso: a narrow ribcage over a pinched belly, bony shoulders.
    const spine = ctx.joint("spine", 0, -0.5, 0);
    bake(ctx, spine, skinMat, "observador_trunk", (p) => {
      p.blob(V(0, -0.48, 0), 0.1, [1.3, 0.7, 1]);
      p.chain([V(0, -0.5, 0), V(0, -0.05, 0.01), V(0, 0.3, 0.01), V(0, 0.55, 0)], 0.12, 0.13);
      ribcage(p, { c: V(0, 0.25, 0.005), w: 0.14, d: 0.12, h: 0.17, ribs: 7, r: 0.011 });
      for (const s of [-1, 1]) p.blob(V(s * 0.11, 0.46, 0), 0.055, [1, 0.8, 1]);
      p.limb(V(0, 0.55, 0), V(0, 0.66, 0.01), 0.05, 0.9);
    });

    // Long thin arms hanging at the sides on hands of long, jointed fingers;
    // long thin legs on narrow feet.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.12, 0.45, 0), elbow = V(side * 0.15, -0.05, 0.03), wrist = V(side * 0.16, -0.58, 0.05);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, skinMat, shoulder, elbow, 0.045, 0.8);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, skinMat, elbow, wrist, 0.038, 0.75);
      bake(ctx, fore, skinMat, `observador_hand_${side}`, (p) => hand(p, { wrist, dir: wrist.clone().sub(elbow), across: V(0, 0, side), fingers: 4, len: 0.21, r: 0.011, curl: 0.4 }));
      const leg = ctx.joint(`leg${n}`, side * 0.06, -0.5, 0);
      ctx.limbIn(leg, skinMat, V(side * 0.06, -0.5, 0), V(side * 0.08, -1.0, 0.03), 0.065, 0.75);
      const shin = ctx.joint(`shin${n}`, side * 0.08, -1.0, 0.03, leg);
      bake(ctx, shin, skinMat, `observador_shin_${side}`, (p) => {
        p.limb(V(side * 0.08, -1.0, 0.03), V(side * 0.1, -1.46, 0), 0.05, 0.7);
        p.blob(V(side * 0.1, -1.485, 0.06), 0.035, [1, 0.5, 2.4]);
      });
    }

    // Elongated head, faceless but for a lipless slit of a mouth.
    const head = ctx.joint("head", 0, 0.62, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("observador_head", () => new THREE.SphereGeometry(0.16, 16, 12)), skinMat);
    skull.position.set(0, 0.78, 0);
    skull.scale.set(0.85, 1.3, 0.85);
    ctx.put(head, skull);
    bake(ctx, head, lidMat, "observador_mouth", (p) => p.box(V(0, 0.7, 0.125), [0.07, 0.008, 0.02]));

    // Small eyes scattered deterministically over the torso/head (golden-angle
    // spiral, same technique CLUMP uses for its spikes, so it looks identical
    // on every instance), each set in the skin of the torso inside a dark,
    // wet lid. Each sits on its own pivot so it can blink.
    const eyeMat = ctx.smat("observador_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfde68a, emissiveIntensity: 1.3 }));
    const eyeGeo = ctx.sgeo("observador_eye_geo", () => new THREE.SphereGeometry(0.02, 8, 6));
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < EYES; i++) {
      const t = i / EYES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const y = 0.15 + Math.cos(theta) * 0.35;
      // On the trunk's surface (its radius is ~0.13-0.15 over this span).
      const r = 0.145 + ((i * 53) % 7) / 400;
      spots.push(V(Math.cos(phi) * r, y, Math.sin(phi) * r));
    }
    bake(ctx, spine, lidMat, "observador_lids", (p) => {
      for (const s of spots) p.blob(s.clone().multiplyScalar(0.99).setY(s.y), 0.03, [1, 0.75, 1]);
    });
    spots.forEach((s, i) => {
      const socket = ctx.joint(`eye${i}`, s.x, s.y, s.z, spine);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.copy(s).setX(s.x * 1.06).setZ(s.z * 1.06);
      ctx.put(socket, eye);
    });
  },

  animate(ctx) {
    // Slow, measured steps; when it stops to watch, it goes rigid and every
    // eye on its body widens while they blink out of sync.
    animateBiped(ctx, { stride: 0.3, armSwing: 0.12, knee: 0.6, elbow: 0.05, lean: 0.15, bounce: 0.03, breathe: 0.02, headReach: 1.2 });
    const { time, observe } = ctx;
    for (let i = 0; i < EYES; i++) {
      const eye = ctx.joints[`eye${i}`];
      if (!eye) continue;
      const blink = Math.sin(time * (0.7 + (i % 5) * 0.23) + i * 2.1) > 0.97 ? 0.1 : 1;
      const wide = 1 + observe * 0.5;
      eye.scale.set(wide, wide * blink, wide);
    }
  },

  sense(ctx) {
    if (ctx.isAgitated) {
      // Fully escalated: a permanent, committed charge (mirrors SKIN_STEALER's one-way reveal).
      return { chasing: true, speed: RUSH_SPEED };
    }

    const pPos = new THREE.Vector3(ctx.playerX, 1.6, ctx.playerZ);
    const toSelf = new THREE.Vector3().subVectors(ctx.entityPos, pPos).normalize();
    const isGazedAt = ctx.cameraDir ? ctx.cameraDir.dot(toSelf) > GAZE_COS_THRESHOLD : false;

    if (isGazedAt && ctx.distanceMeters < SENSE_RADIUS) {
      const stareTime = ctx.scratch + ctx.delta;
      if (stareTime >= STARE_THRESHOLD_S) {
        return { chasing: true, speed: RUSH_SPEED, agitated: true, scratch: stareTime };
      }
      return { chasing: false, speed: WATCH_SPEED, scratch: stareTime };
    }

    // Looked away: the stare timer cools rather than resetting instantly — a quick glance away and back still counts.
    const cooled = Math.max(0, ctx.scratch - ctx.delta * 0.5);
    return { chasing: false, speed: WATCH_SPEED, scratch: cooled };
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#e2e8f0", strokeColor: "#94a3b8", labelKey: "radar.observador" },
};
