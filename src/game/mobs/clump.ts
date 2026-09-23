/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLUMP: a fleshy core with a burst of spike-limbs. Has no eyes — purely a
 * hearing-based hunter, alert radius keyed to how loud the player is being.
 * Moved verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { EntityType } from "../../shared/entityTypes";
import { CellType } from "../ProceduralMap";
import { MobDefinition } from "./types";

export const clump: MobDefinition = {
  type: EntityType.CLUMP,
  baseSpeed: 1.4,
  baseHeight: 1.12, // ball of tumbling limbs
  bobFreq: 2.4, bobAmp: 0.12, // tumbling heavy rolling motion
  speechBubbleLocalY: 0.7,
  forcedChaseSpeed: 3.3,

  build(ctx) {
    const { group } = ctx;
    const coreMat = ctx.smat("clump_core", () => new THREE.MeshStandardMaterial({ color: 0x1e0b12, emissive: 0x4a1029, emissiveIntensity: 0.35, roughness: 0.8 }));
    const core = new THREE.Mesh(ctx.sgeo("clump_core_geo", () => new THREE.SphereGeometry(0.34, 12, 10)), coreMat);
    group.add(core);

    const spikeMat = ctx.smat("clump_spike", () => new THREE.MeshStandardMaterial({ color: 0x2e111a, roughness: 0.9 }));
    const clawMat = ctx.smat("clump_claw", () => new THREE.MeshStandardMaterial({ color: 0x4a1d2d, roughness: 0.7 }));
    const clawGeo = ctx.sgeo("clump_claw_geo", () => new THREE.SphereGeometry(0.035, 6, 6));

    const SPIKES = 18;
    for (let i = 0; i < SPIKES; i++) {
      // Deterministic even spread (golden-angle spiral over the sphere) so every
      // Clump looks the same instead of a fresh random burst each frame.
      const t = i / SPIKES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const dir = ctx.V(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      const len = 0.3 + ((i * 37) % 10) / 40; // 0.3 - 0.55, stable per-index jitter
      const start = dir.clone().multiplyScalar(0.3);
      const end = dir.clone().multiplyScalar(0.3 + len);
      group.add(ctx.limbBetween(spikeMat, start, end, 0.028));
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.copy(end);
      group.add(claw);
    }
  },

  // Hearing mechanic! Has no eyes, scans by sounds.
  sense(ctx) {
    // Level 7 (Dark Poolrooms) only: submerged in a WATER_ROOM cell, the
    // player loses it — the level's own documented weakness for its native
    // hazard. Kept as a small, explicit, level-gated check here rather than
    // a generic level->mob behavior-override plumbing system (LevelDefinition
    // doesn't have one — see levels/types.ts), since this is the only mob
    // that currently needs one; building that generic layer for a single
    // caller isn't worth the added surface right now.
    if (ctx.map.level === 7) {
      const gx = Math.floor(ctx.playerX / ctx.map.cellSize);
      const gz = Math.floor(ctx.playerZ / ctx.map.cellSize);
      if (ctx.map.grid[gx]?.[gz] === CellType.WATER_ROOM) {
        return { chasing: false, speed: 1.4 };
      }
    }
    if (ctx.playerState === "running") {
      return { chasing: ctx.distanceMeters <= 24.0, speed: 3.9 }; // hears distant sprinting boots, fast rush!
    }
    if (ctx.playerState === "crouching") {
      return { chasing: ctx.distanceMeters <= 2.2, speed: 1.1 }; // stealth allows creeping around it safely
    }
    return { chasing: ctx.distanceMeters <= 10.0, speed: 2.1 }; // standard walking pace
  },

  speech(ctx) {
    return { key: "" };
  },

  radar: { color: "#ec4899", strokeColor: "#be185d", labelKey: "radar.clump" },
};
