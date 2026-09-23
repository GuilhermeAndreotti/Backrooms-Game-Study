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
    const skinMat = ctx.smat("observador_skin", () => new THREE.MeshStandardMaterial({ color: 0x241f2e, roughness: 0.75 }));

    // Tall, thin torso
    const spine = ctx.joint("spine", 0, -0.5, 0);
    ctx.limbIn(spine, skinMat, V(0, 0.6, 0), V(0, -0.5, 0), 0.16);
    // Long thin arms hanging at the sides; long thin legs
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const arm = ctx.joint(`arm${n}`, side * 0.1, 0.45, 0, spine);
      ctx.limbIn(arm, skinMat, V(side * 0.1, 0.45, 0), V(side * 0.14, -0.05, 0.03), 0.05);
      const fore = ctx.joint(`fore${n}`, side * 0.14, -0.05, 0.03, arm);
      ctx.limbIn(fore, skinMat, V(side * 0.14, -0.05, 0.03), V(side * 0.16, -0.58, 0.05), 0.045);
      const leg = ctx.joint(`leg${n}`, side * 0.06, -0.5, 0);
      ctx.limbIn(leg, skinMat, V(side * 0.06, -0.5, 0), V(side * 0.08, -1.0, 0.03), 0.07);
      const shin = ctx.joint(`shin${n}`, side * 0.08, -1.0, 0.03, leg);
      ctx.limbIn(shin, skinMat, V(side * 0.08, -1.0, 0.03), V(side * 0.1, -1.5, 0), 0.06);
    }

    // Elongated head
    const head = ctx.joint("head", 0, 0.62, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("observador_head", () => new THREE.SphereGeometry(0.16, 10, 8)), skinMat);
    skull.position.set(0, 0.78, 0);
    skull.scale.set(0.85, 1.3, 0.85);
    ctx.put(head, skull);

    // Small eyes scattered deterministically over the torso/head (golden-angle
    // spiral, same technique CLUMP uses for its spikes, so it looks identical
    // on every instance). Each sits on its own pivot so it can blink.
    const eyeMat = ctx.smat("observador_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfde68a, emissiveIntensity: 1.3 }));
    const eyeGeo = ctx.sgeo("observador_eye_geo", () => new THREE.SphereGeometry(0.02, 6, 6));
    for (let i = 0; i < EYES; i++) {
      const t = i / EYES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 0.14 + ((i * 53) % 7) / 60;
      const y = 0.15 + Math.cos(theta) * 0.35;
      const x = Math.sin(theta) * Math.cos(phi) * r;
      const z = Math.sin(theta) * Math.sin(phi) * r;
      const socket = ctx.joint(`eye${i}`, x, y, z, spine);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, y, z);
      ctx.put(socket, eye);
    }
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
