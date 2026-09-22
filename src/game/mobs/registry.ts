/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The mob definition registry. Partial during the migration off the old
 * per-type switch/if-chains in WanderingEntity.ts (see git history): each
 * type moves over in its own commit, verified individually, with
 * WanderingEntity falling back to its legacy switch for any type not yet
 * present here. Once all types are migrated, this becomes a total
 * `Record<EntityType, MobDefinition>` (turning a missing type into a build
 * error) and the legacy switches are deleted in one cleanup commit.
 */

import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { hound } from "./hound";
import { skinStealer } from "./skinStealer";

export const MOB_DEFS: Partial<Record<EntityType, MobDefinition>> = {
  [EntityType.HOUND]: hound,
  [EntityType.SKIN_STEALER]: skinStealer,
};
