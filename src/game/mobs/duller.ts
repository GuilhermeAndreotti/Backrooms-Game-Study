/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DULLER: a gaunt, semi-transparent noclip shadow that floats and regularly
 * wanders through walls (see WanderingEntity.updateWallClipLook, which stays
 * DULLER-special-cased outside this module — it's a rendering-only fade tied
 * to the per-instance tint material, not sensing/behavior). Moved verbatim
 * from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { lookAtPlayer, rot, rx } from "./anim";

export const duller: MobDefinition = {
  type: EntityType.DULLER,
  baseSpeed: 1.1,
  baseHeight: 1.48, // floating ghostly phantom
  strideLength: 1.6,
  stepWeight: 0,
  bobFreq: 1.8, bobAmp: 0.15, // silent floating hover
  speechBubbleLocalY: 0.75,
  forcedChaseSpeed: 3.1,

  build(ctx) {
    const V = ctx.V;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c1220, emissive: 0x1d4ed8, emissiveIntensity: 0.55,
      roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.82,
    });
    ctx.addTintMaterial(mat);

    const spine = ctx.joint("spine", 0, -0.35, 0);
    ctx.limbIn(spine, mat, V(0, 0.35, 0), V(0, -0.35, 0), 0.11);
    // Arms, bent and trailing
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const arm = ctx.joint(`arm${n}`, 0, 0.3, 0, spine);
      ctx.limbIn(arm, mat, V(0, 0.3, 0), V(side * 0.32, 0.05, 0.1), 0.05);
      const fore = ctx.joint(`fore${n}`, side * 0.32, 0.05, 0.1, arm);
      ctx.limbIn(fore, mat, V(side * 0.32, 0.05, 0.1), V(side * 0.22, -0.25, 0.2), 0.045);
      // Legs, dangling loosely below (Duller floats, feet don't touch ground)
      const leg = ctx.joint(`leg${n}`, side * 0.04, -0.35, 0);
      ctx.limbIn(leg, mat, V(side * 0.04, -0.35, 0), V(side * 0.12, -0.56, 0.03), 0.06);
      const shin = ctx.joint(`shin${n}`, side * 0.12, -0.56, 0.03, leg);
      ctx.limbIn(shin, mat, V(side * 0.12, -0.56, 0.03), V(side * 0.2, -0.78, 0.05), 0.05);
    }

    const head = ctx.joint("head", 0, 0.4, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("duller_head", () => new THREE.SphereGeometry(0.15, 10, 8)), mat);
    skull.position.set(0, 0.53, 0);
    ctx.put(head, skull);
  },

  animate(ctx) {
    // A drifting ghost: no steps. Limbs dangle and trail behind as it glides,
    // arms float up like it's underwater; it tilts its head at you when it stops.
    const j = ctx.joints;
    const { time, move, run } = ctx;
    const drift = move * (1 + run);
    rot(j.spine, 0.18 * drift + Math.sin(time * 1.2) * 0.08, 0, Math.sin(time * 0.9) * 0.12);
    for (const [n, s] of [["L", 1], ["R", -1]] as const) {
      const sway = Math.sin(time * 1.3 + (s > 0 ? 0 : 1.9));
      rot(j[`leg${n}`], 0.35 * drift + sway * 0.15, 0, s * 0.05);
      rx(j[`shin${n}`], 0.3 * drift + Math.max(0, sway) * 0.3);
      rot(j[`arm${n}`], -0.25 - 0.3 * drift + sway * 0.2, 0, -s * (0.2 + Math.sin(time * 0.8) * 0.1));
      rx(j[`fore${n}`], -0.3 + sway * 0.25);
    }
    lookAtPlayer(ctx, j.head, 1, 0.5);
  },

  // Normal pacing, but wanders into walls (see updateWallClipLook).
  sense(ctx) {
    if (ctx.distanceMeters < 12.0) return { chasing: true, speed: 2.0 };
    return { chasing: false, speed: 1.1 };
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#3b82f6", strokeColor: "#1d4ed8", labelKey: "radar.duller" },
};
