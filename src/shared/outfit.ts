/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wardrobe accessories (the "Armário" in the room lobby), shared verbatim by
 * the client and the Node relay server (server.ts), which whitelists every
 * slot against these lists. One item per slot; "" means the slot is empty.
 *
 * Like entityTypes.ts, this module must never import `three` or anything
 * else client-only: the server bundles it directly. The meshes themselves
 * live in src/game/ExplorerAvatar.ts.
 */

export const OUTFIT_SLOTS = ["head", "face", "neck", "back"] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

/** Every accessory, per slot, in the order the wardrobe lists them. */
export const OUTFIT_ITEMS = {
  head: ["tophat", "cap", "party", "crown", "hardhat", "cowboy", "halo", "catears", "antennae", "propeller"],
  face: ["sunglasses", "monocle", "mustache", "glasses3d", "clownnose", "gasmask"],
  neck: ["tie", "bowtie", "scarf", "badge", "medal", "chain"],
  back: ["backpack", "cape", "wings", "almondjug", "balloon"],
} as const satisfies Record<OutfitSlot, readonly string[]>;

export type Outfit = Record<OutfitSlot, string>;

export const EMPTY_OUTFIT: Outfit = { head: "", face: "", neck: "", back: "" };

/** Keeps only known items in their own slot; anything else (wrong type, unknown id, extra keys) becomes empty. */
export function sanitizeOutfit(value: unknown): Outfit {
  const out: Outfit = { ...EMPTY_OUTFIT };
  if (!value || typeof value !== "object") return out;
  const raw = value as Record<string, unknown>;
  for (const slot of OUTFIT_SLOTS) {
    const id = raw[slot];
    if (typeof id === "string" && (OUTFIT_ITEMS[slot] as readonly string[]).includes(id)) out[slot] = id;
  }
  return out;
}

/** A stable string for change detection ("tophat|monocle||cape"). */
export function outfitKey(outfit: Outfit | undefined): string {
  return OUTFIT_SLOTS.map((s) => outfit?.[s] ?? "").join("|");
}
