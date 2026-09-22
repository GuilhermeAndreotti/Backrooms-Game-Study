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

export const duller: MobDefinition = {
  type: EntityType.DULLER,
  baseSpeed: 1.1,
  baseHeight: 1.48, // floating ghostly phantom
  bobFreq: 1.8, bobAmp: 0.15, // silent floating hover
  speechBubbleLocalY: 0.75,
  forcedChaseSpeed: 3.1,

  build(ctx) {
    const { group } = ctx;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c1220, emissive: 0x1d4ed8, emissiveIntensity: 0.55,
      roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.82,
    });
    ctx.addTintMaterial(mat);

    group.add(ctx.limbBetween(mat, ctx.V(0, 0.35, 0), ctx.V(0, -0.35, 0), 0.11)); // spine
    // Arms, bent and trailing
    group.add(ctx.limbBetween(mat, ctx.V(0, 0.3, 0), ctx.V(-0.32, 0.05, 0.1), 0.05));
    group.add(ctx.limbBetween(mat, ctx.V(-0.32, 0.05, 0.1), ctx.V(-0.22, -0.25, 0.2), 0.045));
    group.add(ctx.limbBetween(mat, ctx.V(0, 0.3, 0), ctx.V(0.32, 0.05, 0.1), 0.05));
    group.add(ctx.limbBetween(mat, ctx.V(0.32, 0.05, 0.1), ctx.V(0.22, -0.25, 0.2), 0.045));
    // Legs, dangling loosely below (Duller floats, feet don't touch ground)
    group.add(ctx.limbBetween(mat, ctx.V(0, -0.35, 0), ctx.V(-0.2, -0.75, 0.05), 0.06));
    group.add(ctx.limbBetween(mat, ctx.V(0, -0.35, 0), ctx.V(0.2, -0.75, 0.05), 0.06));

    const head = new THREE.Mesh(ctx.sgeo("duller_head", () => new THREE.SphereGeometry(0.15, 10, 8)), mat);
    head.position.set(0, 0.53, 0);
    group.add(head);
  },

  // Normal pacing, but wanders into walls (see updateWallClipLook).
  sense(ctx) {
    if (ctx.distanceMeters < 12.0) return { chasing: true, speed: 2.0 };
    return { chasing: false, speed: 1.1 };
  },

  speech(ctx) {
    return { key: ctx.inSolidCell ? "sp.duller.wall" : "..." };
  },

  radar: { color: "#3b82f6", strokeColor: "#1d4ed8", labelKey: "radar.duller" },
};
