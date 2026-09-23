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

const GAZE_COS_THRESHOLD = 0.86; // a fairly direct stare, narrower cone than HOUND's 0.81
const SENSE_RADIUS = 18;
const STARE_THRESHOLD_S = 3.0;
const WATCH_SPEED = 1.05;
const RUSH_SPEED = 3.55;

export const observador: MobDefinition = {
  type: EntityType.OBSERVADOR,
  baseSpeed: WATCH_SPEED,
  baseHeight: 1.5, // unnaturally tall
  bobFreq: 1.4, bobAmp: 0.04, // mostly still, a slow watching sway
  speechBubbleLocalY: 1.0,
  forcedChaseSpeed: 3.6,

  build(ctx) {
    const { group } = ctx;
    const skinMat = ctx.smat("observador_skin", () => new THREE.MeshStandardMaterial({ color: 0x241f2e, roughness: 0.75 }));

    // Tall, thin torso
    group.add(ctx.limbBetween(skinMat, ctx.V(0, 0.6, 0), ctx.V(0, -0.5, 0), 0.16));
    // Long thin arms hanging at the sides
    group.add(ctx.limbBetween(skinMat, ctx.V(0, 0.45, 0), ctx.V(-0.12, -0.55, 0.05), 0.05));
    group.add(ctx.limbBetween(skinMat, ctx.V(0, 0.45, 0), ctx.V(0.12, -0.55, 0.05), 0.05));
    // Long thin legs
    group.add(ctx.limbBetween(skinMat, ctx.V(-0.06, -0.5, 0), ctx.V(-0.1, -1.5, 0), 0.07));
    group.add(ctx.limbBetween(skinMat, ctx.V(0.06, -0.5, 0), ctx.V(0.1, -1.5, 0), 0.07));

    // Elongated head
    const head = new THREE.Mesh(ctx.sgeo("observador_head", () => new THREE.SphereGeometry(0.16, 10, 8)), skinMat);
    head.position.set(0, 0.78, 0);
    head.scale.set(0.85, 1.3, 0.85);
    group.add(head);

    // Small eyes scattered deterministically over the torso/head (golden-angle
    // spiral, same technique CLUMP uses for its spikes, so it looks identical
    // on every instance).
    const eyeMat = ctx.smat("observador_eye", () => new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfde68a, emissiveIntensity: 1.3 }));
    const eyeGeo = ctx.sgeo("observador_eye_geo", () => new THREE.SphereGeometry(0.02, 6, 6));
    const EYES = 22;
    for (let i = 0; i < EYES; i++) {
      const t = i / EYES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 0.14 + ((i * 53) % 7) / 60;
      const y = 0.15 + Math.cos(theta) * 0.35;
      const x = Math.sin(theta) * Math.cos(phi) * r;
      const z = Math.sin(theta) * Math.sin(phi) * r;
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, y, z);
      group.add(eye);
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
