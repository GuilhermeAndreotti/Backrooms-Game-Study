/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O ALIEN: Level 79's only inhabitant. A tall, glossy, eyeless biped with an
 * elongated skull and a bladed tail that walks the station's corridors and
 * looks into its cabins at random.
 *
 * Its rules (implemented in WanderingEntity's "O Alien" section, since they
 * need pathing state a MobDefinition can't keep):
 * - patrol: walks between corridor junctions and cabins it picks at random,
 *   never using where anyone is, and lingers in each cabin it inspects;
 * - chase: once it sees someone (a cone in front of it, anything close behind
 *   it, footsteps of someone running nearby, or anyone who walks into the
 *   cabin it is already in), it runs them down;
 * - while chasing (and while searching afterwards) it never *enters* a cabin:
 *   ducking into navigation, engineering, the lab... loses it. It searches the
 *   corridor for a few seconds and leaves that cabin alone for a while.
 *
 * sense() is therefore only the calm default; the engine never calls it for
 * this type.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { animateBiped, rot, rx } from "./anim";

/** m/s: an unhurried prowl, a search, and a sprint just under a running explorer's 4.8. */
export const ALIEN_PATROL_SPEED = 1.45;
export const ALIEN_SEARCH_SPEED = 2.1;
export const ALIEN_CHASE_SPEED = 4.3;
/** Metres it can see along its facing, and the half-angle of that cone (rad). */
export const ALIEN_SIGHT_RANGE = 30;
export const ALIEN_SIGHT_HALF_ANGLE = 1.05;
/** Anyone this close is noticed whichever way it faces. */
export const ALIEN_FEEL_RANGE = 3.5;
/** Running footsteps give someone away within this range (still needs a clear line). */
export const ALIEN_HEAR_RANGE = 10;
/** Seconds it keeps heading for the last place it saw someone before it starts searching. */
export const ALIEN_LOSE_SECONDS = 5;
/** Seconds it spends searching the corridor after losing someone. */
export const ALIEN_SEARCH_SECONDS = 6;
/** Seconds it leaves a cabin alone after someone escaped into it. */
export const ALIEN_CABIN_BAN_SECONDS = 35;

export const alien: MobDefinition = {
  type: EntityType.ALIEN,
  baseSpeed: ALIEN_PATROL_SPEED,
  baseHeight: 1.15,
  strideLength: 1.9,
  stepWeight: 0.45,
  calmIgnoresViewer: true,
  bobFreq: 0.9, bobAmp: 0.015,
  speechBubbleLocalY: 1.4,
  forcedChaseSpeed: ALIEN_CHASE_SPEED,

  build(ctx) {
    const V = ctx.V;
    const hide = ctx.smat("alien_hide", () => new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.22, metalness: 0.55 }));
    const bone = ctx.smat("alien_bone", () => new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.35, metalness: 0.4 }));
    const teeth = ctx.smat("alien_teeth", () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.3, metalness: 0.6 }));
    // A faint wet sheen along the skull and spine: the only thing that catches the station lights.
    const sheen = new THREE.MeshStandardMaterial({ color: 0x1a2a33, emissive: 0x0d3b4a, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.7 });
    ctx.addTintMaterial(sheen);

    // Torso: a narrow, hunched trunk with ribs showing through the hide.
    const spine = ctx.joint("spine", 0, 0.05, 0);
    ctx.limbIn(spine, hide, V(0, 0.02, -0.02), V(0, 0.72, 0.14), 0.15, 0.75);
    for (let i = 0; i < 4; i++) {
      const y = 0.3 + i * 0.1;
      for (const side of [-1, 1]) ctx.limbIn(spine, bone, V(side * 0.03, y, 0.15), V(side * 0.15, y - 0.06, 0.05), 0.018, 0.7);
    }
    // Dorsal tubes, curving back from the shoulders: its silhouette from behind.
    for (const side of [-1, 1]) {
      ctx.limbIn(spine, bone, V(side * 0.08, 0.62, -0.02), V(side * 0.22, 0.95, -0.32), 0.035, 0.55);
      ctx.limbIn(spine, bone, V(side * 0.06, 0.48, -0.06), V(side * 0.16, 0.72, -0.36), 0.03, 0.5);
    }

    // Head: a long, eyeless skull swept back over the shoulders, with a hinged jaw.
    const head = ctx.joint("head", 0, 0.8, 0.18, spine);
    ctx.limbIn(head, hide, V(0, 0.72, 0.12), V(0, 0.88, 0.24), 0.06);
    ctx.limbIn(head, sheen, V(0, 0.9, 0.42), V(0, 1.12, -0.28), 0.12, 0.35);
    const face = new THREE.Mesh(ctx.sgeo("alien_face", () => new THREE.SphereGeometry(0.11, 10, 8)), hide);
    face.scale.set(0.9, 0.8, 1.2);
    face.position.set(0, 0.88, 0.38);
    ctx.put(head, face);
    ctx.joint("face", 0, 0.88, 0.48, head);
    const jaw = ctx.joint("jaw", 0, 0.84, 0.3, head);
    const jawMesh = new THREE.Mesh(ctx.sgeo("alien_jaw", () => new THREE.BoxGeometry(0.11, 0.04, 0.2)), hide);
    jawMesh.position.set(0, 0.8, 0.4);
    ctx.put(jaw, jawMesh);
    const toothGeo = ctx.sgeo("alien_tooth", () => new THREE.ConeGeometry(0.008, 0.04, 4));
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(toothGeo, teeth);
      tooth.position.set(-0.04 + i * 0.02, 0.84, 0.47);
      ctx.put(head, tooth).rotation.x = Math.PI;
      const lower = new THREE.Mesh(toothGeo, teeth);
      lower.position.set(-0.04 + i * 0.02, 0.83, 0.47);
      ctx.put(jaw, lower);
    }

    // Long, thin arms ending in three hooked claws.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.2, 0.64, 0.1);
      const elbow = V(side * 0.3, 0.2, 0.16);
      const wrist = V(side * 0.32, -0.22, 0.24);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, hide, shoulder, elbow, 0.045, 0.8);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, hide, elbow, wrist, 0.036, 0.75);
      for (let f = 0; f < 3; f++) {
        const spread = (f - 1) * 0.05;
        const knuckle = V(wrist.x + side * 0.02 + spread, wrist.y - 0.16, wrist.z + 0.06);
        ctx.limbIn(fore, bone, wrist, knuckle, 0.014, 0.7);
        ctx.limbIn(fore, teeth, knuckle, V(knuckle.x, knuckle.y - 0.1, knuckle.z + 0.07), 0.009, 0.2);
      }
    }

    // Digitigrade legs: thigh forward, shin back, a long hooked foot.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const hip = V(side * 0.13, 0, 0);
      const knee = V(side * 0.15, -0.5, 0.14);
      const ankle = V(side * 0.16, -0.92, -0.12);
      const toe = V(side * 0.16, -1.13, 0.1);
      const leg = ctx.joint(`leg${n}`, hip.x, hip.y, hip.z);
      ctx.limbIn(leg, hide, hip, knee, 0.075, 0.7);
      const shin = ctx.joint(`shin${n}`, knee.x, knee.y, knee.z, leg);
      ctx.limbIn(shin, hide, knee, ankle, 0.05, 0.7);
      ctx.limbIn(shin, bone, ankle, toe, 0.035, 0.5);
    }

    // A three-segment tail ending in a blade.
    const tail = ctx.joint("tail", 0, -0.02, -0.1);
    ctx.limbIn(tail, hide, V(0, -0.02, -0.1), V(0, -0.25, -0.6), 0.06, 0.7);
    const tail2 = ctx.joint("tail2", 0, -0.25, -0.6, tail);
    ctx.limbIn(tail2, hide, V(0, -0.25, -0.6), V(0, -0.5, -1.1), 0.042, 0.65);
    const tail3 = ctx.joint("tail3", 0, -0.5, -1.1, tail2);
    ctx.limbIn(tail3, bone, V(0, -0.5, -1.1), V(0, -0.62, -1.5), 0.028, 0.5);
    ctx.limbIn(tail3, teeth, V(0, -0.62, -1.5), V(0, -0.6, -1.72), 0.03, 0.05);
  },

  animate(ctx) {
    animateBiped(ctx, { stride: 0.5, armSwing: 0.22, knee: 0.95, elbow: 0.7, lean: 0.6, bounce: 0.05, breathe: 0.025, reach: 0.7, headReach: 0.9 });
    const j = ctx.joints;
    const { time, move, run, chasing, agitated, alertTime } = ctx;

    // Calm, it prowls with its head low and swings it side to side, tasting
    // the air; hunting, it drops into a crouch and the head goes still.
    const prowl = (1 - run) * (chasing ? 0 : 1);
    if (j.spine) j.spine.rotation.x += 0.18 + (chasing ? 0.25 * move : 0);
    if (j.head) {
      j.head.rotation.y += Math.sin(time * 0.7) * 0.45 * prowl * (1 - ctx.look);
      j.head.rotation.x += 0.15 * prowl;
    }

    // The moment it spots someone: it rears up, head thrown back, jaw wide.
    const rear = alertTime < 0.9 ? Math.sin((alertTime / 0.9) * Math.PI) : 0;
    if (rear > 0) {
      if (j.spine) j.spine.rotation.x -= 0.5 * rear;
      if (j.head) j.head.rotation.x -= 0.7 * rear;
      rot(j.armL, -0.6 * rear, 0, -0.6 * rear);
      rot(j.armR, -0.6 * rear, 0, 0.6 * rear);
    }
    rx(j.jaw, Math.max(rear * 0.7, (agitated || chasing ? 0.3 : 0.04) * (0.5 + 0.5 * Math.sin(time * 7))));

    // Tail: a slow sway behind it, streaming out straight while it runs.
    const sway = Math.sin(time * (1.1 + move * 2.5));
    if (j.tail) j.tail.rotation.set(-0.1 + run * move * 0.35, sway * 0.3, 0);
    if (j.tail2) j.tail2.rotation.set(-0.05 + run * move * 0.2, Math.sin(time * (1.1 + move * 2.5) - 0.9) * 0.35, 0);
    if (j.tail3) j.tail3.rotation.set(0.1, Math.sin(time * (1.1 + move * 2.5) - 1.8) * 0.4, 0);
  },

  sense() {
    // Never called: WanderingEntity runs O Alien's own brain (see the file doc).
    return { chasing: false, speed: ALIEN_PATROL_SPEED };
  },

  updateVisual(ctx) {
    // The sheen flares while it hunts.
    const hot = ctx.isChasing || ctx.isAgitated;
    for (const m of ctx.tintMaterials) m.emissiveIntensity = hot ? 1.4 : 0.6;
  },

  radar: { color: "#0e7490", strokeColor: "#22d3ee", labelKey: "radar.alien" },
};
