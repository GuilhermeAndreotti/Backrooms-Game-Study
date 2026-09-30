/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Image, Volume2, Sparkles, AlertTriangle, GlassWater } from "lucide-react";
import { t, type MessageKey } from "../i18n";

/** Icon + accent color per inventory item, shared by the hotbar and the inventory panel. */
const ITEM_ICONS: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  almond_water: { Icon: GlassWater, color: "text-amber-300" },
  old_photo: { Icon: Image, color: "text-amber-300" },
  liquid_pain: { Icon: AlertTriangle, color: "text-red-500" },
  cassette_tape: { Icon: Volume2, color: "text-amber-400" },
  strange_crystal: { Icon: Sparkles, color: "text-cyan-400" },
};

export function ItemIcon({ id, className = "w-5 h-5" }: { id: string; className?: string }) {
  const entry = ITEM_ICONS[id];
  if (!entry) return null;
  const { Icon, color } = entry;
  return <Icon className={`${className} ${color}`} />;
}

export interface ItemDetails {
  id: string;
  name: string;
  type: string;
  description: string;
  lore: string;
  clueTitle: string;
  clueText: string;
}

/** Localized texts for an inventory item (read live, so a language switch applies at once). */
export function itemDetails(id: string): ItemDetails | null {
  if (!ITEM_ICONS[id]) return null;
  const k = (field: string) => t(`item.${id}.${field}` as MessageKey);
  return {
    id,
    name: k("name"),
    type: k("type"),
    description: k("desc"),
    lore: k("lore"),
    clueTitle: k("clueTitle"),
    clueText: k("clueText"),
  };
}
