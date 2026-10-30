/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * O VIGIA: the Poolrooms' drowned lifeguard. Over three metres of pale,
 * waterlogged skin on long wading legs, arms that hang past its knees, an
 * old pair of swimming goggles sunk into a face with nothing else on it, a
 * whistle on a cord and a faded rescue float at its hip. One keeps Part 2
 * and one Part 3. Its behaviour there is its own state machine,
 * mobs/vigiaBrain.ts, which WanderingEntity runs instead of sense() below.
 * This file is its body: build, animation and the poses the brain streams
 * to every client (MobSenseResult.pose, VIGIA_POSE):
 *
 *   0 calm (rounds; sweeping the water from a post) · 1 listening (head
 *   cocked) · 2 hunting (the whistle, then the run) · 3 reaching up at
 *   someone out of reach · 4 peering over a well's rim, one arm stretched
 *   down into it.
 *
 * sense() remains only as a fallback for a Vigia outside Parts 2 and 3.
 */

import * as THREE from "three";
import { sculptedHead } from "./sculpt";
import { bake, teeth } from "./anatomy";
import { EntityType } from "../../shared/entityTypes";
import { MobAnimCtx, MobDefinition } from "./types";
import { animateBiped, rot } from "./anim";
import { VIGIA_POSE } from "../levels/poolLayout";

/** Fallback sense() (outside the Poolrooms' Parts 2 and 3): a plain sight-range watcher. */
const VISION_RANGE = 24;
const CHASE_SPEED = 2.4;
/** Its rounds are a slow wade. */
const STILL_SPEED = 0.6;

/** Smoothed 0..1 weights of its poses, kept per instance on the body root. */
interface PoseBlend { hunt: number; whistle: number; listen: number; up: number; peer: number }

function poseBlend(ctx: MobAnimCtx): PoseBlend {
  const w = (ctx.body.userData.vigiaPose ??= { hunt: 0, whistle: 0, listen: 0, up: 0, peer: 0 }) as PoseBlend;
  const damp = (v: number, on: boolean, rate: number) => THREE.MathUtils.damp(v, on ? 1 : 0, rate, ctx.delta);
  const p = ctx.pose;
  // Blowing the whistle: the beat it stands, having spotted you, before it runs.
  const whistling = p === VIGIA_POSE.HUNT && !ctx.chasing && ctx.move < 0.3;
  w.hunt = damp(w.hunt, p === VIGIA_POSE.HUNT || ctx.chasing, 5);
  w.whistle = damp(w.whistle, whistling, 9);
  w.listen = damp(w.listen, p === VIGIA_POSE.LISTEN, 3);
  w.up = damp(w.up, p === VIGIA_POSE.REACH_UP, 4);
  w.peer = damp(w.peer, p === VIGIA_POSE.PEER, 2.5);
  return w;
}

export const vigia: MobDefinition = {
  type: EntityType.VIGIA,
  baseSpeed: STILL_SPEED,
  baseHeight: 1.75,
  strideLength: 1.7,
  stepWeight: 0.8,
  // On its rounds it looks where it walks (or where its mind turns it); once it's onto someone it turns to them.
  calmIgnoresViewer: true,
  // Long arms: it grabs from a little further than most (its height reach is VIGIA_REACH_UP;
  // bent over a well, VIGIA_WELL_REACH).
  catchRadius: 1.7,
  bobFreq: 0.5, bobAmp: 0.02,
  speechBubbleLocalY: 1.6,
  forcedChaseSpeed: 2.2,

  build(ctx) {
    const V = ctx.V;
    const skin = ctx.smat("vigia_skin", () => new THREE.MeshStandardMaterial({ color: 0x8d9a98, roughness: 0.55 }));
    const limb = ctx.smat("vigia_limb", () => new THREE.MeshStandardMaterial({ color: 0x7f8c8a, roughness: 0.6 }));
    const trunks = ctx.smat("vigia_trunks", () => new THREE.MeshStandardMaterial({ color: 0x6e2a25, roughness: 0.9 }));
    const strap = ctx.smat("vigia_strap", () => new THREE.MeshStandardMaterial({ color: 0x2b2f30, roughness: 0.8 }));
    const float = ctx.smat("vigia_float", () => new THREE.MeshStandardMaterial({ color: 0xa4432f, roughness: 0.7 }));
    const metal = ctx.smat("vigia_whistle", () => new THREE.MeshStandardMaterial({ color: 0x9a9483, metalness: 0.8, roughness: 0.35 }));
    const mouth = ctx.smat("vigia_mouth", () => new THREE.MeshStandardMaterial({ color: 0x0a0809, roughness: 1 }));
    const bone = ctx.smat("vigia_teeth", () => new THREE.MeshStandardMaterial({ color: 0xa79d84, roughness: 0.5 }));

    // A long, starved torso on a narrow pelvis: ribs pressing through the skin,
    // a sunken belly, shoulders rolled forward from years bent over the water.
    const spine = ctx.joint("spine", 0, 0, 0);
    bake(ctx, spine, skin, "vigia_torso", (p) => {
      p.lathe(V(0, -0.1, 0), [[0.15, 0], [0.17, 0.12], [0.14, 0.32], [0.17, 0.5], [0.22, 0.68], [0.25, 0.84], [0.2, 0.93], [0.08, 0.98]], 16, [1, 1, 0.7]);
      for (let i = 0; i < 5; i++) {
        const y = 0.42 + i * 0.08, r = 0.16 + i * 0.012;
        p.lathe(V(0, y, 0.01), [[r, -0.012], [r + 0.016, 0], [r, 0.012]], 16, [1, 1, 0.72]); // ribs
      }
      for (const s of [-1, 1]) p.blob(V(s * 0.24, 0.8, -0.02), 0.08, [1, 0.8, 1]); // shoulder knobs
      p.blob(V(0, 0.84, -0.1), 0.13, [1.4, 0.7, 0.8]); // the rounded hump of its back
      p.limb(V(0, 0.9, 0.02), V(0, 1.02, 0.16), 0.065, 0.85); // neck, craned forward
    });
    // Old swim trunks, the colour long gone out of them.
    bake(ctx, spine, trunks, "vigia_trunks", (p) => {
      p.lathe(V(0, -0.2, 0), [[0.165, 0], [0.18, 0.08], [0.175, 0.2], [0.162, 0.24]], 16, [1, 1, 0.74]);
    });
    // The lanyard of its whistle, and the strap of the float slung across it.
    bake(ctx, spine, strap, "vigia_straps", (p) => {
      p.chain([V(-0.08, 0.93, 0.1), V(-0.06, 0.72, 0.17), V(0, 0.56, 0.2)], 0.007);
      p.chain([V(0.08, 0.93, 0.1), V(0.06, 0.72, 0.17), V(0, 0.56, 0.2)], 0.007);
      p.chain([V(-0.22, 0.84, 0.06), V(-0.08, 0.5, 0.16), V(0.1, 0.2, 0.15), V(0.2, 0.05, 0.04)], 0.012);
    });
    bake(ctx, spine, metal, "vigia_whistle", (p) => {
      p.box(V(0, 0.53, 0.21), [0.035, 0.03, 0.06]);
      p.lathe(V(0, 0.53, 0.18), [[0.022, -0.015], [0.026, 0], [0.022, 0.015]], 10);
    });
    // The rescue float, hanging at its right hip.
    bake(ctx, spine, float, "vigia_float", (p) => {
      p.limb(V(0.22, 0.1, -0.08), V(0.26, -0.48, -0.03), 0.065, 1, 10);
    });

    // A long, hairless skull with nothing on its face but the goggles.
    const head = ctx.joint("head", 0, 1.0, 0.14, spine);
    const skull = new THREE.Mesh(ctx.sgeo("vigia_skull", () => sculptedHead(0.16, true)), skin);
    skull.position.set(0, 1.16, 0.2);
    skull.scale.set(0.88, 1.28, 1.05);
    skull.castShadow = true;
    ctx.put(head, skull);
    // The goggles: strap round the skull, two rubber frames...
    bake(ctx, head, strap, "vigia_goggle_strap", (p) => {
      p.lathe(V(0, 1.18, 0.19), [[0.142, -0.012], [0.148, 0], [0.142, 0.012]], 18, [1, 1, 1.18]);
      for (const s of [-1, 1]) p.lathe(V(s * 0.062, 1.18, 0.345), [[0.043, -0.012], [0.05, 0], [0.043, 0.016]], 14, [1, 1, 1]);
    });
    // ...and the lenses: the only thing that catches the light (tinted with its state).
    const lens = new THREE.MeshStandardMaterial({ color: 0x9fd8d0, emissive: 0x1d5a55, emissiveIntensity: 0.5, roughness: 0.08, metalness: 0.2 });
    lens.name = "vigia_eye";
    ctx.addTintMaterial(lens);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(ctx.sgeo("vigia_lens", () => new THREE.SphereGeometry(0.042, 14, 10).scale(1, 1, 0.45)), lens);
      eye.position.set(s * 0.062, 1.18, 0.352);
      ctx.put(head, eye);
    }
    // A lipless slit of a mouth on a jaw that drops open far too wide.
    const jaw = ctx.joint("jaw", 0, 1.08, 0.22, head);
    bake(ctx, jaw, skin, "vigia_jaw", (p) => {
      p.blob(V(0, 1.03, 0.29), 0.075, [1.05, 0.45, 0.85]);
    });
    bake(ctx, jaw, mouth, "vigia_mouth", (p) => p.blob(V(0, 1.06, 0.3), 0.055, [1, 0.35, 0.6]));
    bake(ctx, jaw, bone, "vigia_teeth", (p) => teeth(p, V(0, 1.065, 0.335), 0.045, 0.035, 8, 0.018, true, 0.006));

    // Arms that hang past its knees: three long segments, then four jointed
    // fingers, swollen and pale at the tips.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const shoulder = V(side * 0.25, 0.8, 0);
      const elbow = V(side * 0.31, 0.02, 0.03);
      const wrist = V(side * 0.35, -0.76, 0.07);
      const palm = V(side * 0.37, -0.93, 0.08);
      const arm = ctx.joint(`arm${n}`, shoulder.x, shoulder.y, shoulder.z, spine);
      ctx.limbIn(arm, limb, shoulder, elbow, 0.052, 0.78);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, limb, elbow, wrist, 0.042, 0.7);
      const hand = ctx.joint(`hand${n}`, wrist.x, wrist.y, wrist.z, fore);
      bake(ctx, hand, limb, `vigia_palm_${n}`, (p) => {
        p.limb(wrist, palm, 0.032, 1.2);
        p.blob(V(palm.x, palm.y + 0.04, palm.z), 0.045, [0.55, 1, 1.05]);
        // A short thumb, bent in.
        p.chain([V(palm.x, wrist.y - 0.08, wrist.z + 0.035), V(palm.x - side * 0.01, palm.y - 0.02, palm.z + 0.07), V(palm.x - side * 0.02, palm.y - 0.1, palm.z + 0.075)], 0.014, 0.01);
      });
      for (let finger = 0; finger < 4; finger++) {
        const spread = (finger - 1.5) * 0.026;
        const base = V(palm.x, palm.y - 0.04, palm.z + spread);
        const knuckle = V(palm.x + side * 0.008, base.y - 0.13, palm.z + spread * 1.2);
        const mid = V(palm.x + side * 0.012, knuckle.y - 0.12, palm.z + spread * 1.35);
        const tip = V(palm.x + side * 0.01, mid.y - 0.1 + Math.abs(finger - 1.5) * 0.025, palm.z + spread * 1.45);
        const a = ctx.joint(`finger${n}${finger}a`, base.x, base.y, base.z, hand);
        ctx.limbIn(a, limb, base, knuckle, 0.013, 0.85);
        const b = ctx.joint(`finger${n}${finger}b`, knuckle.x, knuckle.y, knuckle.z, a);
        ctx.limbIn(b, limb, knuckle, mid, 0.011, 0.8);
        const c = ctx.joint(`finger${n}${finger}c`, mid.x, mid.y, mid.z, b);
        bake(ctx, c, limb, `vigia_fingertip_${n}${finger}`, (p) => {
          p.limb(mid, tip, 0.0095, 0.9);
          p.blob(tip, 0.012, [1, 1.3, 1]); // waterlogged, swollen
        });
      }
    }

    // Long wading legs on wide, webbed feet.
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const hip = V(side * 0.12, -0.08, 0);
      const knee = V(side * 0.15, -0.92, 0.06);
      const ankle = V(side * 0.16, -1.64, -0.02);
      const leg = ctx.joint(`leg${n}`, hip.x, hip.y, hip.z);
      bake(ctx, leg, skin, `vigia_thigh_${n}`, (p) => {
        p.limb(hip, knee, 0.085, 0.62);
        p.blob(knee, 0.058, [1, 1.15, 1.05]); // knobbed knee
      });
      const shin = ctx.joint(`shin${n}`, knee.x, knee.y, knee.z, leg);
      bake(ctx, shin, skin, `vigia_shin_${n}`, (p) => {
        p.limb(knee, ankle, 0.055, 0.7);
        p.blob(V(ankle.x, ankle.y - 0.05, ankle.z + 0.06), 0.06, [0.9, 0.5, 1.5]);
        for (let toe = 0; toe < 4; toe++) {
          const tx = ankle.x + (toe - 1.5) * 0.045;
          p.limb(V(tx, ankle.y - 0.07, ankle.z + 0.1), V(tx + (toe - 1.5) * 0.03, ankle.y - 0.1, ankle.z + 0.3), 0.017, 0.7);
        }
        // The web between the toes.
        p.box(V(ankle.x, ankle.y - 0.095, ankle.z + 0.22), [0.17, 0.008, 0.16]);
      });
    }
  },

  animate(ctx) {
    // A slow, high-kneed wade, arms swinging loose; leaning into a loping run once it hunts.
    animateBiped(ctx, { stride: 0.34, armSwing: 0.14, knee: 0.8, elbow: 0.12, lean: 0.4, bounce: 0.05, breathe: 0.02, headReach: 1.1 });
    const j = ctx.joints;
    const { time, move, run, seed } = ctx;
    const w = poseBlend(ctx);
    const still = 1 - move;
    const spine = j.spine, head = j.head;

    // Torso: hunched over the water when hunting, upright reaching up, folded over a rim peering.
    if (spine) {
      spine.rotation.x += w.hunt * 0.22 - w.up * 0.12 + w.peer * 1.05 * still - w.whistle * 0.15;
      spine.rotation.z += w.listen * 0.08;
    }
    if (head) {
      // Its head stays level on the hunch (eyes on you), tips up under a perch, hangs over a well.
      head.rotation.x += -w.hunt * 0.25 - w.up * 0.55 + w.peer * 0.35 * still;
      head.rotation.z += w.listen * (0.38 + Math.sin(time * 0.6) * 0.05);
      // Calm and standing: a slow, constant look across the water — the lifeguard's sweep.
      head.rotation.y += Math.sin(time * 0.45 + seed) * 0.35 * still * (1 - w.hunt) * (1 - w.peer) * (1 - w.listen);
    }
    // The jaw sags open when it hunts and gapes reaching for you.
    if (j.jaw) j.jaw.rotation.x = 0.05 + (w.hunt * (1 - w.whistle) * 0.3 + w.up * 0.45) * (0.7 + 0.3 * Math.sin(time * 7));
    // Up on its toes, bobbing, under someone out of reach.
    ctx.body.position.y += w.up * (0.05 + Math.sin(time * 2.2) * 0.04);

    for (const [n, s] of [["L", -1], ["R", 1]] as const) {
      const arm = j[`arm${n}`], fore = j[`fore${n}`], hand = j[`hand${n}`];
      if (!arm || !fore) continue;
      const lead = s > 0 ? 1 : 0.8; // one arm always leads
      // Hunting: both arms out in front, low, fingers spread to seize.
      arm.rotation.x -= w.hunt * (0.75 + run * move * 0.2) * lead;
      fore.rotation.x -= w.hunt * 0.35;
      // Reaching up: both arms high over its head, clawing at the edge.
      const claw = Math.sin(time * 2.6 + s * 1.3);
      arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -2.75 + claw * 0.12, w.up);
      arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, s * (0.22 + claw * 0.06), w.up);
      fore.rotation.x = THREE.MathUtils.lerp(fore.rotation.x, -0.25 - Math.max(0, claw) * 0.3, w.up);
      if (n === "R") {
        // The whistle: right hand up to the mouth for two blasts.
        arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -0.55, w.whistle);
        arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, 0.3, w.whistle);
        fore.rotation.x = THREE.MathUtils.lerp(fore.rotation.x, -2.45, w.whistle);
        // Peering: hanging straight down past the rim into the well, stretched far longer than an arm should be.
        const hang = w.peer * still;
        arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -1.12 + Math.sin(time * 0.7) * 0.06, hang);
        arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, 0.05, hang);
        fore.rotation.x = THREE.MathUtils.lerp(fore.rotation.x, -0.05, hang);
        arm.scale.y = 1 + hang * 0.35;
      } else {
        // Peering, the other hand braces on its knee.
        const brace = w.peer * still;
        arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -0.55, brace);
        fore.rotation.x = THREE.MathUtils.lerp(fore.rotation.x, -0.75, brace);
        // Listening: a hand lifted a little from its side, as if to quiet the room.
        arm.rotation.x -= w.listen * 0.35;
        arm.rotation.z -= w.listen * 0.25;
      }
      if (hand) hand.rotation.x = -0.1 - w.hunt * 0.25 + w.up * 0.3;

      // Fingers: loose and twitching calm, spread to grab hunting, clawing reaching up, trailing in the well.
      for (let finger = 0; finger < 4; finger++) {
        const phase = time * (3.8 + finger * 0.3) + finger * 1.7 + s;
        const twitch = Math.sin(phase) * (0.06 + w.peer * 0.1);
        const curl = 0.25 + twitch - w.hunt * 0.2 + w.up * (0.5 + Math.max(0, Math.sin(phase * 0.6)) * 0.6) + w.whistle * (n === "R" ? 0.9 : 0);
        rot(j[`finger${n}${finger}a`], -curl * 0.4, 0, -s * (finger - 1.5) * (0.05 + w.hunt * 0.12));
        rot(j[`finger${n}${finger}b`], -curl * 0.7, 0, 0);
        rot(j[`finger${n}${finger}c`], -curl * 0.6, 0, 0);
      }
    }

    // Peering, its knees give a little under the bend.
    const bend = w.peer * still;
    if (j.legL) j.legL.rotation.x -= bend * 0.25;
    if (j.legR) j.legR.rotation.x -= bend * 0.25;
    if (j.shinL) j.shinL.rotation.x += bend * 0.35;
    if (j.shinR) j.shinR.rotation.x += bend * 0.35;
    ctx.body.position.y -= bend * 0.08;
  },

  sense(ctx) {
    // Fallback only (see the file comment): a plain sight-range watcher.
    if (ctx.distanceMeters < VISION_RANGE) return { chasing: true, speed: CHASE_SPEED, agitated: true, pose: VIGIA_POSE.HUNT };
    return { chasing: false, speed: STILL_SPEED, agitated: false, pose: VIGIA_POSE.CALM };
  },

  speech() {
    return { key: "" };
  },

  radar: { color: "#78716c", strokeColor: "#44403c", labelKey: "radar.vigia" },
};
