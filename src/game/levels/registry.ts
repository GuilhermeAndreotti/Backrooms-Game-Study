/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The level -> mob roster table. Levels 0 (start) and 5 (LOBBY_LEVEL) have
 * no entry here, on purpose — GameEngine's spawn dispatcher treats a
 * missing key as "no mobs" structurally, not as an empty roster someone
 * could edit into existence by accident.
 */

import { EntityType } from "../../shared/entityTypes";
import { LevelDefinition } from "./types";

export const LEVEL_DEFS: Record<number, LevelDefinition> = {
  // Level 1: the "learn the ropes" level. DULLER/CLUMP teach basic
  // proximity/hearing chases; ECO/OBSERVADOR are the two newly-introduced
  // mechanics (sound, sight) that belong at the front of the curve per the
  // design doc's own "1 mecânica por vez" philosophy for early levels.
  // HOUND and SKIN_STEALER moved to level 2 (see below) — their lessons
  // ("don't hold eye contact", "is this really a person?") land better
  // once the player has already met the basics.
  1: {
    id: 1,
    displayLabel: "LEVEL 1",
    spawn: {
      kind: "static",
      roster: [
        { type: EntityType.DULLER, targetCell: [10, 30] },
        { type: EntityType.CLUMP, targetCell: [24, 12] },
        { type: EntityType.ECO, targetCell: [8, 10] },
        { type: EntityType.OBSERVADOR, targetCell: [26, 30] },
      ],
    },
  },

  // Level 2 ("Pipe Dreams"): forced-chase for every mob regardless of type
  // (see WanderingEntity.update()'s level===2||3 branch) — unchanged.
  // HOUND/SKIN_STEALER/WRETCH keep their original repeated presence;
  // IMITADOR/SOMBRA take over the slots CLUMP/DULLER used to fill (they
  // moved to being level-1-only — see above), keeping the same 11-slot,
  // 5-distinct-type shape the level always had.
  2: {
    id: 2,
    displayLabel: "LEVEL 2",
    spawn: {
      kind: "static",
      roster: [
        { type: EntityType.HOUND, targetCell: [2, 7] },
        { type: EntityType.SKIN_STEALER, targetCell: [2, 16] },
        { type: EntityType.WRETCH, targetCell: [8, 25] },
        { type: EntityType.SOMBRA, targetCell: [18, 25] },
        { type: EntityType.IMITADOR, targetCell: [23, 21] },
        { type: EntityType.HOUND, targetCell: [23, 11] },
        { type: EntityType.WRETCH, targetCell: [29, 5] },
        { type: EntityType.SKIN_STEALER, targetCell: [38, 5] },
        { type: EntityType.IMITADOR, targetCell: [44, 12] },
        { type: EntityType.HOUND, targetCell: [44, 24] },
        { type: EntityType.WRETCH, targetCell: [44, 35] },
      ],
    },
  },

  // Level 3 ("Lights Out", secret): unchanged — out of scope for the main-
  // progression rebalance. Summons on demand while a player's flashlight
  // is on, instead of a fixed roster.
  3: {
    id: 3,
    displayLabel: "LEVEL 6 (LIGHTS OUT)",
    spawn: {
      kind: "timedSummon",
      pool: [EntityType.DULLER, EntityType.SKIN_STEALER, EntityType.WRETCH, EntityType.HOUND],
      intervalS: 6.0,
      maxConcurrent: 5,
      spawnRadiusCells: [8, 14],
    },
  },

  // Level 4 ("Level G", secret): unchanged — a fully bespoke boss
  // ecosystem (closets, code puzzle, alarm, ambushes). This entry exists
  // only so `LEVEL_DEFS[4]` is non-null for anything that enumerates
  // "which levels have a definition"; GameEngine's own level===4
  // special-casing is untouched.
  4: {
    id: 4,
    displayLabel: "LEVEL G",
    spawn: { kind: "bespoke" },
  },
};
