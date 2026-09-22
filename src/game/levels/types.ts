/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-level mob rosters, as data instead of the imperative, scattered
 * `if (level === N)` spawn calls this replaces in GameEngine.ts. Three
 * shapes because the levels genuinely don't share one: 1 and 2 are a
 * fixed roster at fixed spots, 3 ("Lights Out") summons on demand while a
 * condition holds, and 4 ("Level G") is a fully bespoke boss ecosystem
 * that isn't worth forcing into this model — its entry exists only so
 * `LEVEL_DEFS[4]` is non-null, not to route its actual logic through
 * here (GameEngine's own `if (level === 4)` special-case is untouched).
 *
 * No GameEngine import here on purpose — keeps this module a leaf,
 * importable from anywhere without risking a cycle.
 */

import { EntityType } from "../../shared/entityTypes";

export type SpawnDescriptor =
  | {
      kind: "static";
      /** Each entry spawns once, at the nearest walkable cell to targetCell. */
      roster: { type: EntityType; targetCell: [number, number] }[];
    }
  | {
      kind: "timedSummon";
      /** One entry picked at random per summon. */
      pool: EntityType[];
      intervalS: number;
      maxConcurrent: number;
      /** How far (in cells) from the triggering explorer a new stalker lands. */
      spawnRadiusCells: [number, number];
    }
  | { kind: "bespoke" };

export interface LevelDefinition {
  id: number;
  displayLabel: string;
  spawn: SpawnDescriptor;
}
