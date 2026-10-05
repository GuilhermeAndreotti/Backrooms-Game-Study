/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Achievement } from "../types/achievements";
import { t, localeTag } from "../i18n";

const ACHIEVEMENTS_STORAGE_KEY = "backrooms_achievements_list";

export const DEFAULT_ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_steps",
    title: "",
    description: "",
    iconName: "Compass",
    unlocked: false,
  },
  {
    id: "restored_mind",
    title: "",
    description: "",
    iconName: "Activity",
    unlocked: false,
  },
  {
    id: "noclip_master",
    title: "",
    description: "",
    iconName: "Unlock",
    unlocked: false,
  },
  {
    id: "collector_extraordinary",
    title: "",
    description: "",
    iconName: "FileText",
    unlocked: false,
  },
  {
    id: "pain_survivor",
    title: "",
    description: "",
    iconName: "AlertTriangle",
    unlocked: false,
  },
  {
    id: "absolute_survivor",
    title: "",
    description: "",
    iconName: "Skull",
    unlocked: false,
  },
  {
    id: "old_town_complete",
    title: "",
    description: "",
    iconName: "Trophy",
    unlocked: false,
  },
  {
    id: "old_town_king",
    title: "",
    description: "",
    iconName: "Sparkles",
    unlocked: false,
  },
  {
    id: "old_town_stay",
    title: "",
    description: "",
    iconName: "Lock",
    unlocked: false,
  },
  {
    id: "secret_level_found",
    title: "",
    description: "",
    iconName: "Sparkles",
    unlocked: false,
  },
  {
    id: "level_g_found",
    title: "",
    description: "",
    iconName: "FileText",
    unlocked: false,
  },
  {
    id: "level_g_escaped",
    title: "",
    description: "",
    iconName: "Trophy",
    unlocked: false,
  },
  {
    id: "valves_drained",
    title: "",
    description: "",
    iconName: "Lock",
    unlocked: false,
  }
];

/** Achievement with its title/description in the current language. */
function localized(ach: Achievement): Achievement {
  return { ...ach, title: t(`ach.${ach.id}.title`), description: t(`ach.${ach.id}.desc`) };
}

export function loadAchievements(): Achievement[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return DEFAULT_ACHIEVEMENTS.map(ach => {
        if (parsed[ach.id]) {
          return localized({
            ...ach,
            unlocked: true,
            unlockedAt: parsed[ach.id]
          });
        }
        return localized(ach);
      });
    }
  } catch (e) {
    console.warn("Failed to load achievements:", e);
  }
  return DEFAULT_ACHIEVEMENTS.map(localized);
}

type AchievementListener = (ach: Achievement) => void;
const listeners: Set<AchievementListener> = new Set();

export function addAchievementListener(listener: AchievementListener) {
  listeners.add(listener);
}

export function removeAchievementListener(listener: AchievementListener) {
  listeners.delete(listener);
}

export function unlockAchievement(id: string): Achievement | null {
  const current = loadAchievements();
  const index = current.findIndex(a => a.id === id);
  if (index === -1) return null;
  if (current[index].unlocked) return null;

  const timestamp = new Date().toLocaleString(localeTag());
  
  // Save to localStorage
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) as Record<string, string> : {};
    existing[id] = timestamp;
    localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn("Failed to save achievement:", e);
  }

  const unlockedAch: Achievement = {
    ...current[index],
    unlocked: true,
    unlockedAt: timestamp
  };

  // Notify listeners
  listeners.forEach(l => l(unlockedAch));
  return unlockedAch;
}
