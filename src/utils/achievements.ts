/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Achievement } from "../types/achievements";

const ACHIEVEMENTS_STORAGE_KEY = "backrooms_achievements_list";

export const DEFAULT_ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_steps",
    title: "Primeiros Passos",
    description: "Iniciou a infiltração nos corredores amarelos do Nível 0.",
    iconName: "Compass",
    unlocked: false,
  },
  {
    id: "restored_mind",
    title: "Mente Alerta",
    description: "Consumiu Água de Amêndoa para restaurar sua stamina e limpar a mente.",
    iconName: "Activity",
    unlocked: false,
  },
  {
    id: "noclip_master",
    title: "Noclipper Experiente",
    description: "Atravessou a parede instável do Nível 0 e alcançou o Nível 1.",
    iconName: "Unlock",
    unlocked: false,
  },
  {
    id: "key_finder",
    title: "Mestre das Chaves",
    description: "Encontrou a pesada Chave de Ferro Enferrujada escondida nas profundezas.",
    iconName: "Key",
    unlocked: false,
  },
  {
    id: "collector_extraordinary",
    title: "Pesquisador do Extraordinário",
    description: "Encontrou um memento antigo ou um fragmento de fita cassete perdida.",
    iconName: "FileText",
    unlocked: false,
  },
  {
    id: "pain_survivor",
    title: "Sobrevivente da Dor",
    description: "Coletou um frasco de Dor Líquida e resistiu aos seus efeitos colaterais severos.",
    iconName: "AlertTriangle",
    unlocked: false,
  },
  {
    id: "gate_unlocked",
    title: "Selo Rompido",
    description: "Abriu o Portão de Vapor do Nível 1 usando a Chave Enferrujada.",
    iconName: "Trophy",
    unlocked: false,
  },
  {
    id: "absolute_survivor",
    title: "Fuga do Labirinto",
    description: "Completou o Nível 2 e escapou da perseguição mortal das entidades.",
    iconName: "Skull",
    unlocked: false,
  }
];

export function loadAchievements(): Achievement[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return DEFAULT_ACHIEVEMENTS.map(ach => {
        if (parsed[ach.id]) {
          return {
            ...ach,
            unlocked: true,
            unlockedAt: parsed[ach.id]
          };
        }
        return ach;
      });
    }
  } catch (e) {
    console.warn("Failed to load achievements:", e);
  }
  return [...DEFAULT_ACHIEVEMENTS];
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

  const timestamp = new Date().toLocaleString("pt-BR");
  
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
