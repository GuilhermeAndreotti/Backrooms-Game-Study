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
import { sculptedHead } from "./sculpt";
import { bake, hand, ribcage } from "./anatomy";
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
    // Darker hollows (sockets, mouth) inside the glow.
    const hollowMat = ctx.smat("duller_hollow", () => new THREE.MeshStandardMaterial({ color: 0x02040a, roughness: 1, transparent: true, opacity: 0.9 }));

    // A drowned, wasted body: ribs and collarbones under the glow.
    const spine = ctx.joint("spine", 0, -0.35, 0);
    bake(ctx, spine, mat, "duller_trunk", (p) => {
      p.chain([V(0, -0.38, 0), V(0, -0.05, 0.02), V(0, 0.32, 0)], 0.09, 0.1);
      ribcage(p, { c: V(0, 0.14, 0.02), w: 0.12, d: 0.09, h: 0.12, ribs: 5, r: 0.012 });
      for (const s of [-1, 1]) p.limb(V(0, 0.31, 0.06), V(s * 0.14, 0.3, 0.0), 0.016, 0.9);
      p.limb(V(0, 0.32, 0), V(0, 0.42, 0.01), 0.04, 0.9);
    });

    // Arms, bent and trailing, on long, slack hands
    for (const side of [-1, 1]) {
      const n = side < 0 ? "L" : "R";
      const elbow = V(side * 0.32, 0.05, 0.1), wrist = V(side * 0.22, -0.25, 0.2);
      const arm = ctx.joint(`arm${n}`, 0, 0.3, 0, spine);
      ctx.limbIn(arm, mat, V(side * 0.13, 0.3, 0), elbow, 0.042, 0.8);
      const fore = ctx.joint(`fore${n}`, elbow.x, elbow.y, elbow.z, arm);
      ctx.limbIn(fore, mat, elbow, wrist, 0.035, 0.8);
      bake(ctx, fore, mat, `duller_hand_${side}`, (p) => hand(p, { wrist, dir: wrist.clone().sub(elbow), across: V(0, 0, side), fingers: 4, len: 0.15, r: 0.01, curl: 0.25 }));
      // Legs, dangling loosely below (Duller floats, feet don't touch ground),
      // thinning away to nothing.
      const leg = ctx.joint(`leg${n}`, side * 0.04, -0.35, 0);
      ctx.limbIn(leg, mat, V(side * 0.06, -0.35, 0), V(side * 0.12, -0.56, 0.03), 0.06, 0.8);
      const shin = ctx.joint(`shin${n}`, side * 0.12, -0.56, 0.03, leg);
      ctx.limbIn(shin, mat, V(side * 0.12, -0.56, 0.03), V(side * 0.2, -0.86, 0.05), 0.048, 0.15);
    }

    // A drowned face: sunken sockets and a mouth hanging open, all hollow.
    const head = ctx.joint("head", 0, 0.4, 0, spine);
    const skull = new THREE.Mesh(ctx.sgeo("duller_head", () => sculptedHead(0.15)), mat);
    skull.position.set(0, 0.53, 0);
    skull.scale.set(0.9, 1.1, 1);
    ctx.put(head, skull);
    bake(ctx, head, hollowMat, "duller_hollows", (p) => {
      for (const s of [-1, 1]) p.blob(V(s * 0.05, 0.56, 0.125), 0.03, [1, 1.2, 0.6]);
      p.blob(V(0, 0.46, 0.125), 0.028, [0.9, 1.6, 0.6]);
    });
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
