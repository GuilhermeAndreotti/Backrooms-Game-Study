/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The set of hostile "wandering entity" types, shared verbatim by the client
 * (WanderingEntity.ts, GameEngine.ts) and the Node relay server (server.ts).
 *
 * This module must never import `three` or anything else client-only: the
 * server bundles it directly (esbuild --bundle --packages=external), and a
 * client-only dependency here would be dead weight/risk in that bundle — the
 * same reason server.ts hand-redeclares LOBBY_LEVEL instead of importing
 * Lobby.ts, which does pull in `three`.
 */

export enum EntityType {
  DULLER = "DULLER",
  HOUND = "HOUND",
  CLUMP = "CLUMP",
  SKIN_STEALER = "SKIN_STEALER",
  WRETCH = "WRETCH",
  /** Level G's exclusive stalker. */
  FINGER_KING = "FINGER_KING",
  /** O Eco: sound-reactive pursuer. */
  ECO = "ECO",
  /** O Observador: sight-reactive predator (sustained eye contact escalates it). */
  OBSERVADOR = "OBSERVADOR",
  /** O Imitador: disguised ambusher, reveals at close range. */
  IMITADOR = "IMITADOR",
  /** A Sombra: territorial, avoids/attacks light sources. */
  SOMBRA = "SOMBRA",
  /** O Vigia: near-stationary territorial controller, blocks routes. */
  VIGIA = "VIGIA",
  /** O Ceifador: adaptive apex predator, biased by VisitTracker. */
  CEIFADOR = "CEIFADOR",
  /** O Alien: Level 79's stalker. Patrols anywhere, but never follows a chase into a cabin. */
  ALIEN = "ALIEN",
  /** Level 94's night patrol: old cartoon characters. Never follow anyone into a house. */
  ANIMATION = "ANIMATION",
  /** Level 94's boss: sits on his throne until someone comes close, then never stops. */
  TOWN_KING = "TOWN_KING",
}

/** Every known entity type, in enum declaration order. The single source of truth for server/client whitelists. */
export const ALL_ENTITY_TYPES: EntityType[] = Object.values(EntityType);
