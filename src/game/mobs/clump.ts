/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLUMP: a fleshy core with a burst of spike-limbs. Has no eyes — purely a
 * hearing-based hunter, alert radius keyed to how loud the player is being.
 * Moved verbatim from the old per-type switches in WanderingEntity.ts.
 */

import * as THREE from "three";
import { bake, Parts, teeth } from "./anatomy";
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
  stepWeight: 0.8,
  bobFreq: 2.4, bobAmp: 0.12, // tumbling heavy rolling motion
  speechBubbleLocalY: 0.7,
  forcedChaseSpeed: 3.3,

  build(ctx) {
    const V = ctx.V;
    const coreMat = ctx.smat("clump_core", () => new THREE.MeshStandardMaterial({ color: 0x3a141c, emissive: 0x4a1029, emissiveIntensity: 0.18, roughness: 0.45 }));
    const veinMat = ctx.smat("clump_vein", () => new THREE.MeshStandardMaterial({ color: 0x1c0610, roughness: 0.4 }));
    const boneMat = ctx.smat("clump_claw", () => new THREE.MeshStandardMaterial({ color: 0xb5a58a, roughness: 0.5 }));
    const mawMat = ctx.smat("clump_maw", () => new THREE.MeshStandardMaterial({ color: 0x0c0204, roughness: 1 }));

    // The core rolls as one mass; each limb wiggles on its own root pivot.
    // A knot of fused flesh, lumpy and veined, with two mouths in it.
    const core = ctx.joint("core", 0, 0, 0);
    const pulse = ctx.joint("blob", 0, 0, 0, core);
    bake(ctx, pulse, coreMat, "clump_flesh", (p) => {
      p.blob(V(0, 0, 0), 0.3, [1, 0.95, 1], [0, 0, 0], [16, 12]);
      const lumps: [number, number, number, number][] = [
        [0.17, 0.12, 0.08, 0.17], [-0.15, 0.1, -0.12, 0.18], [0.05, -0.16, 0.16, 0.16],
        [-0.1, -0.12, 0.12, 0.15], [0.12, -0.05, -0.18, 0.17], [-0.05, 0.2, 0.05, 0.14],
      ];
      for (const [x, y, z, r] of lumps) p.blob(V(x, y, z), r, [1, 0.9, 1.05]);
    });
    bake(ctx, pulse, veinMat, "clump_veins", (p) => {
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05, b = i * 0.7;
        const pts = [0, 1, 2, 3].map((k) => {
          const t = a + k * 0.45;
          return V(Math.cos(t) * Math.cos(b + k * 0.2) * 0.32, Math.sin(b + k * 0.2) * 0.3, Math.sin(t) * Math.cos(b + k * 0.2) * 0.32);
        });
        p.chain(pts, 0.012, 0.007, 5);
      }
    });
    // Two maws, ringed with teeth.
    bake(ctx, pulse, mawMat, "clump_maws", (p) => {
      p.blob(V(0.0, 0.02, 0.29), 0.09, [1.3, 0.55, 0.5]);
      p.blob(V(-0.24, -0.08, -0.17), 0.07, [1.2, 0.5, 0.5], [0, -2.2, 0]);
    });
    bake(ctx, pulse, boneMat, "clump_teeth", (p) => {
      teeth(p, V(0, 0.055, 0.31), 0.09, 0.03, 9, 0.035, false, 0.009);
      teeth(p, V(0, -0.015, 0.31), 0.085, 0.03, 8, 0.03, true, 0.009);
    });

    for (let i = 0; i < SPIKES; i++) {
      // Deterministic even spread (golden-angle spiral over the sphere) so every
      // Clump looks the same instead of a fresh random burst each frame.
      const t = i / SPIKES;
      const theta = Math.acos(1 - 2 * t);
      const phi = Math.PI * (1 + Math.sqrt(5)) * i;
      const dir = ctx.V(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
      const len = 0.3 + ((i * 37) % 10) / 40; // 0.3 - 0.55, stable per-index jitter
      const start = dir.clone().multiplyScalar(0.27);
      const mid = dir.clone().multiplyScalar(0.3 + len * 0.55);
      const end = dir.clone().multiplyScalar(0.3 + len);
      // Arm-like limbs: thick where they root, a knuckle at the bend, a hooked claw.
      const spike = ctx.joint(`spike${i}`, start.x, start.y, start.z, core);
      ctx.limbIn(spike, coreMat, start, mid, 0.04, 0.6);
      // Second segment: every limb bends once, like a finger.
      const tip = ctx.joint(`tip${i}`, mid.x, mid.y, mid.z, spike);
      ctx.limbIn(tip, coreMat, mid, end, 0.022, 0.75);
      const claw = new THREE.Mesh(ctx.sgeo(`clump_claw_${i}`, () => {
        const p = new Parts();
        p.spike(end, end.clone().addScaledVector(dir, 0.09).add(V(0, -0.02, 0)), 0.016, 6);
        return p.merge();
      }), boneMat);
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
