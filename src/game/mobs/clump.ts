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
import { rot, rx } from "./anim";

/** Limbs sticking out of the core. */
const SPIKES = 18;

export const clump: MobDefinition = {
  type: EntityType.CLUMP,
  baseSpeed: 1.4,
  baseHeight: 1.12, // ball of tumbling limbs
  strideLength: 2.2,
  bobFreq: 2.4, bobAmp: 0.12, // tumbling heavy rolling motion
  speechBubbleLocalY: 0.7,
  forcedChaseSpeed: 3.3,

  build(ctx) {
    const coreMat = ctx.smat("clump_core", () => new THREE.MeshStandardMaterial({ color: 0x1e0b12, emissive: 0x4a1029, emissiveIntensity: 0.35, roughness: 0.8 }));
    // The core rolls as one mass; each spike wiggles on its own root pivot.
    const core = ctx.joint("core", 0, 0, 0);
    const pulse = ctx.joint("blob", 0, 0, 0, core);
    ctx.put(pulse, new THREE.Mesh(ctx.sgeo("clump_core_geo", () => new THREE.SphereGeometry(0.34, 12, 10)), coreMat));

    const spikeMat = ctx.smat("clump_spike", () => new THREE.MeshStandardMaterial({ color: 0x2e111a, roughness: 0.9 }));
    const clawMat = ctx.smat("clump_claw", () => new THREE.MeshStandardMaterial({ color: 0x4a1d2d, roughness: 0.7 }));
    const clawGeo = ctx.sgeo("clump_claw_geo", () => new THREE.SphereGeometry(0.035, 6, 6));

    for (let i = 0; i < SPIKES; i++) {
      // Deterministic even spread (golden-angle spiral over the sphere) so every
      // Clump looks the same instead of a fresh random burst each frame.
      const t = i / SPIKES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const dir = ctx.V(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      const len = 0.3 + ((i * 37) % 10) / 40; // 0.3 - 0.55, stable per-index jitter
      const start = dir.clone().multiplyScalar(0.3);
      const mid = dir.clone().multiplyScalar(0.3 + len * 0.55);
      const end = dir.clone().multiplyScalar(0.3 + len);
      const spike = ctx.joint(`spike${i}`, start.x, start.y, start.z, core);
      ctx.limbIn(spike, spikeMat, start, mid, 0.028, 0.85);
      // Second segment: every limb bends once, like a finger.
      const tip = ctx.joint(`tip${i}`, mid.x, mid.y, mid.z, spike);
      ctx.limbIn(tip, spikeMat, mid, end, 0.024);
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.copy(end);
      ctx.put(tip, claw);
    }
  },

  animate(ctx) {
    // Tumbles when it rolls, churns in place when idle; the limbs grope
    // around constantly and all bristle toward you when it notices you.
    const j = ctx.joints;
    const { time, move, run } = ctx;
    const roll = move * (1 + run * 1.5);
    rot(j.core, ctx.phase * 0.9, 0, Math.sin(time * 0.7) * 0.4 + ctx.phase * 0.2 * roll);
    const pulse = 1 + Math.sin(time * 5.2) * 0.045 + (ctx.agitated ? Math.sin(time * 17) * 0.04 : 0);
    j.blob?.scale.setScalar(pulse);
    const bristle = Math.max(ctx.observe, ctx.agitated ? 1 : 0);
    const speed = 2.2 + roll * 3 + bristle * 4;
    for (let i = 0; i < SPIKES; i++) {
      const a = time * speed + i * 1.7;
      rot(j[`spike${i}`], Math.sin(a) * 0.35 * (1 - bristle * 0.6), 0, Math.cos(a * 0.8) * 0.35 * (1 - bristle * 0.6));
      rx(j[`tip${i}`], Math.sin(a * 1.3 + 0.6) * 0.6 * (1 - bristle * 0.7));
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
