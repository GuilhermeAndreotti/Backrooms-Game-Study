/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory items and quick-chat phrases, shared verbatim by the client and
 * the Node relay server (server.ts), which whitelists `item_give` and
 * `chat_quick` against these lists.
 *
 * Like entityTypes.ts, this module must never import `three` or anything
 * else client-only: the server bundles it directly.
 */

/**
 * Every item that can sit in the inventory, in hotbar order: slot 1 is
 * almond water, slot 5 the crystal. Fixed slots (rather than pickup order) so
 * the same key always means the same item.
 */
export const HOTBAR_ORDER = ["almond_water", "old_photo", "liquid_pain", "cassette_tape", "strange_crystal"] as const;

export type InventoryItemId = (typeof HOTBAR_ORDER)[number];

export const INVENTORY_ITEM_IDS: ReadonlySet<string> = new Set(HOTBAR_ORDER);

/** Items with a "use" action (GameEngine.useInventoryItem); strange_crystal is passive. */
export const USABLE_ITEMS: ReadonlySet<string> = new Set(["almond_water", "old_photo", "liquid_pain", "cassette_tape"]);

export function isInventoryItemId(value: unknown): value is InventoryItemId {
  return typeof value === "string" && INVENTORY_ITEM_IDS.has(value);
}

/** Canned callouts sent by id so every client shows them in its own language (`quick.<id>`). */
export const QUICK_CHAT_IDS = ["here", "run", "follow", "wait", "need_water", "found_exit", "danger", "ok"] as const;

export type QuickChatId = (typeof QUICK_CHAT_IDS)[number];

const QUICK_CHAT_SET: ReadonlySet<string> = new Set(QUICK_CHAT_IDS);

export function isQuickChatId(value: unknown): value is QuickChatId {
  return typeof value === "string" && QUICK_CHAT_SET.has(value);
}

/** How close (meters, horizontal) a teammate must be to hand them an item. The server allows a little more for latency. */
export const GIVE_RANGE = 3;
export const GIVE_RANGE_SERVER = 4;
