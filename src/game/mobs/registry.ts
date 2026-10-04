/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The mob definition registry — total: every EntityType must have a
 * MobDefinition, so a new type added to the enum without one here is a
 * build error, not a silently-broken mob (see WanderingEntity.ts's old
 * per-type switch/if-chains this replaced, which had no such guarantee —
 * an unhandled type there just never chased, with no error).
 */

import { EntityType } from "../../shared/entityTypes";
import { MobDefinition } from "./types";
import { hound } from "./hound";
import { skinStealer } from "./skinStealer";
import { clump } from "./clump";
import { wretch } from "./wretch";
import { duller } from "./duller";
import { fingerKing } from "./fingerKing";
import { eco } from "./eco";
import { observador } from "./observador";
import { imitador } from "./imitador";
import { sombra } from "./sombra";
import { vigia } from "./vigia";
import { ceifador } from "./ceifador";
import { alien } from "./alien";
import { animation } from "./animation";
import { townKing } from "./townKing";

export const MOB_DEFS: Record<EntityType, MobDefinition> = {
  [EntityType.HOUND]: hound,
  [EntityType.SKIN_STEALER]: skinStealer,
  [EntityType.CLUMP]: clump,
  [EntityType.WRETCH]: wretch,
  [EntityType.DULLER]: duller,
  [EntityType.FINGER_KING]: fingerKing,
  [EntityType.ECO]: eco,
  [EntityType.OBSERVADOR]: observador,
  [EntityType.IMITADOR]: imitador,
  [EntityType.SOMBRA]: sombra,
  [EntityType.VIGIA]: vigia,
  [EntityType.CEIFADOR]: ceifador,
  [EntityType.ALIEN]: alien,
  [EntityType.ANIMATION]: animation,
  [EntityType.TOWN_KING]: townKing,
};
